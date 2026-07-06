/**
 * Mission Control Phase A — Health / Ops self-monitoring
 *
 * The "is this dashboard telling me the truth?" panel. It surfaces the silent
 * failures the 2026-07 workflow audit found — things that fail while logging
 * "ok", so they stay invisible until you go looking:
 *
 *   - The cross-system memory ledger volume being unmounted at cron time.
 *   - The memory-injection refresh writing a 168-byte empty placeholder.
 *   - Ledger "stub" entries piling up (sessions recorded but never summarized).
 *   - The corvus scheduler/publisher launchd curl jobs hitting dead routes and
 *     exiting 0 anyway (last-run file is an HTML error, not JSON).
 *   - The openclaw gateway crash-looping (SIGABRT) and its err log never rotating.
 *   - This server's own server.err bloating from failed CLI polls.
 *
 * Each check returns { id, label, ok, severity, detail, value }. `ok:false`
 * with severity "error" renders red; "warn" renders amber.
 *
 * Endpoint: GET /api/mission/health
 */

const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME || "/Users/michaeljones";

// ============================================================================
// PATHS
// ============================================================================

const LEDGER_VOLUME = "/Volumes/MacMini_Extended";
const LEDGER_FILE = path.join(LEDGER_VOLUME, "llm-memory/memory.jsonl");
const CROSS_CONTEXT_FILE = path.join(HOME, ".openclaw/workspace/memory/cross-system-context.md");
const SCHEDULER_LAST_RUN = "/tmp/corvus-scheduler-last-run.json";
const PUBLISHER_LAST_RUN = "/tmp/corvus-publisher-last-run.json";
const GATEWAY_ERR_LOG = path.join(HOME, ".openclaw/logs/gateway.err.log");
// This server's own logs live one level above the repo (the wrapper dir).
const SERVER_ERR_LOG = path.join(__dirname, "..", "..", "server.err");
const SERVER_OUT_LOG = path.join(__dirname, "..", "..", "server.log");

// The 168-byte "no recent entries / volume unmounted" placeholder is the known
// sentinel. Anything at or below it means injection produced nothing useful.
const EMPTY_CONTEXT_MAX_BYTES = 200;
const LOG_WARN_BYTES = 25 * 1024 * 1024; // 25 MB — unrotated log warning threshold
const STUB_WARN_COUNT = 15; // stub pile-up warning threshold

// ============================================================================
// CACHE (the gateway-log read is bounded but not free; refresh twice a minute)
// ============================================================================

let healthCache = { data: null, timestamp: 0, refreshing: false };
const HEALTH_TTL_MS = 30000;

// ============================================================================
// HELPERS
// ============================================================================

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function relAge(mtimeMs) {
  const diff = Date.now() - mtimeMs;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

/** Read the last `maxBytes` of a (possibly huge) file without loading it all. */
function tailBytes(filePath, maxBytes) {
  const st = statOrNull(filePath);
  if (!st) return "";
  try {
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    try {
      const len = st.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

// ============================================================================
// CHECKS
// ============================================================================

function checkMount() {
  const ok = fs.existsSync(LEDGER_VOLUME) && fs.existsSync(LEDGER_FILE);
  return {
    id: "ledger-mount",
    label: "Memory ledger volume",
    ok,
    severity: "error",
    detail: ok
      ? `Mounted · ${LEDGER_VOLUME}`
      : `NOT mounted — ${LEDGER_VOLUME} missing. Cross-system memory is blind until it's back.`,
  };
}

function checkMemoryInjection() {
  const st = statOrNull(CROSS_CONTEXT_FILE);
  if (!st) {
    return {
      id: "memory-injection",
      label: "Memory injection (cross-system-context)",
      ok: false,
      severity: "error",
      detail: "cross-system-context.md missing — the 06:30 refresh never wrote it.",
    };
  }
  const empty = st.size <= EMPTY_CONTEXT_MAX_BYTES;
  return {
    id: "memory-injection",
    label: "Memory injection (cross-system-context)",
    ok: !empty,
    severity: "error",
    value: fmtBytes(st.size),
    detail: empty
      ? `Empty placeholder (${st.size} B, written ${relAge(st.mtimeMs)}). Volume was likely unmounted at 06:30 cron time — Claude Code is starting cold.`
      : `${fmtBytes(st.size)} of context, refreshed ${relAge(st.mtimeMs)}.`,
  };
}

function checkLedgerStubs() {
  const st = statOrNull(LEDGER_FILE);
  if (!st) {
    return {
      id: "ledger-stubs",
      label: "Ledger stub pile-up",
      ok: false,
      severity: "warn",
      detail: "Ledger unreadable (volume unmounted?).",
    };
  }
  let total = 0;
  let stubs = 0;
  let latestDate = "";
  try {
    const raw = fs.readFileSync(LEDGER_FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      total++;
      try {
        const e = JSON.parse(line);
        if (e && e.status === "stub") stubs++;
        if (e && e.date && e.date > latestDate) latestDate = e.date;
      } catch {
        // skip malformed line
      }
    }
  } catch (e) {
    return {
      id: "ledger-stubs",
      label: "Ledger stub pile-up",
      ok: false,
      severity: "warn",
      detail: `Ledger read failed: ${e.message}`,
    };
  }
  const ok = stubs < STUB_WARN_COUNT;
  return {
    id: "ledger-stubs",
    label: "Ledger stub pile-up",
    ok,
    severity: "warn",
    value: `${stubs} stub / ${total}`,
    detail: `${stubs} unfilled stub${stubs === 1 ? "" : "s"} of ${total} entries` +
      (latestDate ? ` · latest ${latestDate}` : "") +
      (ok ? "" : " — sessions are being recorded but not summarized."),
  };
}

/** A launchd curl job "last run" file is healthy only if it's parseable JSON
 *  indicating success. Currently it's an HTML "Cannot POST" error → red. */
function checkCurlJob(id, label, filePath) {
  const st = statOrNull(filePath);
  if (!st) {
    return {
      id,
      label,
      ok: false,
      severity: "warn",
      detail: "No last-run file — job may never have run.",
    };
  }
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8").trim();
  } catch {
    /* fall through */
  }
  const looksHtml = /^<!doctype html|^<html|Cannot (POST|GET)/i.test(raw);
  if (looksHtml) {
    const msg = (raw.match(/Cannot (?:POST|GET) [^\s<]+/i) || ["route error"])[0];
    return {
      id,
      label,
      ok: false,
      severity: "error",
      value: relAge(st.mtimeMs),
      detail: `Broken: last run returned an HTML error ("${msg}") ${relAge(st.mtimeMs)}. curl exited 0 anyway, so launchd thinks it's fine.`,
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      id,
      label,
      ok: false,
      severity: "warn",
      value: relAge(st.mtimeMs),
      detail: `Last-run output isn't JSON (${relAge(st.mtimeMs)}).`,
    };
  }
  const success =
    parsed && (parsed.ok === true || parsed.success === true || parsed.status === "ok");
  return {
    id,
    label,
    ok: !!success,
    severity: "warn",
    value: relAge(st.mtimeMs),
    detail: success
      ? `Last run OK ${relAge(st.mtimeMs)}.`
      : `Last run reported not-ok ${relAge(st.mtimeMs)}.`,
  };
}

function checkGateway() {
  const st = statOrNull(GATEWAY_ERR_LOG);
  const tail = tailBytes(GATEWAY_ERR_LOG, 512 * 1024);
  const sigabrt = (tail.match(/SIGABRT|signal 6|exited.*-6/gi) || []).length;
  const failed = (tail.match(/candidate_failed/gi) || []).length;
  const succeeded = (tail.match(/candidate_succeeded|candidate_ok/gi) || []).length;
  const oversized = st && st.size > LOG_WARN_BYTES;
  const problems = [];
  if (sigabrt > 0) problems.push(`${sigabrt} SIGABRT marker${sigabrt === 1 ? "" : "s"} (recent)`);
  if (failed + succeeded > 0) {
    const rate = Math.round((failed / (failed + succeeded)) * 100);
    if (rate >= 50) problems.push(`fallback ladder failing ${rate}%`);
  }
  if (oversized) problems.push(`err log ${fmtBytes(st.size)} (unrotated)`);
  return {
    id: "gateway",
    label: "OpenClaw gateway",
    ok: problems.length === 0,
    severity: sigabrt > 0 ? "error" : "warn",
    value: st ? fmtBytes(st.size) : "no log",
    detail:
      problems.length === 0
        ? `Healthy · err log ${st ? fmtBytes(st.size) : "?"} (last 512 KB scanned).`
        : problems.join(" · "),
  };
}

function checkCliPolls() {
  // Reflect whether this server is still hammering the dead openclaw CLI.
  const st = statOrNull(SERVER_ERR_LOG);
  const oversized = st && st.size > LOG_WARN_BYTES;
  const tail = tailBytes(SERVER_ERR_LOG, 64 * 1024);
  const recentCliSpam = (tail.match(/openclaw (sessions|status)|Command failed: openclaw/gi) || [])
    .length;
  const ok = !oversized && recentCliSpam === 0;
  return {
    id: "cli-polls",
    label: "Dashboard CLI polls",
    ok,
    severity: "warn",
    value: st ? fmtBytes(st.size) : "—",
    detail: ok
      ? `Quiet · server.err ${st ? fmtBytes(st.size) : "?"}, no recent CLI-failure spam.`
      : `server.err ${st ? fmtBytes(st.size) : "?"}${
          recentCliSpam ? `, ${recentCliSpam} recent openclaw-CLI failures in tail` : ""
        } — truncate it and confirm the CLI gate is on.`,
  };
}

// ============================================================================
// AGGREGATION
// ============================================================================

function computeHealth() {
  const checks = [
    checkMount(),
    checkMemoryInjection(),
    checkLedgerStubs(),
    checkCurlJob("scheduler", "Corvus scheduler", SCHEDULER_LAST_RUN),
    checkCurlJob("publisher", "Corvus publisher", PUBLISHER_LAST_RUN),
    checkGateway(),
    checkCliPolls(),
  ];
  const errors = checks.filter((c) => !c.ok && c.severity === "error").length;
  const warnings = checks.filter((c) => !c.ok && c.severity === "warn").length;
  const overall = errors > 0 ? "error" : warnings > 0 ? "warn" : "ok";
  return {
    overall,
    counts: { ok: checks.filter((c) => c.ok).length, warnings, errors, total: checks.length },
    checks,
    asOf: new Date().toISOString(),
  };
}

function refreshHealthAsync() {
  if (healthCache.refreshing) return;
  healthCache.refreshing = true;
  try {
    healthCache.data = computeHealth();
    healthCache.timestamp = Date.now();
  } catch (e) {
    console.error("[health] compute failed:", e.message);
  } finally {
    healthCache.refreshing = false;
  }
}

function getHealthCached() {
  if (!healthCache.data || Date.now() - healthCache.timestamp > HEALTH_TTL_MS) {
    refreshHealthAsync();
  }
  return healthCache.data || computeHealth();
}

// ============================================================================
// HTTP
// ============================================================================

function createHealthAPI(_deps = {}) {
  return {
    list(req, res) {
      const data = getHealthCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { createHealthAPI, getHealthCached, refreshHealthAsync, computeHealth };
