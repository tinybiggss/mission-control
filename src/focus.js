/**
 * Mission Control Phase 1 (Focus Deck) — "the flip"
 *
 * The one panel that answers "what do I do right now": ONE hero action +
 * two runners-up, chosen from the vault's machine-generated task sidecars
 * (Corvus/Task Data/YYYY-MM-DD-tasks.json, written by task-rollover.py at
 * 6:05 AM), laddered to the North Star buckets (Projects/North Star.md).
 *
 * Scoring blends priority emoji, due-date pressure, chronic postponement
 * ([↩:: N] counters), and #assigned-mike. Tasks assigned to corvus are
 * excluded from Mike's plate and only counted.
 *
 * Endpoint: GET /api/mission/focus
 */

const fs = require("fs");
const path = require("path");

const VAULT_ROOT = "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space";
const TASK_DATA_DIR = path.join(VAULT_ROOT, "Corvus", "Task Data");
const NORTH_STAR_FILE = path.join(VAULT_ROOT, "Projects", "North Star.md");
const VAULT_NAME = "Mike_Thinking_Space";

const PRIORITY_WEIGHT = { "🔺": 4, "⏫": 3, "🔼": 2, "🔽": 1 };

// North Star buckets — fixed order, matching the ### headings in North Star.md
const BUCKETS = [
  { key: "money", label: "Money", emoji: "💰" },
  { key: "health", label: "Health", emoji: "❤️" },
  { key: "family", label: "Family", emoji: "👨‍👩‍👧" },
  { key: "freedom", label: "Freedom", emoji: "🕊️" },
  { key: "legacy", label: "Legacy", emoji: "🌱" },
];

const PROJECT_BUCKET = {
  GHN: "money",
  "Velocity Partners": "money",
  Distills: "money",
  "Resilient Tomorrow": "legacy",
  "Solar / NeighborhoodShare": "legacy",
  "Personal / Family": "family",
};

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 60000;

// ============================================================================
// PURE HELPERS
// ============================================================================

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

function scoreTask(t, today) {
  if (!t || t.is_completed || !String(t.text || "").trim()) return -Infinity;
  let s = PRIORITY_WEIGHT[t.priority] || 2;
  if (t.due) {
    if (t.due <= today) s += 3;
    else if (daysBetween(today, t.due) <= 2) s += 1;
  }
  const p = t.postpone || 0;
  if (p >= 20) s += 3;
  else if (p >= 10) s += 2;
  else if (p >= 5) s += 1;
  if (t.assigned === "mike") s += 2;
  return s;
}

function cleanTaskText(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/[🔺⏫🔼🔽]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bucketForProject(project) {
  return PROJECT_BUCKET[project] || null;
}

function obsidianUriFor(sourceFile) {
  if (!sourceFile || !sourceFile.startsWith(VAULT_ROOT)) return null;
  const rel = sourceFile.slice(VAULT_ROOT.length + 1).replace(/\.md$/, "");
  return `obsidian://open?vault=${VAULT_NAME}&file=${encodeURIComponent(rel)}`;
}

function shapeTask(t, today) {
  return {
    text: cleanTaskText(t.text),
    project: t.project || "Uncategorized",
    bucket: bucketForProject(t.project),
    due: t.due || null,
    overdue: Boolean(t.due && t.due <= today),
    postpone: t.postpone || 0,
    priority: t.priority || null,
    tags: t.tags || [],
    assigned: t.assigned || null,
    obsidianUri: obsidianUriFor(t.source_file),
  };
}

function pickFocus(tasks, today) {
  const open = (tasks || []).filter((t) => t && !t.is_completed && String(t.text || "").trim());
  const mine = open.filter((t) => t.assigned !== "corvus");
  const corvusPlate = open.length - mine.length;

  const ranked = mine
    .map((t) => ({ t, score: scoreTask(t, today) }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.t);

  const hero = ranked[0] || null;
  const next = ranked.slice(1, 3);

  // Low-energy alternate: an easy win that is NOT the hero — low priority,
  // not chronically stuck (those need a real decision, not a nibble).
  const lowEnergyPick =
    ranked
      .slice(1)
      .find((t) => (PRIORITY_WEIGHT[t.priority] || 2) <= 2 && (t.postpone || 0) <= 3) || null;

  return { hero, next, lowEnergyPick, corvusPlate };
}

module.exports = {
  scoreTask,
  cleanTaskText,
  bucketForProject,
  pickFocus,
  shapeTask,
  BUCKETS,
};
