/**
 * Mission Control Phase C — Signals / Research
 *
 * Surfaces the RT trend-watcher output — the Reddit/YouTube/Substack/Exa/TikTok
 * signals Corvus scores for "what's worth writing about." Today these only
 * reach Mike over Telegram (and sometimes silently fail to).
 *
 * Sources (read defensively, newest first):
 *   - Scored output:  SCORED_SIGNALS_PATH if present (rt-signal-scorer writes here)
 *   - Fallback queue: ~/.openclaw/workspace/Corvus/Operations/rt-signal-scorer-queue.json
 *                     (array of { id, source, url, topic, status, queued_at,
 *                      pillar_relevance[], priority, notes })
 *
 * NOTE: the scorer's *scored* output location was not confirmed on disk during
 * the build — SCORED_SIGNALS_PATH is a best guess with graceful fallback to the
 * queue. If a scored file shows up, point this const at it. (discovery task)
 *
 * Endpoint: GET /api/mission/signals
 */

const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME || "/Users/michaeljones";
const OPS_DIR = path.join(HOME, ".openclaw/workspace/Corvus/Operations");
const QUEUE_PATH = path.join(OPS_DIR, "rt-signal-scorer-queue.json");
// Best-guess scored-output candidates; first existing one wins.
const SCORED_CANDIDATES = [
  path.join(OPS_DIR, "rt-signal-scorer-scored.json"),
  path.join(OPS_DIR, "rt-signals-scored.json"),
  path.join(HOME, ".openclaw/workspace/Corvus/Operations/rt-signal-scored.json"),
];
const DISMISSED_PATH = path.join(OPS_DIR, "mission-control-dismissed-signals.json");

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 60000;

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
    console.error(`[signals] read ${filePath}: ${e.message}`);
    return fallback;
  }
}

function asArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  if (parsed && Array.isArray(parsed.queue)) return parsed.queue;
  if (parsed && Array.isArray(parsed.signals)) return parsed.signals;
  return [];
}

function loadDismissed() {
  const d = safeReadJson(DISMISSED_PATH, []);
  return new Set(Array.isArray(d) ? d : []);
}

function shapeSignal(s) {
  const priority = (s.priority || s.score_band || "").toLowerCase();
  return {
    id: s.id || s.url || s.topic,
    source: s.source || "unknown",
    topic: s.topic || s.title || "(untitled signal)",
    url: s.url || null,
    priority: priority || "medium",
    priorityRank: PRIORITY_RANK[priority] || 2,
    score: s.score ?? null,
    pillars: s.pillar_relevance || s.pillars || [],
    notes: (s.notes || "").slice(0, 200),
    queuedAt: s.queued_at || s.scored_at || s.date || null,
    status: s.status || null,
  };
}

// ============================================================================
// COMPUTE
// ============================================================================

function computeSignals() {
  // Prefer scored output; fall back to the queue.
  let raw = null;
  let sourceFile = "queue";
  for (const c of SCORED_CANDIDATES) {
    if (fs.existsSync(c)) {
      raw = safeReadJson(c, null);
      sourceFile = "scored";
      break;
    }
  }
  if (!raw) raw = safeReadJson(QUEUE_PATH, []);

  const dismissed = loadDismissed();
  const signals = asArray(raw)
    .map(shapeSignal)
    .filter((s) => !dismissed.has(s.id))
    .sort((a, b) => {
      if (b.priorityRank !== a.priorityRank) return b.priorityRank - a.priorityRank;
      return String(b.queuedAt || "").localeCompare(String(a.queuedAt || ""));
    });

  return {
    signals,
    count: signals.length,
    source: sourceFile, // "scored" or "queue" — UI can note when it's only the queue
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE + HTTP
// ============================================================================

function refreshSignalsAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeSignals();
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[signals] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getSignalsCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshSignalsAsync();
  }
  return cache.data || computeSignals();
}

function dismissSignal(id) {
  const dismissed = loadDismissed();
  dismissed.add(id);
  try {
    fs.mkdirSync(OPS_DIR, { recursive: true });
    fs.writeFileSync(DISMISSED_PATH, JSON.stringify([...dismissed], null, 2), "utf8");
  } catch (e) {
    console.error("[signals] dismiss write failed:", e.message);
    return false;
  }
  cache.timestamp = 0; // force refresh
  return true;
}

function createSignalsAPI(_deps = {}) {
  return {
    list(req, res) {
      const data = getSignalsCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
    dismiss(req, res, id) {
      const ok = dismissSignal(id);
      res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok, id }));
    },
  };
}

module.exports = { createSignalsAPI, getSignalsCached, refreshSignalsAsync, computeSignals };
