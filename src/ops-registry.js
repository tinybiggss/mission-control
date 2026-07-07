/**
 * Mission Control Phase 3 — Unified Ops Registry
 *
 * One truth for every recurring thing on this machine. The automation is
 * fragmented across THREE schedulers, and the old panel only saw the first:
 *
 *   1. OpenClaw crons        ~/.openclaw/cron/{jobs,jobs-state}.json
 *   2. LaunchAgents          ~/Library/LaunchAgents/*.plist (+ launchctl list)
 *   3. User crontab          crontab -l (script-only jobs, no LLM)
 *
 * Read-only: the exec calls are plist→json conversion, `launchctl list`,
 * and `crontab -l`. Statuses: ok · running (KeepAlive w/ pid) · failing ·
 * parked (by design — see memory note rt-publishing-roadmap) · disabled ·
 * not-loaded. Every source degrades independently (a dead source reports
 * itself in `sources` instead of killing the panel).
 *
 * Endpoint: GET /api/mission/ops
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const { cronToHuman } = require("./cron");

const OPENCLAW_CRON_DIR = path.join(os.homedir(), ".openclaw", "cron");
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), "Library", "LaunchAgents");
const RELEVANT_PLIST_RE = /^(ai\.openclaw|com\.mike|local\.mike|launchagent-)/;

// Parked by design (Mike 2026-07-07): manual publishing first; automation
// returns at roadmap stage 5. Not-loaded is the HEALTHY state for these.
const PARKED_LABELS = new Set(["local.mike.corvus-scheduler", "local.mike.corvus-publisher"]);

const RECENT_WINDOW_MS = 12 * 3600 * 1000;
const MAX_UPCOMING = 8;

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 60000;

// ============================================================================
// SOURCE PARSERS (pure)
// ============================================================================

function parseLaunchctlList(text) {
  const map = {};
  for (const line of String(text || "").split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [pidRaw, exitRaw, label] = parts;
    if (!label || pidRaw === "PID") continue;
    const pid = /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
    const lastExit = /^-?\d+$/.test(exitRaw) ? Number(exitRaw) : null;
    map[label.trim()] = { pid, lastExit };
  }
  return map;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendarEntryTime(e) {
  const h = e.Hour != null ? e.Hour : 0;
  const m = e.Minute != null ? e.Minute : 0;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function plistSchedule(plist) {
  if (!plist) return "manual";
  if (plist.KeepAlive) return "always-on service";
  if (plist.StartInterval) {
    const s = plist.StartInterval;
    return s % 60 === 0 ? `every ${s / 60} min` : `every ${s} sec`;
  }
  const cal = plist.StartCalendarInterval;
  if (cal) {
    const entries = Array.isArray(cal) ? cal : [cal];
    const time = calendarEntryTime(entries[0]);
    const weekdays = entries
      .map((e) => e.Weekday)
      .filter((w) => w != null)
      .map((w) => WEEKDAY_NAMES[w] || w);
    if (weekdays.length) return `${weekdays.join(", ")} at ${time}`;
    if (entries[0].Day != null) return `monthly on day ${entries[0].Day} at ${time}`;
    return `daily at ${time}`;
  }
  if (plist.RunAtLoad) return "at login";
  return "manual";
}

function parseCrontab(text) {
  const items = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) continue;
    const expr = parts.slice(0, 5).join(" ");
    const command = parts.slice(5).join(" ");
    const script = (command.split(/\s+/)[0] || "").split("/").pop() || command;
    items.push({
      name: script,
      source: "crontab",
      schedule: cronToHuman(expr) || expr,
      status: "ok", // crontab keeps no run history; presence = scheduled
      detail: command.replace(/\s*>\/dev\/null.*$/, ""),
    });
  }
  return items;
}

// ============================================================================
// SHAPERS (pure)
// ============================================================================

function shapeOpenclawCron(job, stateEntry) {
  const s = (stateEntry && stateEntry.state) || {};
  let status = "ok";
  let detail = "";
  if (job.enabled === false) {
    status = "disabled";
    detail = "disabled in jobs.json";
  } else if (s.lastRunStatus && s.lastRunStatus !== "ok") {
    status = "failing";
    detail = s.consecutiveErrors
      ? `${s.consecutiveErrors} consecutive error${s.consecutiveErrors === 1 ? "" : "s"}`
      : `last run: ${s.lastRunStatus}`;
  } else if ((s.consecutiveErrors || 0) > 0) {
    status = "failing";
    detail = `${s.consecutiveErrors} consecutive errors`;
  }
  const expr = job.schedule && job.schedule.expr;
  return {
    name: job.name || job.id,
    source: "openclaw-cron",
    schedule: (expr && cronToHuman(expr)) || expr || job.schedule?.kind || "?",
    status,
    detail,
    lastRunAt: s.lastRunAtMs || null,
    nextRunAt: s.nextRunAtMs || null,
  };
}

function shapeLaunchAgent(label, plist, lcEntry, parkedLabels = PARKED_LABELS) {
  const schedule = plistSchedule(plist);
  let status;
  let detail = "";
  if (!lcEntry) {
    if (parkedLabels.has(label)) {
      status = "parked";
      detail = "unloaded by design — manual publishing first (roadmap stage 5)";
    } else {
      status = "not-loaded";
      detail = "plist present but not loaded in launchd";
    }
  } else if (lcEntry.lastExit !== 0 && lcEntry.lastExit != null && lcEntry.pid == null) {
    status = "failing";
    detail = `last exit code ${lcEntry.lastExit}`;
  } else if (plist && plist.KeepAlive && lcEntry.pid) {
    status = "running";
    detail = `pid ${lcEntry.pid}`;
  } else {
    status = "ok";
    detail = lcEntry.pid ? `pid ${lcEntry.pid}` : "";
  }
  return { name: label, source: "launchagent", schedule, status, detail };
}

// ============================================================================
// ROLLUPS (pure)
// ============================================================================

function summarize(items) {
  const s = { total: items.length, ok: 0, running: 0, failing: 0, parked: 0, disabled: 0, notLoaded: 0 };
  for (const i of items) {
    if (i.status === "ok") s.ok++;
    else if (i.status === "running") s.running++;
    else if (i.status === "failing") s.failing++;
    else if (i.status === "parked") s.parked++;
    else if (i.status === "disabled") s.disabled++;
    else if (i.status === "not-loaded") s.notLoaded++;
  }
  return s;
}

function timeline(items, now) {
  const recent = items
    .filter((i) => i.lastRunAt && now - i.lastRunAt <= RECENT_WINDOW_MS)
    .sort((a, b) => b.lastRunAt - a.lastRunAt)
    .map((i) => ({ name: i.name, at: i.lastRunAt, status: i.status }));
  const upcoming = items
    .filter((i) => i.nextRunAt && i.nextRunAt > now && i.status !== "disabled")
    .sort((a, b) => a.nextRunAt - b.nextRunAt)
    .slice(0, MAX_UPCOMING)
    .map((i) => ({ name: i.name, at: i.nextRunAt }));
  return { recent, upcoming };
}

// ============================================================================
// DEFAULT READERS (exec — each returns null on failure)
// ============================================================================

function safeExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { timeout: 5000, encoding: "utf8" });
  } catch {
    return null;
  }
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function defaultListPlists() {
  try {
    return fs
      .readdirSync(LAUNCH_AGENTS_DIR)
      .filter((f) => f.endsWith(".plist") && RELEVANT_PLIST_RE.test(f))
      .map((f) => {
        const raw = safeExec("plutil", ["-convert", "json", "-o", "-", path.join(LAUNCH_AGENTS_DIR, f)]);
        let plist = null;
        try {
          plist = raw ? JSON.parse(raw) : null;
        } catch {
          /* unparseable plist — keep label with null plist */
        }
        return { label: (plist && plist.Label) || f.replace(/\.plist$/, ""), plist };
      });
  } catch {
    return [];
  }
}

// ============================================================================
// COMPUTE
// ============================================================================

function computeOps(deps = {}) {
  const readCronJobs = deps.readCronJobs || (() => readJsonOrNull(path.join(OPENCLAW_CRON_DIR, "jobs.json")));
  const readCronState = deps.readCronState || (() => readJsonOrNull(path.join(OPENCLAW_CRON_DIR, "jobs-state.json")));
  const listPlists = deps.listPlists || defaultListPlists;
  const readLaunchctl = deps.readLaunchctl || (() => safeExec("launchctl", ["list"]));
  const readCrontabText = deps.readCrontabText || (() => safeExec("crontab", ["-l"]));
  const now = deps.now || Date.now();

  const sources = { openclawCron: "ok", launchAgents: "ok", crontab: "ok" };

  let openclawCron = [];
  try {
    const jobs = readCronJobs();
    const state = readCronState();
    if (!jobs) throw new Error("jobs.json unreadable");
    openclawCron = (jobs.jobs || []).map((j) => shapeOpenclawCron(j, state && state.jobs && state.jobs[j.id]));
  } catch (e) {
    sources.openclawCron = e.message;
  }

  let launchAgents = [];
  try {
    const lcMap = parseLaunchctlList(readLaunchctl() || "");
    // Two plist FILES can declare the same Label (launchd only honors one) —
    // e.g. the stray launchagent-task-rollover.plist duplicate. Dedupe and say so.
    const byLabel = new Map();
    for (const { label, plist } of listPlists() || []) {
      byLabel.set(label, (byLabel.get(label) || []).concat([plist]));
    }
    launchAgents = [...byLabel.entries()].map(([label, plists]) => {
      const item = shapeLaunchAgent(label, plists[0], lcMap[label], PARKED_LABELS);
      if (plists.length > 1) {
        item.detail = `${item.detail ? item.detail + " · " : ""}⚠ ${plists.length} plist files share this label — remove the duplicate`;
      }
      return item;
    });
  } catch (e) {
    sources.launchAgents = e.message;
  }

  let crontab = [];
  try {
    const text = readCrontabText();
    if (text == null) throw new Error("crontab unreadable");
    crontab = parseCrontab(text);
  } catch (e) {
    sources.crontab = e.message;
  }

  const all = [...openclawCron, ...launchAgents, ...crontab];
  return {
    groups: { openclawCron, launchAgents, crontab },
    summary: summarize(all),
    timeline: timeline(all, now),
    sources,
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE + HTTP (house pattern — see src/system-mind.js)
// ============================================================================

function refreshOpsAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeOps();
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[ops-registry] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getOpsCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshOpsAsync();
  }
  return cache.data || computeOps();
}

function createOpsAPI(deps = {}) {
  const injected = Boolean(deps.readCronJobs || deps.listPlists || deps.readCrontabText);
  return {
    list(req, res) {
      // Deps-injected instances (tests) bypass the module cache for isolation
      const data = injected ? computeOps(deps) : getOpsCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = {
  parseLaunchctlList,
  plistSchedule,
  parseCrontab,
  shapeOpenclawCron,
  shapeLaunchAgent,
  summarize,
  timeline,
  computeOps,
  createOpsAPI,
  getOpsCached,
};
