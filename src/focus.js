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
    .replace(/\[↩::\s*\d+\]/g, "")
    .replace(/[🔺⏫🔼🔽]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A task is "real" only if something remains after stripping metadata —
// the vault contains orphan rows like "- [ ] [↩:: 1] 📅 2026-07-05".
function hasRealText(t) {
  return Boolean(t && cleanTaskText(t.text));
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
  const open = (tasks || []).filter((t) => t && !t.is_completed && hasRealText(t));
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

// ============================================================================
// READERS (never throw)
// ============================================================================

function readLatestTaskData(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}-tasks\.json$/.test(f))
      .sort()
      .reverse();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  } catch {
    return null;
  }
}

function readNorthStar(file) {
  let vision = null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const m = raw.match(/^\*\*"([\s\S]*?)"\*\*/m);
    if (m) vision = m[1].replace(/\s+/g, " ").trim();
  } catch {
    // fall through — static buckets still returned
  }
  return { vision, buckets: BUCKETS.map((b) => ({ ...b })) };
}

// ============================================================================
// COMPUTE
// ============================================================================

function todayISO() {
  // Vault dates are America/Los_Angeles days
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function computeFocus(opts = {}) {
  const taskDataDir = opts.taskDataDir || TASK_DATA_DIR;
  const northStarFile = opts.northStarFile || NORTH_STAR_FILE;
  const today = opts.today || todayISO();

  const northStar = readNorthStar(northStarFile);
  const data = readLatestTaskData(taskDataDir);
  if (!data) {
    return { available: false, northStar, asOf: new Date().toISOString() };
  }

  const open = (data.tasks || []).filter((t) => t && !t.is_completed && hasRealText(t));
  const { hero, next, lowEnergyPick, corvusPlate } = pickFocus(data.tasks, today);

  // Ladder today's open tasks (Mike's side) up to the North Star buckets
  for (const b of northStar.buckets) b.taskCount = 0;
  for (const t of open) {
    if (t.assigned === "corvus") continue;
    const key = bucketForProject(t.project);
    const b = key && northStar.buckets.find((x) => x.key === key);
    if (b) b.taskCount += 1;
  }

  return {
    available: true,
    date: data.date,
    generatedAt: data.generated_at || null,
    stale: data.date < today,
    northStar,
    now: {
      hero: hero ? shapeTask(hero, today) : null,
      next: next.map((t) => shapeTask(t, today)),
    },
    lowEnergyPick: lowEnergyPick ? shapeTask(lowEnergyPick, today) : null,
    calendar: (data.calendar_events || []).slice(0, 6).map((e) => ({
      title: e.title || "",
      time: e.time || "",
    })),
    counts: {
      open: open.length,
      overdue: open.filter((t) => t.due && t.due <= today).length,
      dueToday: open.filter((t) => t.due === today).length,
      drifting: open.filter((t) => (t.postpone || 0) >= 10).length,
      corvusPlate,
    },
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE + HTTP (house pattern — see src/system-mind.js)
// ============================================================================

function refreshFocusAsync(opts) {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeFocus(opts);
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[focus] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getFocusCached(opts) {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshFocusAsync(opts);
  }
  return cache.data || computeFocus(opts);
}

function createFocusAPI(deps = {}) {
  const opts = {
    taskDataDir: deps.taskDataDir,
    northStarFile: deps.northStarFile,
  };
  return {
    list(req, res) {
      // Deps-injected instances (tests) bypass the module cache for isolation
      const data = deps.taskDataDir ? computeFocus(opts) : getFocusCached(opts);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = {
  scoreTask,
  cleanTaskText,
  bucketForProject,
  pickFocus,
  shapeTask,
  BUCKETS,
  readLatestTaskData,
  readNorthStar,
  computeFocus,
  createFocusAPI,
  getFocusCached,
};
