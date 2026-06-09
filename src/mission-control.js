/**
 * Mission Control Phase 1 — custom panels
 *
 * Provides endpoints for:
 *   - "Three Things" attention widget
 *   - Brain Dump → Triage (LLM-categorized quick capture)
 *   - Signal-filtered Activity Feed
 *
 * Storage: JSON files in ~/.openclaw/workspace/mission-control/
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

function addBrainDump(dataDir, rawText, parsed = {}) {
  const tasks = readBrainDump(dataDir);
  const now = new Date().toISOString();
  const id = `bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  };
  tasks.push(task);
  writeBrainDump(dataDir, tasks);
  return task;
}

function updateBrainDumpTask(dataDir, id, updates) {
  const tasks = readBrainDump(dataDir);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  writeBrainDump(dataDir, tasks);
  return tasks[idx];
}

function deleteBrainDumpTask(dataDir, id) {
  const tasks = readBrainDump(dataDir);
  const next = tasks.filter((t) => t.id !== id);
  writeBrainDump(dataDir, next);
  return tasks.length !== next.length;
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

  // 1. Cron failures (red)
  const failures = getRecentCronFailures(getOpenClawDir, 24);
  for (const f of failures.slice(0, 3)) {
    items.push({
      id: `cron:${f.id}`,
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
    items.push({
      id: `task:${d.id}`,
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
    const icon = u.type === "failure" ? "🔴" : u.type === "decision" ? "🟡" : "🔵";
    items.push({
      id: `act:${u.id}`,
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
     * GET /api/mission/braindump
     * POST /api/mission/braindump  { rawText, parsed? }
     * PATCH /api/mission/braindump/:id  { ...updates }
     * DELETE /api/mission/braindump/:id
     */
    brainDumpList(req, res) {
      const tasks = readBrainDump(dataDir);
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
  readActivity,
  appendActivity,
  acknowledgeActivity,
  DEFAULT_DATA_DIR,
};
