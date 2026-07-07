/**
 * Mission Control Phase 4 — Overnight brief
 *
 * "What happened while I slept," compressed to at most five plain-English
 * lines on the main screen:
 *
 *   🌙 last night's dreaming consolidation (counts, from the memory ledger)
 *   ⚙️ crons that fired in the last 12h + any failures BY NAME
 *   🧠 ledger session/stub totals
 *   📥 Corvus capture-queue depth
 *   🎯 how many tasks are drifting (↩10+) — feeds the Drift Meter
 *
 * Sources: system-mind cache (ledger), ~/.openclaw/cron/{jobs,jobs-state}.json,
 * the capture queue, and the vault task sidecar. Everything degrades to a
 * shorter brief rather than an error.
 *
 * Endpoint: GET /api/mission/overnight
 */

const fs = require("fs");
const path = require("path");

const { readLatestTaskData, cleanTaskText } = require("./focus");

const CRON_JOBS_FILE = "/Users/michaeljones/.openclaw/cron/jobs.json";
const CRON_STATE_FILE = "/Users/michaeljones/.openclaw/cron/jobs-state.json";
const QUEUE_FILE = "/Users/michaeljones/.openclaw/workspace/Corvus/Operations/capture-queue.json";
const TASK_DATA_DIR = path.join(
  "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space",
  "Corvus",
  "Task Data",
);

const WINDOW_MS = 12 * 3600 * 1000; // "overnight" = the last 12 hours
const DRIFT_MIN = 10;

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 300000; // the inputs change on nightly/hourly cadence

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ============================================================================
// LINE BUILDERS (each returns a string or null; each never throws)
// ============================================================================

function dreamingLine(getMind) {
  try {
    const mind = getMind();
    if (!mind || mind.mounted === false) {
      return "🌙 Memory ledger offline — no consolidation to report.";
    }
    const c = mind.consolidation;
    if (!c) return "🌙 No dreaming consolidation found (runs 3:00 AM).";
    const bits = [];
    if ((c.connections || []).length) bits.push(`${c.connections.length} connections`);
    if ((c.hypotheses || []).length) bits.push(`${c.hypotheses.length} hypotheses`);
    if ((c.tensions || []).length) bits.push(`${c.tensions.length} tensions`);
    return `🌙 Dreaming ran (${c.date}) — ${bits.join(" · ") || "empty consolidation"}.`;
  } catch {
    return null;
  }
}

function cronLine(readJobs, readJobsState, now) {
  try {
    const jobs = readJobs();
    const state = readJobsState();
    if (!jobs || !state || !state.jobs) return null;
    const nameById = {};
    for (const j of jobs.jobs || []) nameById[j.id] = j.name || j.id;

    let ran = 0;
    const failed = [];
    for (const [id, entry] of Object.entries(state.jobs)) {
      const s = entry && entry.state;
      if (!s || !s.lastRunAtMs || now - s.lastRunAtMs > WINDOW_MS) continue;
      ran++;
      if (s.lastRunStatus !== "ok" || (s.consecutiveErrors || 0) > 0) {
        failed.push(nameById[id] || id);
      }
    }
    if (!ran) return "⚙️ No crons fired in the last 12h.";
    return failed.length
      ? `⚙️ ${ran} cron runs in the last 12h — ${failed.length} failing: ${failed.join(", ")}.`
      : `⚙️ ${ran} cron runs in the last 12h, all ok.`;
  } catch {
    return null;
  }
}

function ledgerLine(getMind) {
  try {
    const mind = getMind();
    if (!mind || mind.mounted === false || !mind.counts) return null;
    const c = mind.counts;
    return `🧠 Ledger: ${c.sessions || 0} session summaries · ${c.consolidations || 0} consolidations${
      c.stubs ? ` · ${c.stubs} unfilled stubs` : ""
    }.`;
  } catch {
    return null;
  }
}

function queueLine(queueFile) {
  const q = readJsonOrNull(queueFile);
  if (!Array.isArray(q) || q.length === 0) return null;
  return `📥 Corvus inbox: ${q.length} item${q.length === 1 ? "" : "s"} queued for the next heartbeat.`;
}

function driftLineAndCount(readTasks) {
  try {
    const data = readTasks();
    const drifting = ((data && data.tasks) || []).filter(
      (t) => t && !t.is_completed && (t.postpone || 0) >= DRIFT_MIN && cleanTaskText(t.text),
    ).length;
    if (!drifting) return { line: null, drifting: 0 };
    return {
      line: `🎯 ${drifting} task${drifting === 1 ? "" : "s"} drifting at ↩10+ — triage in the Drift Meter.`,
      drifting,
    };
  } catch {
    return { line: null, drifting: 0 };
  }
}

// ============================================================================
// COMPUTE
// ============================================================================

function computeOvernight(deps = {}) {
  const getMind = deps.getMind || require("./system-mind").getSystemMindCached;
  const readJobs = deps.readJobs || (() => readJsonOrNull(CRON_JOBS_FILE));
  const readJobsState = deps.readJobsState || (() => readJsonOrNull(CRON_STATE_FILE));
  const readTasks = deps.readTasks || (() => readLatestTaskData(TASK_DATA_DIR));
  const queueFile = deps.queueFile || QUEUE_FILE;
  const now = deps.now || Date.now();

  const drift = driftLineAndCount(readTasks);
  const lines = [
    dreamingLine(getMind),
    cronLine(readJobs, readJobsState, now),
    ledgerLine(getMind),
    queueLine(queueFile),
    drift.line,
  ]
    .filter(Boolean)
    .slice(0, 5);

  return {
    lines,
    stats: { drifting: drift.drifting },
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE + HTTP (house pattern — see src/system-mind.js)
// ============================================================================

function refreshOvernightAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeOvernight();
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[overnight] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getOvernightCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshOvernightAsync();
  }
  return cache.data || computeOvernight();
}

function createOvernightAPI(deps = {}) {
  const injected = Boolean(deps.getMind || deps.readJobs || deps.queueFile || deps.readTasks);
  return {
    list(req, res) {
      // Deps-injected instances (tests) bypass the module cache for isolation
      const data = injected ? computeOvernight(deps) : getOvernightCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { computeOvernight, createOvernightAPI, getOvernightCached };
