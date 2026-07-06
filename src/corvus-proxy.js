/**
 * Mission Control Phase C — Content pipeline (Corvus proxy)
 *
 * Proxies the already-running corvus-dashboard (localhost:4321) server-side so
 * the RT content pipeline shows up in Mission Control without re-implementing
 * it. Proxying server-side (not from the browser) means the panel degrades to a
 * clean { up:false } down-state when corvus-dashboard is stopped.
 *
 *   GET :4321/api/drafts          → [{ path, name, mtime, contentType, phase }]
 *   GET :4321/api/sessions/latest → { session: { article_id, last_activity, … } }
 *
 * Drafts are grouped by editorial phase (PASS 1/2/3 → adapted → published),
 * inferred from the `phase` field, so the panel reads as a pipeline.
 *
 * Endpoint: GET /api/mission/content
 */

const http = require("http");

const CORVUS_HOST = "127.0.0.1";
const CORVUS_PORT = 4321;
const REQ_TIMEOUT_MS = 2500;

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 30000;

// ============================================================================
// HTTP GET (promise, bounded, never throws)
// ============================================================================

function getJson(pathname) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: CORVUS_HOST, port: CORVUS_PORT, path: pathname, timeout: REQ_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

// ============================================================================
// SHAPE
// ============================================================================

// Map a corvus "phase" string onto a coarse pipeline stage for grouping.
function stageFor(draft) {
  const phase = String(draft.phase || "").toLowerCase();
  const type = String(draft.contentType || "").toLowerCase();
  if (phase.includes("publish") || type.includes("published")) return "published";
  if (phase.includes("schedul")) return "scheduled";
  if (type.includes("adapt") || phase.includes("adapt")) return "adapted";
  return "draft";
}

const STAGE_ORDER = ["draft", "adapted", "scheduled", "published"];

async function computeContent() {
  const [draftsRaw, sessionRaw] = await Promise.all([
    getJson("/api/drafts"),
    getJson("/api/sessions/latest"),
  ]);

  if (draftsRaw == null && sessionRaw == null) {
    return { up: false, asOf: new Date().toISOString() };
  }

  const drafts = Array.isArray(draftsRaw) ? draftsRaw : [];
  const stages = { draft: [], adapted: [], scheduled: [], published: [] };
  for (const d of drafts) {
    const item = {
      name: d.name || d.path,
      path: d.path || null,
      folder: d.date || null, // corvus puts the folder name in `date`
      contentType: d.contentType || null,
      phase: d.phase || null,
      mtime: d.mtime || null,
    };
    (stages[stageFor(d)] || stages.draft).push(item);
  }
  // Newest first within each stage.
  for (const k of STAGE_ORDER) {
    stages[k].sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || "")));
  }

  const s = sessionRaw && sessionRaw.session;
  const latestSession = s
    ? {
        articleId: s.article_id || null,
        lastActivity: s.last_activity || null,
        messageCount: s.message_count || 0,
      }
    : null;

  return {
    up: true,
    stages,
    stageOrder: STAGE_ORDER,
    total: drafts.length,
    latestSession,
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE + HTTP
// ============================================================================

function refreshContentAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  computeContent()
    .then((data) => {
      cache.data = data;
      cache.timestamp = Date.now();
    })
    .catch((e) => console.error("[corvus-proxy] compute failed:", e.message))
    .finally(() => {
      cache.refreshing = false;
    });
}

function getContentCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshContentAsync();
  }
  // May be null on the very first hit before the async populates; return a
  // safe placeholder so the handler always sends valid JSON.
  return cache.data || { up: null, loading: true, asOf: new Date().toISOString() };
}

function createContentAPI(_deps = {}) {
  return {
    list(req, res) {
      const data = getContentCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { createContentAPI, getContentCached, refreshContentAsync, computeContent };
