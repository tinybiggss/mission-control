/**
 * Mission Control Phase 1 — custom panels
 *
 * Provides endpoints for:
 *   - "Three Things" attention widget
 *   - Brain Dump → Triage (LLM-categorized quick capture)
 *   - Signal-filtered Activity Feed
 *
 * Storage: JSON files in ~/.openclaw/workspace/mission-control/
 *          Dismissed Three-Things state: ~/.openclaw/workspace/Corvus/Operations/mission-control-dismissed.json
 * Cron failures: read live from jobs-state.json
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(
  process.env.HOME || "/Users/michaeljones",
  ".openclaw/workspace/mission-control"
);

// ============================================================================
// DATA DIR
// ============================================================================

function ensureDataDir(dataDir = DEFAULT_DATA_DIR) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[mission-control] Failed to read ${filePath}: ${e.message}`);
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error(`[mission-control] Failed to write ${filePath}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// DISMISSED "THREE THINGS" STATE
// ============================================================================

const DISMISSED_FILE = path.join(
  process.env.HOME || "/Users/michaeljones",
  ".openclaw/workspace/Corvus/Operations/mission-control-dismissed.json"
);

/**
 * Shape: { dismissedIds: [{ id, dismissedAt }] }
 * Read once on module load + re-read on every change so multi-process
 * (or restart) scenarios stay consistent.
 */
function readDismissed() {
  return safeReadJson(DISMISSED_FILE, { dismissedIds: [] });
}

function writeDismissed(data) {
  ensureDataDir(path.dirname(DISMISSED_FILE));
  return safeWriteJson(DISMISSED_FILE, data);
}

function addDismissed(id) {
  const data = readDismissed();
  if (data.dismissedIds.some((d) => d.id === id)) return data;
  data.dismissedIds.push({ id, dismissedAt: new Date().toISOString() });
  writeDismissed(data);
  return data;
}

function removeDismissed(id) {
  const data = readDismissed();
  const before = data.dismissedIds.length;
  data.dismissedIds = data.dismissedIds.filter((d) => d.id !== id);
  const changed = data.dismissedIds.length !== before;
  if (changed) writeDismissed(data);
  return data;
}

function isDismissed(id) {
  const data = readDismissed();
  return data.dismissedIds.some((d) => d.id === id);
}

function getDismissedIdSet() {
  const data = readDismissed();
  return new Set(data.dismissedIds.map((d) => d.id));
}

// ============================================================================
// CRON FAILURE / STATE LOOKUP
// ============================================================================

/**
 * Read jobs-state.json (the source of truth for cron run state).
 * Returns: { [jobId]: { lastStatus, lastError, lastRunAtMs, consecutiveErrors, lastDurationMs } }
 */
function readCronState(getOpenClawDir) {
  const statePath = path.join(getOpenClawDir(), "cron", "jobs-state.json");
  const data = safeReadJson(statePath, { version: 1, jobs: {} });
  return data.jobs || {};
}

function readCronJobs(getOpenClawDir) {
  const jobsPath = path.join(getOpenClawDir(), "cron", "jobs.json");
  const data = safeReadJson(jobsPath, { version: 1, jobs: [] });
  return data.jobs || [];
}

/**
 * Returns the array of recent cron failures (last 24h).
 * Each entry: { id, name, lastStatus, lastError, lastRunAtMs, consecutiveErrors, lastDurationMs }
 */
function getRecentCronFailures(getOpenClawDir, hoursWindow = 24) {
  const state = readCronState(getOpenClawDir);
  const jobs = readCronJobs(getOpenClawDir);
  const now = Date.now();
  const cutoff = now - hoursWindow * 60 * 60 * 1000;

  const failures = [];
  for (const job of jobs) {
    const s = state[job.id]?.state || {};
    const lastRunAt = s.lastRunAtMs || 0;
    const lastStatus = s.lastStatus || s.lastRunStatus || null;
    const lastError = s.lastError || null;
    const consecutive = s.consecutiveErrors || 0;

    // Only failures within window
    if (lastRunAt < cutoff) continue;
    if (lastStatus !== "error" && !lastError) continue;
    if (lastStatus === "ok" && !lastError) continue;

    failures.push({
      id: job.id,
      name: job.name || job.id.slice(0, 8),
      description: job.description || "",
      lastStatus,
      lastError,
      lastRunAtMs: lastRunAt,
      consecutiveErrors: consecutive,
      lastDurationMs: s.lastDurationMs || 0,
      enabled: job.enabled !== false,
    });
  }

  // Sort by last run time desc — most recent first
  failures.sort((a, b) => b.lastRunAtMs - a.lastRunAtMs);
  return failures;
}

// ============================================================================
// BRAIN DUMP
// ============================================================================

const BRAIN_DUMP_FILE = "brain-dump.json";

/**
 * Read all brain-dump tasks. Returns array.
 * Default status for new tasks: "unsorted"
 */
function readBrainDump(dataDir) {
  ensureDataDir(dataDir);
  return safeReadJson(path.join(dataDir, BRAIN_DUMP_FILE), []);
}

function writeBrainDump(dataDir, tasks) {
  ensureDataDir(dataDir);
  return safeWriteJson(path.join(dataDir, BRAIN_DUMP_FILE), tasks);
}

/**
 * Derive the `mode` for a task based on its existing fields.
 * Mike's decision (2026-06-25): the field is *derived* from assignee/tags
 * at creation time, then persisted so users can override it later.
 *
 *   - Explicit `mode` passed in (e.g. { mode: "mixed" }) wins outright
 *   - Tasks assigned to "corvus" + #assigned-corvus tag → "autonomous"
 *   - Tasks with #planning tag                          → "planning"
 *   - Tasks with #assigned-mike tag                     → "planning"
 *   - Everything else (legacy, unknown assignee)        → null (legacy flag)
 *
 * @param {object} parsed - the parsed Brain Dump fields (tags, assignee, etc.)
 * @returns {"planning"|"autonomous"|"mixed"|null}
 */
function deriveMode(parsed = {}) {
  if (parsed.mode) return parsed.mode;
  const tags = (parsed.tags || []).map((t) => String(t).toLowerCase().replace(/^#/, ""));

  // Explicit tag wins
  if (tags.includes("assigned-corvus") && parsed.assignee === "corvus") {
    return "autonomous";
  }
  if (tags.includes("planning") || tags.includes("assigned-mike")) {
    return "planning";
  }

  // Assignee-only derivation
  if (parsed.assignee === "corvus" || parsed.assignee === "claude") {
    return "autonomous";
  }
  if (parsed.assignee === "mike" || parsed.assignee === "anna") {
    return "planning";
  }

  // Legacy / unknown — null means "needs triage" in the UI
  return null;
}

function addBrainDump(dataDir, rawText, parsed = {}) {
  const tasks = readBrainDump(dataDir);
  const now = new Date().toISOString();
  const id = `bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const explicitMode = parsed.mode || null;
  const derived = explicitMode || deriveMode(parsed);
  const modeSetBy = explicitMode ? "mike" : "auto";
  const task = {
    id,
    rawText,
    title: parsed.title || rawText.slice(0, 80),
    description: parsed.description || rawText,
    project: parsed.project || null,
    priority: parsed.priority || null, // "urgent-important" | "important-not-urgent" | "urgent-not-important" | "neither"
    due: parsed.due || null,
    assignee: parsed.assignee || null, // "corvus" | "claude" | "mike" | null
    tags: parsed.tags || [],
    status: "unsorted",
    createdAt: now,
    updatedAt: now,
    postponeCount: 0,
    iceboxFrozenUntil: null,
    // Planning vs Autonomous (Phase 4, 2026-06-25)
    // Values: "planning" | "autonomous" | "mixed" | null (legacy = needs triage)
    mode: derived,
    modeSetAt: now,
    modeSetBy, // "mike" | "corvus" | "auto"
    // Phase 2: Obsidian sync fields
    obsidianRef: null,    // "[[2026-06-09#^task-7d4f]]"
    blockId: null,        // "task-7d4f"
    mdLine: null,         // cached markdown line
    archivedAt: null,
    archiveReason: null,
  };
  tasks.push(task);
  writeBrainDump(dataDir, tasks);
  return task;
}

function updateBrainDumpTask(dataDir, id, updates) {
  const tasks = readBrainDump(dataDir);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const existing = tasks[idx];
  const now = new Date().toISOString();

  // If mode is being explicitly changed, stamp it
  const next = { ...existing, ...updates, updatedAt: now };
  if (
    Object.prototype.hasOwnProperty.call(updates, "mode") &&
    updates.mode !== existing.mode
  ) {
    next.modeSetAt = now;
    next.modeSetBy = updates.modeSetBy || "mike";
  }
  // Backfill mode if it was null and the caller changed assignee/tags
  if (
    existing.mode == null &&
    next.mode == null &&
    (updates.assignee !== undefined || updates.tags !== undefined)
  ) {
    const derived = deriveMode({
      assignee: next.assignee,
      tags: next.tags,
    });
    if (derived) {
      next.mode = derived;
      next.modeSetAt = now;
      next.modeSetBy = "auto";
    }
  }
  // Bump lastTouchedAt if the caller didn't pass it explicitly (so
  // the Outstanding view's age-sort stays meaningful).
  if (!Object.prototype.hasOwnProperty.call(updates, "lastTouchedAt")) {
    next.lastTouchedAt = now;
  }
  tasks[idx] = next;
  writeBrainDump(dataDir, tasks);
  return tasks[idx];
}

function deleteBrainDumpTask(dataDir, id) {
  const tasks = readBrainDump(dataDir);
  const next = tasks.filter((t) => t.id !== id);
  writeBrainDump(dataDir, next);
  return tasks.length !== next.length;
}

/**
 * Mirrors `deriveColumn()` semantics from the frontend so server-side
 * filtering matches what the user sees in the kanban.
 * Allowed filter values:
 *   - "all"                          → no filter
 *   - "unsorted"                     → status=unsorted OR (no priority AND not icebox)
 *   - "urgent-important"             → priority=urgent-important (Do First)
 *   - "schedule" | "important-not-urgent"
 *   - "delegate"   | "urgent-not-important"
 *   - "icebox"                      → status=icebox
 */
function filterTasksByPriority(tasks, priority) {
  switch (priority) {
    case "unsorted":
      return tasks.filter(
        (t) =>
          t.status === "unsorted" ||
          t.status === "backlog" ||
          (!t.priority && t.status !== "icebox"),
      );
    case "urgent-important":
      return tasks.filter((t) => t.priority === "urgent-important");
    case "schedule":
    case "important-not-urgent":
      return tasks.filter((t) => t.priority === "important-not-urgent");
    case "delegate":
    case "urgent-not-important":
      return tasks.filter(
        (t) =>
          t.priority === "urgent-not-important" ||
          t.assignee === "corvus" ||
          t.assignee === "claude",
      );
    case "icebox":
      return tasks.filter((t) => t.status === "icebox");
    default:
      return tasks;
  }
}

// ============================================================================
// ACTIVITY FEED
// ============================================================================

const ACTIVITY_FEED_FILE = "activity-feed.json";
const MAX_FEED_ENTRIES = 200;

/**
 * Append an entry to the activity feed. `entry` should be:
 *   { type, source, message, severity, actionUrl? }
 * Type: failure | decision | completion | info | digest
 * Severity: critical | warning | info
 */
function appendActivity(dataDir, entry) {
  ensureDataDir(dataDir);
  const feed = readActivity(dataDir);
  const now = new Date().toISOString();
  const item = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    type: entry.type || "info",
    source: entry.source || "unknown",
    severity: entry.severity || "info",
    message: entry.message || "",
    actionUrl: entry.actionUrl || null,
    acknowledged: false,
  };
  feed.unshift(item);
  if (feed.length > MAX_FEED_ENTRIES) {
    feed.length = MAX_FEED_ENTRIES;
  }
  writeActivity(dataDir, feed);
  return item;
}

function readActivity(dataDir) {
  ensureDataDir(dataDir);
  return safeReadJson(path.join(dataDir, ACTIVITY_FEED_FILE), []);
}

function writeActivity(dataDir, feed) {
  ensureDataDir(dataDir);
  return safeWriteJson(path.join(dataDir, ACTIVITY_FEED_FILE), feed);
}

function acknowledgeActivity(dataDir, id) {
  const feed = readActivity(dataDir);
  const item = feed.find((f) => f.id === id);
  if (!item) return null;
  item.acknowledged = true;
  item.acknowledgedAt = new Date().toISOString();
  writeActivity(dataDir, feed);
  return item;
}

function dismissActivity(dataDir, id) {
  const feed = readActivity(dataDir);
  const next = feed.filter((f) => f.id !== id);
  writeActivity(dataDir, next);
  return feed.length !== next.length;
}

// ============================================================================
// "THREE THINGS" COMPOSITE
// ============================================================================

/**
 * Builds the unified "Three Things" list.
 * Priority order (always):
 *   1. Cron failures in last 24h
 *   2. Decisions >24h old (read from brain-dump tasks with status="decision" or pending)
 *   3. Recent unacked activity-feed items
 *
 * Returns: { items: [...], sources: { failures: N, decisions: N, unacked: N } }
 */
function getThreeThings(getOpenClawDir, dataDir) {
  const items = [];
  const dismissedSet = getDismissedIdSet();

  // 1. Cron failures (red)
  const failures = getRecentCronFailures(getOpenClawDir, 24);
  for (const f of failures.slice(0, 3)) {
    const id = `cron:${f.id}`;
    if (dismissedSet.has(id)) continue;
    items.push({
      id,
      kind: "failure",
      icon: "🔴",
      severity: "critical",
      title: f.name,
      detail: f.lastError ? f.lastError.slice(0, 120) : `Status: ${f.lastStatus}`,
      source: "openclaw-cron",
      actionUrl: `/api/cron/${f.id}/runs`,
      meta: {
        consecutiveErrors: f.consecutiveErrors,
        lastRunAtMs: f.lastRunAtMs,
      },
    });
  }

  // 2. Decisions >24h old (yellow) — from brain-dump with status "decision" or unsorted
  // For now, treat tasks with assignee=corvus/mike and unsorted/backlog status as pending decisions
  const tasks = readBrainDump(dataDir);
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const pendingDecisions = tasks
    .filter((t) => {
      const created = new Date(t.createdAt).getTime();
      const isOld = created < dayAgo;
      const needsDecision =
        t.status === "unsorted" ||
        t.status === "backlog" ||
        (t.assignee === "mike" && t.status !== "done");
      return isOld && needsDecision;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const d of pendingDecisions.slice(0, 3)) {
    const id = `task:${d.id}`;
    if (dismissedSet.has(id)) continue;
    items.push({
      id,
      kind: "decision",
      icon: "🟡",
      severity: "warning",
      title: d.title,
      detail: `Waiting ${Math.round((now - new Date(d.createdAt).getTime()) / 3600000)}h — ${d.assignee || "unassigned"}`,
      source: "brain-dump",
      actionUrl: `#brain-dump/${d.id}`,
      meta: {
        createdAt: d.createdAt,
        assignee: d.assignee,
      },
    });
  }

  // 3. Unacked activity items (blue) — failures/decisions/completions
  const feed = readActivity(dataDir);
  const unacked = feed
    .filter(
      (f) =>
        !f.acknowledged &&
        (f.type === "failure" || f.type === "decision" || f.type === "completion")
    )
    .slice(0, 3);

  for (const u of unacked) {
    const id = `act:${u.id}`;
    if (dismissedSet.has(id)) continue;
    const icon = u.type === "failure" ? "🔴" : u.type === "decision" ? "🟡" : "🔵";
    items.push({
      id,
      kind: u.type,
      icon,
      severity: u.severity || "info",
      title: `${u.source}: ${u.message.slice(0, 60)}`,
      detail: u.message,
      source: u.source,
      actionUrl: u.actionUrl,
      meta: { ts: u.ts },
    });
  }

  // Cap at 3
  const capped = items.slice(0, 3);

  return {
    items: capped,
    total: items.length,
    sources: {
      failures: failures.length,
      decisions: pendingDecisions.length,
      unacked: unacked.length,
    },
  };
}

// ============================================================================
// SIGNAL-FILTERED FEED
// ============================================================================

/**
 * Returns the activity feed with always-show / digest / never-show rules applied.
 * - Always show: failures, decisions, completions (regardless of ack)
 * - Digest: routine info items (not shown individually, but counted)
 * - Never show: heartbeats
 */
function getFilteredFeed(dataDir) {
  const feed = readActivity(dataDir);
  const alwaysShow = [];
  let digestCount = 0;
  let neverShowCount = 0;

  for (const item of feed) {
    // Never show: heartbeats
    if (item.type === "heartbeat") {
      neverShowCount++;
      continue;
    }
    // Digest: routine info
    if (item.type === "info" && item.severity !== "warning" && item.severity !== "critical") {
      digestCount++;
      continue;
    }
    alwaysShow.push(item);
  }

  return {
    items: alwaysShow,
    digestCount,
    neverShowCount,
    totalUnfiltered: feed.length,
  };
}

// ============================================================================
// HELPERS — Today / Outstanding / Mode shaping
// ============================================================================

/**
 * Map task.status to a string used in the priority chip (🔺/⏫/🔼/⏬).
 * Mirrors the kanban's column mapping.
 */
function priorityEmojiForTask(t) {
  if (t.status === "icebox") return "🧊";
  if (t.priority === "urgent-important") return "🔺";
  if (t.priority === "important-not-urgent") return "⏫";
  if (t.priority === "urgent-not-important") return "🔼";
  return null;
}

const PRIORITY_RANK = { "🔺": 4, "⏫": 3, "🔼": 2, "⏬": 1, "🧊": 0 };

/**
 * Compute age (in days, integer) from a task's most-recent activity.
 * Uses lastTouchedAt when present, else updatedAt, else createdAt.
 */
function ageDaysForTask(t, nowMs = Date.now()) {
  const ts = t.lastTouchedAt || t.updatedAt || t.createdAt;
  if (!ts) return 0;
  const ms = nowMs - new Date(ts).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * Return YYYY-MM-DD for today in America/Los_Angeles.
 * Same offset math as getTodayDate() in mc-phase2.js (PDT = UTC-7).
 */
function todayDateLA() {
  const d = new Date();
  const offset = d.getTimezoneOffset(); // minutes from UTC
  const laOffset = 420; // PDT = UTC-7 = 420 min
  const adjusted = new Date(d.getTime() - (offset - laOffset) * 60000);
  return adjusted.toISOString().slice(0, 10);
}

/**
 * Shape a task into the compact card the Today/Outstanding views expect.
 * Pure function — no IO.
 */
function shapeTaskForView(t) {
  const priorityEmoji = priorityEmojiForTask(t);
  const mode = t.mode == null ? null : t.mode;
  return {
    id: t.id,
    title: t.title || t.rawText || "Untitled",
    status: t.status,
    priority: priorityEmoji,
    due: t.due || null,
    project: t.project || null,
    assignee: t.assignee || null,
    tags: t.tags || [],
    mode,
    modeLabel: mode, // alias kept for legacy JS consumers
    modeSetBy: t.modeSetBy || null,
    modeSetAt: t.modeSetAt || null,
    postponeCount: t.postponeCount || 0,
    ageDays: ageDaysForTask(t),
    lastTouchedAt: t.lastTouchedAt || t.updatedAt || t.createdAt || null,
    createdAt: t.createdAt || null,
    source: t.source || "brain-dump",
    obsidianRef: t.obsidianRef || null,
    blockId: t.blockId || null,
  };
}

/**
 * Sort tasks for the Today view: priority desc, then age desc.
 */
function sortForToday(tasks) {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return (b.ageDays || 0) - (a.ageDays || 0);
  });
}

/**
 * Sort tasks for the Outstanding view: age desc, then priority desc.
 */
function sortForOutstanding(tasks) {
  return [...tasks].sort((a, b) => {
    const ad = b.ageDays || 0;
    const bd = a.ageDays || 0;
    if (ad !== bd) return ad - bd;
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    return pb - pa;
  });
}

/**
 * Filter tasks for the "Today" view (Mike's inbox).
 *
 * Mike's confirmed rule (2026-06-25 13:11 PDT):
 *   - mode ∈ {"planning","mixed", null}      (legacy tasks that haven't been
 *                                            triaged yet also land here)
 *   - status != "done"                       (no done tasks)
 *   - due == today || due == null || due <= today
 *   - Sort: priority desc, then age desc
 *
 * Does NOT include mode == "autonomous" tasks. Those live in the Agents tab.
 */
function filterTasksForToday(tasks, options = {}) {
  const today = options.today || todayDateLA();
  return tasks.filter((t) => {
    if (t.status === "done" || t.status === "archived") return false;
    if (t.mode === "autonomous") return false;
    // legacy null + planning + mixed all qualify
    if (t.due == null) return true;
    return t.due <= today;
  });
}

/**
 * Filter tasks for the "Outstanding" view: all open tasks.
 *   - status != "done" && status != "archived"
 *   - mode filter is opt-in (so the Outstanding view can show everything)
 */
function filterTasksForOutstanding(tasks) {
  return tasks.filter((t) => t.status !== "done" && t.status !== "archived");
}

/**
 * Parse a query string value as an array. Supports `?priority=🔺&priority=⏫`.
 * Returns [] if nothing present.
 */
function parseArrayParam(searchParams, name) {
  const all = searchParams.getAll(name);
  if (all.length === 0) return [];
  // Some clients send a single comma-separated value
  return all
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

function applyPriorityFilter(tasks, priorities) {
  if (!priorities || priorities.length === 0) return tasks;
  const set = new Set(priorities);
  return tasks.filter((t) => {
    if (set.has(t.priority)) return true;
    // Allow legacy "all" placeholder
    return set.has("all");
  });
}

function applyProjectFilter(tasks, projects) {
  if (!projects || projects.length === 0) return tasks;
  const set = new Set(projects.map((p) => String(p).toLowerCase()));
  return tasks.filter((t) => {
    const proj = (t.project || "").toLowerCase();
    return proj && set.has(proj);
  });
}

function applyModeFilter(tasks, modes) {
  if (!modes || modes.length === 0) return tasks;
  const set = new Set(modes);
  return tasks.filter((t) => {
    if (t.mode == null) return set.has("legacy") || set.has("null");
    return set.has(t.mode);
  });
}

// ============================================================================
// PROJECT REGISTRY (lightweight — flat JSON file)
// ============================================================================

const PROJECT_REGISTRY_FILE = "projects-registry.json";

/**
 * Project registry stores promoted tasks. Each entry is:
 *   {
 *     id: "proj_xxxxx",
 *     title: "...",
 *     slug: "kebab-case",
 *     parentId: "bd_xxx" | null,
 *     createdAt: ISO,
 *     promotedToProjectAt: ISO,
 *     sourceTaskId: "bd_xxx",
 *     status: "open" | "in_progress" | "done" | "archived",
 *     links: { obsidianPath?, tags? }
 *   }
 */
function readProjectRegistry(dataDir) {
  ensureDataDir(dataDir);
  return safeReadJson(path.join(dataDir, PROJECT_REGISTRY_FILE), []);
}

function writeProjectRegistry(dataDir, projects) {
  ensureDataDir(dataDir);
  return safeWriteJson(path.join(dataDir, PROJECT_REGISTRY_FILE), projects);
}

function slugify(s) {
  return String(s || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled";
}

function promoteTaskToProject(dataDir, taskId) {
  const tasks = readBrainDump(dataDir);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return { ok: false, error: "Task not found" };
  const task = tasks[idx];

  const now = new Date().toISOString();
  const project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: task.title,
    slug: slugify(task.title),
    parentId: task.parentId || null,
    createdAt: now,
    promotedToProjectAt: now,
    sourceTaskId: task.id,
    status: "open",
    links: {
      tags: task.tags || [],
    },
  };

  const registry = readProjectRegistry(dataDir);
  registry.push(project);
  writeProjectRegistry(dataDir, registry);

  // Update the task: type → "project", link to project
  tasks[idx] = {
    ...task,
    type: "project",
    promotedToProjectAt: now,
    promotedToProjectId: project.id,
    updatedAt: now,
  };
  if (task.parentId) {
    project.parentId = task.parentId;
  }
  writeBrainDump(dataDir, tasks);

  return { ok: true, project };
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

/**
 * Wires up the routes. Returns a router function for use in server.js.
 *
 * @param {object} deps
 * @param {function} deps.getOpenClawDir
 * @param {string} [deps.dataDir] - override data dir
 */
function createMissionControlAPI(deps) {
  const { getOpenClawDir } = deps;
  const dataDir = deps.dataDir || DEFAULT_DATA_DIR;
  ensureDataDir(dataDir);

  return {
    /**
     * GET /api/mission/three-things
     */
    threeThings(req, res) {
      const result = getThreeThings(getOpenClawDir, dataDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    },

    /**
     * POST /api/mission/three-things/dismiss   { id }
     * Removes an item from the Three Things list (persists to disk).
     */
    threeThingsDismiss(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { id } = JSON.parse(body);
          if (!id || typeof id !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "id is required" }));
            return;
          }
          addDismissed(id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, id }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    /**
     * POST /api/mission/three-things/undismiss  { id }
     * Restores a previously dismissed item.
     */
    threeThingsUndismiss(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { id } = JSON.parse(body);
          if (!id || typeof id !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "id is required" }));
            return;
          }
          removeDismissed(id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, id }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    /**
     * GET /api/mission/three-things/dismissed
     * Returns the dismissed-IDs list (for debugging / UI badge).
     */
    threeThingsDismissedList(req, res) {
      const data = readDismissed();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },

    /**
     * GET /api/mission/braindump?priority=urgent-important
     * Optional ?priority= filter — restricts the returned task set by priority.
     * Special values:
     *   "all"         — no filter (default)
     *   "unsorted"    — status=unsorted OR no priority set
     *   "urgent-important" | "important-not-urgent" | "urgent-not-important" — by priority field
     *   "schedule" / "delegate" / "icebox" — semantic aliases that match the kanban column keys
     */
    brainDumpList(req, res) {
      const url = new URL(req.url, "http://x");
      const priority = url.searchParams.get("priority");
      // eslint-disable-next-line no-unused-vars
      const project = url.searchParams.get("project");
      // eslint-disable-next-line no-unused-vars
      const mode = url.searchParams.get("mode");
      let tasks = readBrainDump(dataDir);

      if (priority && priority !== "all") {
        tasks = filterTasksByPriority(tasks, priority);
      }
      const priorities = parseArrayParam(url.searchParams, "priority");
      if (priorities.length > 0 && priority !== "all") {
        tasks = applyPriorityFilter(tasks, priorities);
      }
      const projects = parseArrayParam(url.searchParams, "project");
      if (projects.length > 0) {
        tasks = applyProjectFilter(tasks, projects);
      }
      const modes = parseArrayParam(url.searchParams, "mode");
      if (modes.length > 0) {
        tasks = applyModeFilter(tasks, modes);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tasks }, null, 2));
    },

    brainDumpCreate(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { rawText, parsed } = JSON.parse(body);
          if (!rawText || typeof rawText !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "rawText is required" }));
            return;
          }
          const task = addBrainDump(dataDir, rawText, parsed || {});
          // Log to activity feed
          appendActivity(dataDir, {
            type: "completion",
            source: "brain-dump",
            severity: "info",
            message: `New task: ${task.title}`,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ task }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    brainDumpUpdate(req, res, id) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const task = updateBrainDumpTask(dataDir, id, updates);
          if (!task) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Task not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ task }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    brainDumpDelete(req, res, id) {
      const ok = deleteBrainDumpTask(dataDir, id);
      res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok }, null, 2));
    },

    /**
     * GET /api/mission/feed
     * POST /api/mission/feed  { type, source, message, severity?, actionUrl? }
     * PATCH /api/mission/feed/:id/ack
     * DELETE /api/mission/feed/:id
     */
    feedList(req, res) {
      const result = getFilteredFeed(dataDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    },

    feedAppend(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const entry = JSON.parse(body);
          const item = appendActivity(dataDir, entry);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ item }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },

    feedAck(req, res, id) {
      const item = acknowledgeActivity(dataDir, id);
      if (!item) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ item }, null, 2));
    },

    feedDismiss(req, res, id) {
      const ok = dismissActivity(dataDir, id);
      res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok }, null, 2));
    },

    /**
     * GET /api/mission/today
     * Returns Mike's inbox for today (planning-mode + legacy, not autonomous).
     *
     * Query params:
     *   ?priority=🔺&priority=⏫  - filter by priority emoji(s)
     *   ?project=rt               - filter by project tag(s)
     *   ?mode=planning            - filter by mode (default: planning+mixed+legacy)
     *
     * Response shape:
     *   {
     *     tasks: [...],           // shaped via shapeTaskForView
     *     count: N,
     *     planningCount: N,
     *     autonomousCount: N,     // 0 by design (Today excludes autonomous)
     *     legacyCount: N,         // tasks with mode == null
     *     mixedCount: N,
     *     asOf: ISO,
     *     today: "YYYY-MM-DD"
     *   }
     */
    today(req, res) {
      const url = new URL(req.url, "http://x");
      const today = todayDateLA();
      const all = readBrainDump(dataDir);
      let tasks = filterTasksForToday(all, { today });

      // Mode + project filters run on raw tasks (they use raw fields).
      const projects = parseArrayParam(url.searchParams, "project");
      tasks = applyProjectFilter(tasks, projects);

      // Priority filter needs the shaped emoji form. Shape first, then filter.
      let shaped = tasks.map((t) => shapeTaskForView(t));
      const priorities = parseArrayParam(url.searchParams, "priority");
      shaped = applyPriorityFilter(shaped, priorities);

      // Counts (computed against the *pre-priority-filter* set so the
      // header summary stays meaningful even when the user filters).
      const counts = shaped.reduce(
        (acc, t) => {
          if (t.mode == null) acc.legacyCount++;
          else if (t.mode === "planning") acc.planningCount++;
          else if (t.mode === "mixed") acc.mixedCount++;
          else if (t.mode === "autonomous") acc.autonomousCount++;
          return acc;
        },
        { planningCount: 0, autonomousCount: 0, mixedCount: 0, legacyCount: 0 }
      );

      const STALLED_DAYS = 7;
      let stalledCount = 0;
      shaped = sortForToday(shaped).map((t) => {
        // Tag overdue tasks so the UI can color them red
        if (t.due && t.due < today) t.overdue = true;
        // Tag stalled tasks (old + still un-triaged) so the UI can surface them
        if ((t.ageDays || 0) >= STALLED_DAYS) {
          t.stalled = true;
          stalledCount++;
        }
        return t;
      });

      // Enrichments (injected, optional — degrade gracefully if absent):
      //  - obsidianTasks: unchecked tasks from today's Obsidian daily note
      //  - brief: a one-line "what you last did" re-orientation from the ledger
      let obsidianTasks = [];
      try {
        obsidianTasks = deps.getDailyTasks ? deps.getDailyTasks(today) : [];
      } catch (e) {
        console.error("[mission-control] getDailyTasks failed:", e.message);
      }
      let brief = null;
      try {
        brief = deps.getBrief ? deps.getBrief() : null;
      } catch (e) {
        console.error("[mission-control] getBrief failed:", e.message);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            tasks: shaped,
            count: shaped.length,
            ...counts,
            stalledCount,
            obsidianTasks,
            brief,
            asOf: new Date().toISOString(),
            today,
          },
          null,
          2
        )
      );
    },

    /**
     * GET /api/mission/tasks
     * General-purpose outstanding tasks endpoint.
     * Returns ALL open tasks (not just today), filtered by query params.
     *
     * Query params:
     *   ?priority=🔺&priority=⏫  - filter by priority emoji(s)
     *   ?project=rt               - filter by project tag(s)
     *   ?mode=autonomous          - filter by mode
     *   ?status=todo              - filter by status (single)
     *
     * Sort: age desc, then priority desc.
     */
    tasksList(req, res) {
      const url = new URL(req.url, "http://x");
      const all = readBrainDump(dataDir);
      let tasks = filterTasksForOutstanding(all);

      // Mode + project + status filters use raw fields — safe to run before shaping.
      const projects = parseArrayParam(url.searchParams, "project");
      tasks = applyProjectFilter(tasks, projects);
      const modes = parseArrayParam(url.searchParams, "mode");
      tasks = applyModeFilter(tasks, modes);
      const status = url.searchParams.get("status");
      if (status) tasks = tasks.filter((t) => t.status === status);

      // Shape then priority-filter so ?priority=🔺 matches the emoji form.
      let shaped = tasks.map((t) => shapeTaskForView(t));
      const priorities = parseArrayParam(url.searchParams, "priority");
      shaped = applyPriorityFilter(shaped, priorities);
      shaped = sortForOutstanding(shaped);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            tasks: shaped,
            count: shaped.length,
            asOf: new Date().toISOString(),
          },
          null,
          2
        )
      );
    },

    /**
     * GET /api/mission/outstanding
     * Backwards-compat alias for /api/mission/tasks — same shape.
     * Returns ALL open tasks sorted by age (default: age desc).
     */
    outstanding(req, res) {
      return this.tasksList(req, res);
    },

    /**
     * POST /api/mission/tasks/:id/promote-to-project
     * "Task → Project (defer)" — when a task has ≥3 postponements OR the user
     * manually triggers it, convert the task into a project entry.
     *
     * Returns: { ok: true, project: {...} } or { ok: false, error }
     */
    promoteToProject(req, res, id) {
      const result = promoteTaskToProject(dataDir, id);
      if (!result.ok) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result, null, 2));
    },

    /**
     * GET /api/mission/projects
     * Returns the project registry.
     */
    projectsList(req, res) {
      const projects = readProjectRegistry(dataDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects, count: projects.length }, null, 2));
    },

    /**
     * GET /api/mission/cron-failures
     */
    cronFailures(req, res) {
      const hours = parseInt(new URL(req.url, "http://x").searchParams.get("hours") || "24", 10);
      const failures = getRecentCronFailures(getOpenClawDir, hours);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ failures }, null, 2));
    },

    // Expose data dir for tests / clients
    _dataDir: dataDir,
  };
}

module.exports = {
  createMissionControlAPI,
  // Helpers (exported for tests)
  getRecentCronFailures,
  getThreeThings,
  getFilteredFeed,
  readBrainDump,
  writeBrainDump,
  addBrainDump,
  updateBrainDumpTask,
  deleteBrainDumpTask,
  filterTasksByPriority,
  readActivity,
  appendActivity,
  acknowledgeActivity,
  dismissActivity,
  // Dismissed Three-Things state
  readDismissed,
  writeDismissed,
  addDismissed,
  removeDismissed,
  isDismissed,
  getDismissedIdSet,
  // Planning vs Autonomous (Phase 4)
  deriveMode,
  filterTasksForToday,
  filterTasksForOutstanding,
  shapeTaskForView,
  sortForToday,
  sortForOutstanding,
  applyPriorityFilter,
  applyProjectFilter,
  applyModeFilter,
  parseArrayParam,
  priorityEmojiForTask,
  ageDaysForTask,
  todayDateLA,
  // Project registry (Phase 4)
  readProjectRegistry,
  writeProjectRegistry,
  promoteTaskToProject,
  slugify,
  PROJECT_REGISTRY_FILE,
  DEFAULT_DATA_DIR,
  DISMISSED_FILE,
};
