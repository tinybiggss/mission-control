/**
 * Mission Control Phase 3 — Agent Observability
 *
 * Surfaces sub-agents (sessions with kind=subagent OR keys containing
 * ":subagent:") to the dashboard with human-readable names + status.
 *
 * Source of truth:
 *   - Live:    ~/.openclaw/subagents/runs.json   (written by the gateway)
 *   - Live:    `openclaw sessions --json`        (run on demand; cheap)
 *   - History: ~/.openclaw/workspace/Corvus/Operations/agent-log.jsonl (append-only)
 *
 * Endpoints:
 *   GET  /api/mission/agents                  → currently running
 *   GET  /api/mission/agents/history?since=…  → completed since timestamp
 *   GET  /api/mission/agents/:name            → single agent by name or runId
 *
 * Status derivation:
 *   - run has no endedAt AND outcome.status === "running"  → running
 *   - endedReason === "subagent-complete"                  → completed
 *   - endedReason === "subagent-failed" OR outcome.status === "error"/"timeout"/"failed"
 *                                                          → failed
 *   - Otherwise (outcome.status unknown, no endedAt)        → running
 */

const fs = require("fs");
const path = require("path");
const { getCronJobs } = require("./cron");

const HOME = process.env.HOME || "/Users/michaeljones";

// ============================================================================
// PATHS
// ============================================================================

const SUBAGENT_RUNS_FILE = path.join(HOME, ".openclaw/subagents/runs.json");
const AGENT_LOG_FILE = path.join(HOME, ".openclaw/workspace/Corvus/Operations/agent-log.jsonl");

// ============================================================================
// HELPERS
// ============================================================================

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[agents] Failed to read ${filePath}: ${e.message}`);
    return fallback;
  }
}

/**
 * Read agent-log.jsonl (append-only JSON Lines history).
 * Returns array of records. Skips malformed lines.
 */
function readAgentLog() {
  if (!fs.existsSync(AGENT_LOG_FILE)) return [];
  try {
    const raw = fs.readFileSync(AGENT_LOG_FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const records = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch (e) {
        // Skip malformed lines silently — append-only logs can get corrupted
      }
    }
    return records;
  } catch (e) {
    console.error(`[agents] Failed to read log: ${e.message}`);
    return [];
  }
}

// ============================================================================
// STATUS / METRIC DERIVATION
// ============================================================================

/**
 * Derive a normalized status from a subagent run record.
 * Returns one of: "running" | "completed" | "failed" | "blocked"
 */
function deriveStatus(run) {
  // No endedAt AND not explicitly ended → still running
  if (!run.endedAt && (!run.outcome || run.outcome.status === "running" || !run.outcome.status)) {
    return "running";
  }

  // Has endedAt — derive from outcome / endedReason
  const reason = run.endedReason || "";
  const outcomeStatus = run.outcome?.status || "";

  if (reason === "subagent-complete") return "completed";
  if (reason === "subagent-failed") return "failed";

  if (outcomeStatus === "ok" || outcomeStatus === "success" || outcomeStatus === "completed") {
    return "completed";
  }
  if (
    outcomeStatus === "error" ||
    outcomeStatus === "failed" ||
    outcomeStatus === "timeout" ||
    outcomeStatus === "cancelled"
  ) {
    return outcomeStatus === "timeout" ? "failed" : "failed";
  }

  // Has endedAt but ambiguous — treat as completed (it finished, somehow)
  return "completed";
}

/**
 * Map a runs.json record into the public agent shape.
 */
function mapAgent(run) {
  const status = deriveStatus(run);
  const startedMs = run.startedAt || run.createdAt || null;
  const endedMs = run.endedAt || run.outcome?.endedAt || null;

  // Elapsed seconds — frozen at completion if ended, live otherwise
  let elapsedSeconds = null;
  if (startedMs) {
    if (endedMs) {
      elapsedSeconds = Math.round((endedMs - startedMs) / 1000);
    } else if (status === "running") {
      elapsedSeconds = Math.round((Date.now() - startedMs) / 1000);
    }
  }

  return {
    runId: run.runId,
    name: run.label || run.runId,
    label: run.label || null,
    status,
    model: run.model || null,
    runtime: "subagent",
    startedAt: startedMs ? new Date(startedMs).toISOString() : null,
    completedAt: endedMs ? new Date(endedMs).toISOString() : null,
    elapsedSeconds,
    parentSession: run.requesterSessionKey || null,
    childSessionKey: run.childSessionKey || null,
    controllerSessionKey: run.controllerSessionKey || null,
    task: run.task || null,
    endedReason: run.endedReason || null,
    outcome: run.outcome || null,
    spawnMode: run.spawnMode || null,
    mode: run.spawnMode === "run" ? "autonomous" : "interactive",
    requesterOrigin: run.requesterOrigin || null,
    runTimeoutSeconds: run.runTimeoutSeconds || null,
    resultSummary: run.outcome?.status
      ? `outcome=${run.outcome.status}${run.endedReason ? `, reason=${run.endedReason}` : ""}`
      : null,
  };
}

// ============================================================================
// DATA SOURCES
// ============================================================================

/**
 * Read all subagent runs from disk (the gateway's runs.json).
 */
function readSubagentRuns() {
  const data = safeReadJson(SUBAGENT_RUNS_FILE, { version: 2, runs: {} });
  const runs = data.runs || {};
  return Object.values(runs);
}

/**
 * Currently running subagents — derived from runs.json (no endedAt AND outcome.status="running").
 */
function getRunningAgents() {
  const runs = readSubagentRuns();
  return runs
    .filter((r) => deriveStatus(r) === "running")
    .map(mapAgent)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

/**
 * Recently completed agents — from runs.json (anything with an endedAt, in window).
 *
 * @param {string} [sinceIso] - ISO timestamp; defaults to 7 days ago
 */
function getCompletedAgents(sinceIso = null) {
  const runs = readSubagentRuns();
  const sinceMs = sinceIso
    ? new Date(sinceIso).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;

  return runs
    .filter((r) => {
      const endedMs = r.endedAt || r.outcome?.endedAt || 0;
      return endedMs >= sinceMs && deriveStatus(r) !== "running";
    })
    .map(mapAgent)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}

/**
 * Merge runs.json history + agent-log.jsonl history, deduped by runId.
 * The log file may have richer records (custom fields, post-mortem summaries).
 */
function getAllHistory(sinceIso = null) {
  const sinceMs = sinceIso
    ? new Date(sinceIso).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;

  const fromRuns = getCompletedAgents(sinceIso).map((a) => ({ ...a, source: "runs.json" }));
  const logRecords = readAgentLog()
    .filter((r) => {
      const ts = new Date(r.completedAt || r.startedAt || r.ts || 0).getTime();
      return ts >= sinceMs;
    })
    .map((r) => ({
      ...r,
      source: "agent-log.jsonl",
      status: r.status || deriveStatus(r),
    }));

  // Dedup: runs.json wins (authoritative for live state); log fills gaps
  const byRunId = new Map();
  for (const r of fromRuns) {
    byRunId.set(r.runId, r);
  }
  for (const r of logRecords) {
    const id = r.runId || r.name;
    if (!byRunId.has(id)) {
      byRunId.set(id, r);
    }
  }

  return Array.from(byRunId.values()).sort(
    (a, b) =>
      new Date(b.completedAt || b.startedAt || 0).getTime() -
      new Date(a.completedAt || a.startedAt || 0).getTime(),
  );
}

/**
 * Find one agent by runId or by label (exact match, case-insensitive).
 * Returns null if not found.
 */
function findAgent(identifier) {
  const all = [...getRunningAgents(), ...getCompletedAgents()];
  const lower = String(identifier).toLowerCase();

  // 1. Exact runId
  const byId = all.find((a) => a.runId === identifier);
  if (byId) return byId;

  // 2. Exact label
  const byLabel = all.find((a) => a.label === identifier);
  if (byLabel) return byLabel;

  // 3. Case-insensitive label
  const byLabelCi = all.find((a) => (a.label || "").toLowerCase() === lower);
  if (byLabelCi) return byLabelCi;

  return null;
}

// ============================================================================
// HTTP HANDLERS
// ============================================================================

/**
 * Wires the agents routes onto the server.
 *
 * @param {object} deps
 * @param {function} [deps.getOpenClawDir] - unused for now (future: gateway queries)
 */
function createAgentsAPI(deps = {}) {
  const getOpenClawDir = deps.getOpenClawDir;
  return {
    /**
     * GET /api/mission/agents
     * Returns currently-running sub-agents.
     */
    list(req, res) {
      const agents = getRunningAgents();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            agents,
            count: agents.length,
            asOf: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    },

    /**
     * GET /api/mission/agents/schedule
     * The scheduled-automation board: OpenClaw cron jobs with real last-run
     * status, upcoming runs first. Surfaces failing/overdue jobs so silent
     * cron breakage is visible (audit F9).
     */
    scheduleBoard(req, res) {
      let jobs = [];
      try {
        jobs = getOpenClawDir ? getCronJobs(getOpenClawDir) : [];
      } catch (e) {
        console.error("[agents] scheduleBoard failed:", e.message);
      }
      const isFailing = (j) =>
        (j.consecutiveErrors || 0) > 0 ||
        j.lastStatus === "error" ||
        j.lastStatus === "failed";
      // Sort: overdue first, then soonest upcoming, disabled last.
      const sorted = jobs.slice().sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const an = a.nextRunAtMs || Infinity;
        const bn = b.nextRunAtMs || Infinity;
        return an - bn;
      });
      const summary = {
        total: jobs.length,
        enabled: jobs.filter((j) => j.enabled).length,
        disabled: jobs.filter((j) => !j.enabled).length,
        failing: jobs.filter(isFailing).length,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          { jobs: sorted, summary, asOf: new Date().toISOString() },
          null,
          2,
        ),
      );
    },

    /**
     * GET /api/mission/agents/history?since=ISO_DATE
     * Returns agents that have completed since the given timestamp.
     */
    history(req, res) {
      const url = new URL(req.url, "http://x");
      const since = url.searchParams.get("since");

      let agents;
      let windowStart;
      try {
        agents = getAllHistory(since);
        windowStart = since
          ? new Date(since).toISOString()
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid since parameter: " + e.message }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            agents,
            count: agents.length,
            windowStart,
            windowEnd: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    },

    /**
     * GET /api/mission/agents/:name
     * Returns one agent by runId or label.
     */
    detail(req, res, identifier) {
      const agent = findAgent(decodeURIComponent(identifier));
      if (!agent) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Agent not found", identifier }, null, 2));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(agent, null, 2));
    },
  };
}

module.exports = {
  createAgentsAPI,
  // Helpers (exported for tests + reuse)
  deriveStatus,
  mapAgent,
  readSubagentRuns,
  readAgentLog,
  getRunningAgents,
  getCompletedAgents,
  getAllHistory,
  findAgent,
  SUBAGENT_RUNS_FILE,
  AGENT_LOG_FILE,
};