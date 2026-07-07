/**
 * Mission Control Phase 2 — Corvus dispatch
 *
 * Turns the dashboard from a readout into a cockpit: POST /api/mission/dispatch
 * appends an entry to Corvus's live capture queue
 * (~/.openclaw/workspace/Corvus/Operations/capture-queue.json), which the
 * heartbeat DISCOVER phase already consumes — no new API surface on the
 * Corvus side, and Corvus's own ask-first rules still govern execution.
 *
 * Intent vocabulary (from the vault's MIKE-CORVUS-COMMUNICATION doc):
 *   capture  → save for tomorrow's standup   (discussion_item)
 *   research → do overnight, report back     (action_item, "research: " prefix)
 *   draft    → just do it                    (action_item, "draft: " prefix)
 *
 * Writes are atomic (temp + rename) because the heartbeat may read the file
 * concurrently. Worst case of a bad dispatch is a junk inbox item Mike can
 * tell Corvus "done" about — nothing executes without Corvus's own gates.
 */

const fs = require("fs");

const QUEUE_FILE = "/Users/michaeljones/.openclaw/workspace/Corvus/Operations/capture-queue.json";
const MAX_TEXT = 2000;

const INTENTS = {
  capture: { capture_type: "discussion_item", prefix: "" },
  research: { capture_type: "action_item", prefix: "research: " },
  draft: { capture_type: "action_item", prefix: "draft: " },
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildCaptureEntry({ intent, text, context }, now = new Date()) {
  const spec = INTENTS[intent];
  const iso = now.toISOString();
  return {
    id: `mc-dispatch-${iso.slice(0, 10)}-${slugify(text) || "item"}-${Math.random().toString(36).slice(2, 6)}`,
    captured_at: iso,
    source: "mission-control",
    capture_type: spec.capture_type,
    content: spec.prefix + String(text).trim() + (context ? ` [context: ${String(context).trim()}]` : ""),
  };
}

function appendCapture(file, entry) {
  let queue = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) queue = parsed;
  } catch {
    // missing or corrupt file — start fresh rather than blocking the dispatch
  }
  queue.push(entry);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(queue, null, 2) + "\n");
  fs.renameSync(tmp, file); // atomic on the same volume
  return queue.length;
}

function createDispatchAPI(deps = {}) {
  const queueFile = deps.queueFile || QUEUE_FILE;

  return {
    /**
     * POST /api/mission/dispatch   { intent, text, context? }
     */
    dispatch(req, res) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { intent, text, context } = JSON.parse(body);
          if (!INTENTS[intent]) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `intent must be one of: ${Object.keys(INTENTS).join(", ")}` }));
            return;
          }
          if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `text is required (non-empty, ≤ ${MAX_TEXT} chars)` }));
            return;
          }
          const entry = buildCaptureEntry({ intent, text, context });
          const queueLength = appendCapture(queueFile, entry);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, id: entry.id, queueLength }, null, 2));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
    },
  };
}

module.exports = { buildCaptureEntry, appendCapture, createDispatchAPI, INTENTS };
