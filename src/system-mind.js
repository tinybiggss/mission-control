/**
 * Mission Control Phase B — The System Mind
 *
 * Surfaces the cross-system memory ledger — the handoff bus between Claude Code
 * and Corvus — that was previously invisible unless you opened Obsidian:
 *
 *   - Recent session summaries (what got done, per project/environment).
 *   - Last night's "dreaming" consolidation: the connections / patterns /
 *     hypotheses / tensions / recurring-threads the nightly review surfaced.
 *
 * Source: /Volumes/MacMini_Extended/llm-memory/memory.jsonl (JSONL, one entry
 * per line). Windowed on the `date` field, newest first. `status:"stub"` rows
 * (in-progress placeholders) are dropped. If the external volume is unmounted,
 * returns { mounted:false } so the panel can show a clear down-state.
 *
 * Endpoint: GET /api/mission/system-mind
 */

const fs = require("fs");

const LEDGER_VOLUME = "/Volumes/MacMini_Extended";
const LEDGER_FILE = `${LEDGER_VOLUME}/llm-memory/memory.jsonl`;

const MAX_SESSIONS = 12; // recent session summaries to surface
const MAX_ITEMS_PER_FIELD = 4; // cap consolidation list fields for a scannable panel

let cache = { data: null, timestamp: 0, refreshing: false };
const TTL_MS = 60000;

// ============================================================================
// READ + SHAPE
// ============================================================================

function readLedger() {
  // Returns { mounted, entries }. Never throws.
  if (!fs.existsSync(LEDGER_FILE)) {
    return { mounted: fs.existsSync(LEDGER_VOLUME), entries: [] };
  }
  const entries = [];
  try {
    const raw = fs.readFileSync(LEDGER_FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e === "object") entries.push(e);
      } catch {
        // skip malformed line
      }
    }
  } catch (e) {
    console.error("[system-mind] ledger read failed:", e.message);
  }
  return { mounted: true, entries };
}

const byDateDesc = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));

function shapeSession(e) {
  return {
    id: e.id,
    date: e.date,
    environment: e.environment || "unknown",
    project: e.project || (Array.isArray(e.projects) ? e.projects.join(", ") : "") || "",
    summary: (e.summary || "").trim(),
    decisions: (e.decisions || [])
      .map((d) => (typeof d === "string" ? d : d && (d.summary || d.decision)) || "")
      .filter((s) => s && s.trim())
      .slice(0, 3),
    openThreads: (e.open_threads || []).filter((t) => String(t).trim()).slice(0, 2),
    topics: (e.topics || []).slice(0, 5),
    obsidianNote: e.obsidian_note || null,
  };
}

function shapeConsolidation(e) {
  if (!e) return null;
  const pick = (field) =>
    (e[field] || [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, MAX_ITEMS_PER_FIELD);
  return {
    date: e.date,
    model: e.model || e.generated_by || null,
    sessionsReviewed: e.sessions_reviewed || null,
    connections: pick("connections"),
    patterns: pick("patterns"),
    hypotheses: pick("hypotheses"),
    tensions: pick("tensions"),
    recurringThreads: pick("recurring_threads"),
    obsidianNote: e.obsidian_note || null,
  };
}

function computeSystemMind() {
  const { mounted, entries } = readLedger();
  if (!mounted) {
    return { mounted: false, asOf: new Date().toISOString() };
  }

  const live = entries.filter((e) => e.status !== "stub");
  const stubCount = entries.length - live.length;

  const sessions = live
    .filter((e) => e.type === "session_summary")
    .sort(byDateDesc)
    .slice(0, MAX_SESSIONS)
    .map(shapeSession);

  const consolidation = shapeConsolidation(
    live.filter((e) => e.type === "consolidation").sort(byDateDesc)[0],
  );

  return {
    mounted: true,
    sessions,
    consolidation,
    counts: {
      total: entries.length,
      sessions: live.filter((e) => e.type === "session_summary").length,
      consolidations: live.filter((e) => e.type === "consolidation").length,
      stubs: stubCount,
    },
    asOf: new Date().toISOString(),
  };
}

// ============================================================================
// CACHE
// ============================================================================

function refreshSystemMindAsync() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  try {
    cache.data = computeSystemMind();
    cache.timestamp = Date.now();
  } catch (e) {
    console.error("[system-mind] compute failed:", e.message);
  } finally {
    cache.refreshing = false;
  }
}

function getSystemMindCached() {
  if (!cache.data || Date.now() - cache.timestamp > TTL_MS) {
    refreshSystemMindAsync();
  }
  return cache.data || computeSystemMind();
}

// ============================================================================
// HTTP
// ============================================================================

function createSystemMindAPI(_deps = {}) {
  return {
    list(req, res) {
      const data = getSystemMindCached();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data, null, 2));
    },
  };
}

module.exports = { createSystemMindAPI, getSystemMindCached, refreshSystemMindAsync, computeSystemMind };
