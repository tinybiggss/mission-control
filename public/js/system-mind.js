/**
 * Mission Control Phase B — The System Mind (frontend)
 *
 * - Polls /api/mission/system-mind every 60s (ledger changes slowly)
 * - Renders last night's dreaming consolidation + recent session summaries
 *
 * Hook: window.MC_SystemMindInit(containerId)
 */

(function () {
  "use strict";

  const Mind = {
    state: { mounted: true, sessions: [], consolidation: null, counts: {}, asOf: null },
    pollInterval: null,
    POLL_MS: 60000,
    partialLoaded: false,
  };

  const ENV_LABEL = { "claude-code": "Claude Code", corvus: "Corvus" };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[SystemMind]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Mind.partialLoaded) return;
    try {
      const res = await fetch("/partials/system-mind.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Mind.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load System Mind.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/system-mind");
    if (!data) return;
    Mind.state = data;
    render();
  }

  function render() {
    const sub = document.getElementById("mc-mind-sub");
    const asof = document.getElementById("mc-mind-asof");
    const body = document.getElementById("mc-mind-body");
    if (!body) return;

    if (Mind.state.mounted === false) {
      if (sub) sub.textContent = "";
      body.innerHTML =
        '<div class="mc-mind-down">🔌 Memory ledger volume is unmounted — cross-system memory is offline.</div>';
      return;
    }

    const c = Mind.state.counts || {};
    if (sub) {
      sub.textContent = `${c.sessions || 0} sessions · ${c.consolidations || 0} consolidations` +
        (c.stubs ? ` · ${c.stubs} stub` : "");
    }
    if (asof && Mind.state.asOf) asof.textContent = new Date(Mind.state.asOf).toLocaleTimeString();

    body.innerHTML = consolidationHtml(Mind.state.consolidation) + sessionsHtml(Mind.state.sessions);
  }

  function fieldBlock(label, icon, items) {
    if (!items || !items.length) return "";
    return `
      <div class="mc-mind-field">
        <div class="mc-mind-field-label">${icon} ${label}</div>
        <ul class="mc-mind-field-list">
          ${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}
        </ul>
      </div>`;
  }

  function consolidationHtml(con) {
    if (!con) return "";
    const fields =
      fieldBlock("Connections", "🔗", con.connections) +
      fieldBlock("Patterns", "🌀", con.patterns) +
      fieldBlock("Hypotheses", "💡", con.hypotheses) +
      fieldBlock("Tensions", "⚡", con.tensions) +
      fieldBlock("Recurring threads", "🧵", con.recurringThreads);
    if (!fields) return "";
    const meta = [con.date, con.sessionsReviewed ? `${con.sessionsReviewed} sessions` : null, con.model]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="mc-mind-consolidation">
        <div class="mc-mind-con-header">
          <span class="mc-mind-con-title">Last night's review</span>
          <span class="mc-mind-con-meta">${escapeHtml(meta)}</span>
        </div>
        <div class="mc-mind-fields">${fields}</div>
      </div>`;
  }

  function sessionsHtml(sessions) {
    if (!sessions || !sessions.length) return "";
    return `
      <div class="mc-mind-sessions">
        <div class="mc-mind-section-label">Recent sessions</div>
        ${sessions.map(sessionRow).join("")}
      </div>`;
  }

  function sessionRow(s) {
    const env = ENV_LABEL[s.environment] || s.environment;
    const proj = s.project
      ? `<span class="mc-badge mc-badge-project">${escapeHtml(s.project)}</span>`
      : "";
    const decisions = (s.decisions || [])
      .map((d) => `<li class="mc-mind-decision">✓ ${escapeHtml(d)}</li>`)
      .join("");
    const threads = (s.openThreads || [])
      .map((t) => `<li class="mc-mind-thread">↳ ${escapeHtml(t)}</li>`)
      .join("");
    const detail =
      decisions || threads ? `<ul class="mc-mind-session-detail">${decisions}${threads}</ul>` : "";
    return `
      <div class="mc-mind-session">
        <div class="mc-mind-session-top">
          <span class="mc-mind-session-env">${escapeHtml(env)}</span>
          ${proj}
          <span class="mc-mind-session-date">${escapeHtml(s.date || "")}</span>
        </div>
        <div class="mc-mind-session-summary">${escapeHtml(s.summary || "")}</div>
        ${detail}
      </div>`;
  }

  function escapeHtml(text) {
    if (text == null) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  async function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    await injectPartial(container);
    await refresh();
    if (Mind.pollInterval) clearInterval(Mind.pollInterval);
    Mind.pollInterval = setInterval(refresh, Mind.POLL_MS);
  }

  window.MC_SystemMind = Mind;
  window.MC_SystemMindInit = init;
})();
