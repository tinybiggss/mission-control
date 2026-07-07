/**
 * Mission Control Phase 2 — Needs You (the decision inbox)
 *
 * One list of everything currently blocked on Mike, across systems:
 *   - failing/warning Health checks (from ./health — the "fix me" reds)
 *   - Corvus capture-queue items, with PENDING_MIKE_* markers surfaced first
 *   - vault tasks tagged #discussion (waiting on a conversation, not work)
 *   - the corvus-dashboard drafts backlog as a single rollup (link to :4321)
 *
 * This panel is a queue of DECISIONS, not another feed: every item is
 * something only Mike can unblock.
 *
 * Endpoint: GET /api/mission/needs-you
 */

const fs = require("fs");
const path = require("path");

const QUEUE_FILE = "/Users/michaeljones/.openclaw/workspace/Corvus/Operations/capture-queue.json";
const VAULT_TASK_DATA_DIR = path.join(
  "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space",
  "Corvus",
  "Task Data",
);
const CORVUS_DASHBOARD_URL = "http://localhost:4321";
const MAX_CONTENT_CHARS = 220;

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 30000;

// ============================================================================
// SOURCE READERS (each never throws; each degrades to empty)
// ============================================================================

function healthItems(getHealth) {
  try {
    const h = getHealth();
    return (h && h.checks ? h.checks : [])
      .filter((c) => c.ok === false)
      .map((c) => ({
        type: "health",
        id: c.id,
        severity: c.severity || "warn",
        label: c.label,
        detail: c.detail || "",
      }));
  } catch {
    return [];
  }
}

function queueItems(queueFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(queueFile, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e) => ({
      type: "queue",
      id: e.id || "",
      captureType: e.capture_type || null,
      pendingMike: /PENDING_MIKE/i.test(String(e.content || "")),
      content: String(e.content || "").slice(0, MAX_CONTENT_CHARS),
      capturedAt: e.captured_at || null,
    }));
  } catch {
    return [];
  }
}

function discussionItems(readTasks) {
  try {
    const data = readTasks();
    return ((data && data.tasks) || [])
      .filter(
        (t) =>
          t &&
          !t.is_completed &&
          Array.isArray(t.tags) &&
          t.tags.some((tag) => String(tag).toLowerCase() === "#discussion"),
      )
      .map((t, i) => ({
        type: "discussion",
        id: `discussion-${i}`,
        text: String(t.text || "").replace(/\*\*/g, "").replace(/[🔺⏫🔼🔽💬]/gu, "").trim(),
        postpone: t.postpone || 0,
        project: t.project || "Uncategorized",
      }))
      .filter((t) => t.text);
  } catch {
    return [];
  }
}

function draftsItem(getContent) {
  try {
    const c = getContent();
    if (!c || c.up === false) return null;
    const drafts = (c.stages && c.stages.draft) || [];
    if (!drafts.length) return null;
    return {
      type: "drafts",
      id: "drafts-backlog",
      count: drafts.length,
      latest: drafts[0].name || null,
      link: CORVUS_DASHBOARD_URL,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// COMPUTE
// ============================================================================

function computeNeedsYou(deps = {}) {
  const getHealth = deps.getHealth || require("./health").getHealthCached;
  const getContent = deps.getContent || require("./corvus-proxy").getContentCached;
  const readTasks =
    deps.readTasks || (() => require("./focus").readLatestTaskData(VAULT_TASK_DATA_DIR));
  const queueFile = deps.queueFile || QUEUE_FILE;

  const health = healthItems(getHealth);
  const queue = queueItems(queueFile);
  const discussion = discussionItems(readTasks);
  const drafts = draftsItem(getContent);

  // Decision order: broken systems → explicitly waiting on Mike → wants a
  // conversation → the rest of Corvus's inbox → the standing drafts backlog.
  const items = [
    ...health,
    ...queue.filter((q) => q.pendingMike),
    ...discussion,
    ...queue.filter((q) => !q.pendingMike),
    ...(drafts ? [drafts] : []),
  ];

  return {
    items,
    counts: {
      total: items.length,
      health: health.length,
      queue: queue.length,
      discussion: discussion.length,
      drafts: drafts ? drafts.count : 0,
    },
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE + HTTP (house pattern — see src/system-mind.js)
// ============================================================================

function refreshNeedsYouAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeNeedsYou();
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[needs-you] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getNeedsYouCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshNeedsYouAsync();
  }
  return cache.data || computeNeedsYou();
}

function createNeedsYouAPI(deps = {}) {
  const injected = Boolean(deps.getHealth || deps.queueFile || deps.readTasks || deps.getContent);
  return {
    list(req, res) {
      // Deps-injected instances (tests) bypass the module cache for isolation
      const data = injected ? computeNeedsYou(deps) : getNeedsYouCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { computeNeedsYou, createNeedsYouAPI, getNeedsYouCached };
