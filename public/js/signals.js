/**
 * Mission Control Phase C — Signals / Research (frontend)
 * Polls /api/mission/signals every 60s. Ranked list, dismiss = light action.
 * Hook: window.MC_SignalsInit(containerId)
 */
(function () {
  "use strict";

  const S = {
    state: { signals: [], source: "queue", asOf: null },
    pollInterval: null,
    POLL_MS: 60000,
    partialLoaded: false,
  };

  const SOURCE_ICON = {
    reddit: "👽",
    youtube: "▶️",
    substack: "📰",
    exa: "🔍",
    tiktok: "🎵",
    twitter: "🐦",
  };

  async function fetchJson(url, opts = {}) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Signals]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (S.partialLoaded) return;
    try {
      const res = await fetch("/partials/signals.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      S.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Signals.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/signals");
    if (!data) return;
    S.state = data;
    render();
  }

  function render() {
    const sub = document.getElementById("mc-signals-sub");
    const asof = document.getElementById("mc-signals-asof");
    const list = document.getElementById("mc-signals-list");
    if (!list) return;
    if (sub) {
      sub.textContent =
        `${S.state.count || 0} signals` + (S.state.source === "queue" ? " · from queue (unscored)" : "");
    }
    if (asof && S.state.asOf) asof.textContent = new Date(S.state.asOf).toLocaleTimeString();
    const signals = S.state.signals || [];
    if (!signals.length) {
      list.innerHTML = '<div class="mc-empty">📭 No trend signals queued right now.</div>';
      return;
    }
    list.innerHTML = signals.map(rowHtml).join("");
    list.querySelectorAll("[data-signal-dismiss]").forEach((btn) => {
      btn.addEventListener("click", onDismiss);
    });
  }

  function rowHtml(s) {
    const icon = SOURCE_ICON[s.source] || "📌";
    const pillars = (s.pillars || [])
      .slice(0, 3)
      .map((p) => `<span class="mc-signal-pillar">${escapeHtml(p)}</span>`)
      .join("");
    const link = s.url
      ? `<a class="mc-signal-link" href="${escapeAttr(s.url)}" target="_blank" rel="noopener">open ↗</a>`
      : "";
    return `
      <div class="mc-signal-row mc-signal-prio-${escapeAttr(s.priority)}">
        <span class="mc-signal-icon" title="${escapeAttr(s.source)}">${icon}</span>
        <div class="mc-signal-body">
          <div class="mc-signal-topic">${escapeHtml(s.topic)}</div>
          <div class="mc-signal-meta">
            <span class="mc-signal-badge mc-signal-badge-${escapeAttr(s.priority)}">${escapeHtml(s.priority)}</span>
            ${pillars}
            ${link}
          </div>
        </div>
        <button class="mc-btn-icon" data-signal-dismiss data-id="${escapeAttr(s.id)}" title="Dismiss">✕</button>
      </div>`;
  }

  async function onDismiss(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const data = await fetchJson(`/api/mission/signals/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (data && data.ok) refresh();
  }

  function escapeHtml(text) {
    if (text == null) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }
  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, "&quot;");
  }

  async function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    await injectPartial(container);
    await refresh();
    if (S.pollInterval) clearInterval(S.pollInterval);
    S.pollInterval = setInterval(refresh, S.POLL_MS);
  }

  window.MC_Signals = S;
  window.MC_SignalsInit = init;
})();
