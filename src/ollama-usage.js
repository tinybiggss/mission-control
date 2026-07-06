/**
 * Ollama Usage — Transcript-based usage stats for Ollama cloud models.
 *
 * Parses session .jsonl files to extract per-message token counts and model usage.
 * Replaces the broken openclaw status --usage approach which requires Anthropic OAuth.
 */

const fs = require("fs");
const path = require("path");

// Cache for Ollama usage data
let ollamaUsageCache = { data: null, timestamp: 0, refreshing: false };
const OLLAMA_CACHE_TTL_MS = 60000; // 60 seconds

function getOllamaDir() {
  return path.join(process.env.HOME || "/Users/michaeljones", ".openclaw");
}

function getSessionsDir() {
  return path.join(getOllamaDir(), "agents", "main", "sessions");
}

/**
 * Parse a single .jsonl session file for Ollama usage data.
 * Returns array of {model, input, output, cacheRead, cacheWrite, totalTokens, cost, timestamp} entries.
 */
function parseSessionFile(filePath, cutoffMs) {
  const entries = [];
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        // Only look at assistant messages with usage data
        if (entry.type !== "message" || !entry.message) continue;
        const msg = entry.message;
        if (msg.role !== "assistant" || !msg.usage) continue;

        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        if (ts < cutoffMs) continue;

        const usage = msg.usage;
        if (!usage.totalTokens && !usage.input && !usage.output) continue;

        entries.push({
          model: msg.model || (msg.provider === "ollama" ? "ollama-unknown" : "unknown"),
          provider: msg.provider || "unknown",
          input: usage.input || 0,
          output: usage.output || 0,
          cacheRead: usage.cacheRead || 0,
          cacheWrite: usage.cacheWrite || 0,
          totalTokens: usage.totalTokens || (usage.input || 0) + (usage.output || 0),
          cost: usage.cost?.total || 0,
          timestamp: ts,
        });
      } catch (e) {
        /* skip invalid lines */
      }
    }
  } catch (e) {
    /* skip unreadable files */
  }
  return entries;
}

/**
 * Aggregate Ollama usage across all sessions for given time windows.
 */
function getOllamaUsage() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const threeDaysMs = 3 * dayMs;
  const sevenDaysMs = 7 * dayMs;

  const cutoff24h = now - dayMs;
  const cutoff3d = now - threeDaysMs;
  const cutoff7d = now - sevenDaysMs;

  const sessionsDir = getSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    return { models: {}, routing: {}, timestamp: new Date().toISOString(), source: "ollama-transcripts" };
  }

  // Aggregate by model + time window
  const modelAgg = {}; // model -> {24h, 3d, 7d}
  let totalRequests7d = 0;
  let totalRequests3d = 0;
  let totalRequests24h = 0;

  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of files) {
    const filePath = path.join(sessionsDir, file);
    try {
      const stat = fs.statSync(filePath);
      // Skip files not modified in last 7 days
      if (stat.mtimeMs < cutoff7d) continue;
    } catch (e) {
      continue;
    }

    // Parse 7-day window (broadest)
    const entries7d = parseSessionFile(filePath, cutoff7d);

    for (const entry of entries7d) {
      if (!modelAgg[entry.model]) {
        modelAgg[entry.model] = {
          tokens24h: { input: 0, output: 0, total: 0 },
          tokens3d: { input: 0, output: 0, total: 0 },
          tokens7d: { input: 0, output: 0, total: 0 },
          requests24h: 0,
          requests3d: 0,
          requests7d: 0,
          cost7d: 0,
        };
      }
      const m = modelAgg[entry.model];

      // Always add to 7d
      m.tokens7d.input += entry.input;
      m.tokens7d.output += entry.output;
      m.tokens7d.total += entry.totalTokens;
      m.requests7d++;
      m.cost7d += entry.cost;
      totalRequests7d++;

      // Add to 3d if within window
      if (entry.timestamp >= cutoff3d) {
        m.tokens3d.input += entry.input;
        m.tokens3d.output += entry.output;
        m.tokens3d.total += entry.totalTokens;
        m.requests3d++;
        totalRequests3d++;
      }

      // Add to 24h if within window
      if (entry.timestamp >= cutoff24h) {
        m.tokens24h.input += entry.input;
        m.tokens24h.output += entry.output;
        m.tokens24h.total += entry.totalTokens;
        m.requests24h++;
        totalRequests24h++;
      }
    }
  }

  // Compute averages
  for (const model of Object.values(modelAgg)) {
    model.avgTokensPerRequest7d =
      model.requests7d > 0 ? Math.round(model.tokens7d.total / model.requests7d) : 0;
  }

  // Routing by model
  const routingByModel = {};
  for (const [name, data] of Object.entries(modelAgg)) {
    routingByModel[name] = {
      requests7d: data.requests7d,
      requests3d: data.requests3d,
      requests24h: data.requests24h,
      pct7d: totalRequests7d > 0 ? Math.round((data.requests7d / totalRequests7d) * 100) : 0,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    source: "ollama-transcripts",
    models: modelAgg,
    routing: {
      total7d: totalRequests7d,
      total3d: totalRequests3d,
      total24h: totalRequests24h,
      byModel: routingByModel,
    },
  };
}

/**
 * Get cached Ollama usage, refreshing in background if stale.
 */
function getOllamaUsageCached() {
  const now = Date.now();
  if (!ollamaUsageCache.data || now - ollamaUsageCache.timestamp > OLLAMA_CACHE_TTL_MS) {
    refreshOllamaUsageAsync();
  }
  return ollamaUsageCache.data;
}

function refreshOllamaUsageAsync() {
  if (ollamaUsageCache.refreshing) return;
  ollamaUsageCache.refreshing = true;
  try {
    const data = getOllamaUsage();
    ollamaUsageCache.data = data;
    ollamaUsageCache.timestamp = Date.now();
    const modelCount = Object.keys(data.models).length;
    console.log(`[Ollama Usage] Refreshed: ${modelCount} models, ${data.routing.total7d} requests (7d)`);
  } catch (e) {
    console.error("[Ollama Usage] Refresh failed:", e.message);
  }
  ollamaUsageCache.refreshing = false;
}

module.exports = {
  getOllamaUsage,
  getOllamaUsageCached,
  refreshOllamaUsageAsync,
};