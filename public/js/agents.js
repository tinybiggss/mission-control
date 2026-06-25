/**
 * Mission Control Phase 3 — Agent Observability (frontend)
 *
 * Renders a "Running Agents" panel that polls:
 *   - /api/mission/agents          (live; auto-refresh every 8s)
 *   - /api/mission/agents/history  (on-demand when user expands history)
 *
 * Stays vanilla JS, no build step. Mirrors patterns from public/js/mission-control.js.
 */

(function () {
  "use strict";

  const AG = {
    state: {
      agents: [],
      history: [],
      historyVisible: false,
      lastUpdated: null,
      lastHistoryUpdate: null,
    },
    POLL_MS: 8000,
    pollInterval: null,
  };

  // ============================================================================
  // PARTIAL INJECTION
  // ============================================================================

  async function injectPartial() {
    const container = document.getElementById("agents-panel-container");
    if (!container) return false;
    try {
      const res = await fetch("/partials/agents.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      container.innerHTML = html;
      console.log("[AG] Partial injected");
      return true;
    } catch (e) {
      console.error("[AG] Failed to inject partial:", e);
      container.innerHTML =
        '<div class="mc-error">Failed to load Agents panel.</div>';
      return false;
    }
  }

  // ============================================================================
  // API HELPERS
  // ============================================================================

  async function fetchJson(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[AG] ${url} → HTTP ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[AG] ${url} fetch error:`, e);
      return null;
    }
  }

  async function refreshAgents() {
    const data = await fetchJson("/api/mission/agents");
    if (data) {
      AG.state.agents = data.agents || [];
      AG.state.lastUpdated = new Date();
    }
  }

  async function refreshHistory() {
    const data = await fetchJson("/api/mission/agents/history");
    if (data) {
      AG.state.history = data.agents || [];
      AG.state.lastHistoryUpdate = new Date();
    }
  }

  // ============================================================================
  // FORMATTERS
  // ============================================================================

  function formatElapsed(seconds) {
    if (seconds == null) return "—";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function formatTimeAgo(iso) {
    if (!iso) return "—";
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  }

  function statusLabel(status) {
    switch (status) {
      case "running":
        return "running";
      case "completed":
        return "done";
      case "failed":
        return "failed";
      case "blocked":
        return "blocked";
      default:
        return status || "unknown";
    }
  }

  function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripModelPrefix(model) {
    if (!model) return null;
    return model.replace(/^ollama\//, "").replace(/^anthropic\//, "");
  }

  // ============================================================================
  // RENDERERS
  // ============================================================================

  function renderHeader() {
    const countEl = document.getElementById("mc-agents-count");
    const metaEl = document.getElementById("mc-agents-meta");
    if (countEl) {
      const count = AG.state.agents.length;
      countEl.textContent = count;
      countEl.dataset.zero = count === 0 ? "true" : "false";
    }
    if (metaEl) {
      if (AG.state.lastUpdated) {
        metaEl.textContent = `updated ${AG.state.lastUpdated.toLocaleTimeString()}`;
      } else {
        metaEl.textContent = "—";
      }
    }
  }

  function renderAgents() {
    const list = document.getElementById("mc-agents-list");
    if (!list) return;

    const agents = AG.state.agents;
    if (!agents || agents.length === 0) {
      list.innerHTML =
        '<div class="mc-empty mc-empty-sm">No agents running. Quiet waters. 🌊</div>';
      return;
    }

    list.innerHTML = agents
      .map((a) => {
        const model = stripModelPrefix(a.model);
        const safeName = escapeHtml(a.name || a.runId || "(unnamed)");
        return `
        <div class="mc-agent-row" data-status="${escapeHtml(a.status)}" data-run-id="${escapeHtml(a.runId)}" data-name="${escapeHtml(a.name || "")}">
          <div class="mc-agent-status-dot" title="${escapeHtml(statusLabel(a.status))}"></div>
          <div class="mc-agent-body">
            <div class="mc-agent-name" title="${safeName}">${safeName}</div>
            <div class="mc-agent-meta-line">
              ${model ? `<span class="mc-agent-meta-pill">🤖 ${escapeHtml(model)}</span>` : ""}
              <span class="mc-agent-meta-pill">${escapeHtml(statusLabel(a.status))}</span>
              ${a.requesterOrigin?.channel ? `<span class="mc-agent-meta-pill">📡 ${escapeHtml(a.requesterOrigin.channel)}</span>` : ""}
            </div>
          </div>
          <div class="mc-agent-elapsed">${escapeHtml(formatElapsed(a.elapsedSeconds))}</div>
        </div>
      `;
      })
      .join("");
  }

  function renderHistory() {
    const list = document.getElementById("mc-agents-history-list");
    if (!list) return;

    const items = AG.state.history;
    if (!items || items.length === 0) {
      list.innerHTML =
        '<div class="mc-empty mc-empty-sm">No agents completed in the last 7 days.</div>';
      return;
    }

    list.innerHTML = items
      .slice(0, 50)
      .map((a) => {
        const model = stripModelPrefix(a.model);
        const safeName = escapeHtml(a.name || a.runId || "(unnamed)");
        const ts = a.completedAt || a.startedAt;
        return `
        <div class="mc-agent-history-row" data-status="${escapeHtml(a.status)}" data-name="${safeName}">
          <span class="mc-agent-status-dot"></span>
          <span class="mc-agent-history-name" title="${safeName}">${safeName}</span>
          ${model ? `<span class="mc-agent-meta-pill">${escapeHtml(model)}</span>` : ""}
          <span class="mc-agent-history-time">${escapeHtml(formatTimeAgo(ts))}</span>
        </div>
      `;
      })
      .join("");
  }

  function renderAll() {
    renderHeader();
    renderAgents();
    if (AG.state.historyVisible) renderHistory();
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async function init() {
    console.log("[AG] Initializing Agents panel…");
    const ok = await injectPartial();
    if (!ok) return;

    // Wire history toggle
    const toggleBtn = document.getElementById("mc-agents-show-history");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", async () => {
        AG.state.historyVisible = !AG.state.historyVisible;
        const panel = document.getElementById("mc-agents-history");
        if (panel) panel.hidden = !AG.state.historyVisible;
        toggleBtn.textContent = AG.state.historyVisible
          ? "📜 Hide history"
          : "📜 Show recent history";
        if (AG.state.historyVisible && AG.state.history.length === 0) {
          await refreshHistory();
        }
        renderHistory();
      });
    }

    // Wire history refresh
    const historyRefresh = document.getElementById("mc-agents-history-refresh");
    if (historyRefresh) {
      historyRefresh.addEventListener("click", async () => {
        await refreshHistory();
        renderHistory();
      });
    }

    // Click on a row → fetch detail (for now, console-log; future: modal)
    const list = document.getElementById("mc-agents-list");
    if (list) {
      list.addEventListener("click", async (e) => {
        const row = e.target.closest(".mc-agent-row");
        if (!row) return;
        const runId = row.dataset.runId;
        if (!runId) return;
        const detail = await fetchJson(`/api/mission/agents/${encodeURIComponent(runId)}`);
        if (detail) {
          console.log("[AG] Agent detail:", detail);
          // Future: open a modal with full details
        }
      });
    }

    // Initial render
    await refreshAgents();
    renderAll();

    // Polling
    if (AG.pollInterval) clearInterval(AG.pollInterval);
    AG.pollInterval = setInterval(async () => {
      await refreshAgents();
      renderAll();
    }, AG.POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for debugging
  window.MissionControlAgents = AG;
})();