/**
 * Mission Control Phase C — Content pipeline (frontend)
 * Polls /api/mission/content every 30s. Columns by editorial stage.
 * Hook: window.MC_ContentInit(containerId)
 */
(function () {
  "use strict";

  const C = {
    state: { up: null, stages: {}, stageOrder: [], asOf: null },
    pollInterval: null,
    POLL_MS: 30000,
    partialLoaded: false,
  };

  const STAGE_LABEL = {
    draft: "📝 Drafts",
    adapted: "🔀 Adapted",
    scheduled: "📅 Scheduled",
    published: "🚀 Published",
  };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Content]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (C.partialLoaded) return;
    try {
      const res = await fetch("/partials/content.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      C.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Content pipeline.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/content");
    if (!data) return;
    C.state = data;
    render();
  }

  function render() {
    const sub = document.getElementById("mc-content-sub");
    const asof = document.getElementById("mc-content-asof");
    const body = document.getElementById("mc-content-body");
    if (!body) return;
    if (asof && C.state.asOf) asof.textContent = new Date(C.state.asOf).toLocaleTimeString();

    if (C.state.up === false) {
      if (sub) sub.textContent = "";
      body.innerHTML =
        '<div class="mc-mind-down">🔌 corvus-dashboard (:4321) is not responding — content pipeline offline.</div>';
      return;
    }
    if (C.state.loading || C.state.up == null) {
      body.innerHTML = '<div class="mc-empty">Loading…</div>';
      return;
    }

    const order = C.state.stageOrder || ["draft", "adapted", "scheduled", "published"];
    const stages = C.state.stages || {};
    if (sub) {
      const sess = C.state.latestSession;
      sub.textContent =
        `${C.state.total || 0} items` +
        (sess && sess.articleId ? ` · latest: ${sess.articleId}` : "");
    }
    body.innerHTML = `<div class="mc-content-cols">${order
      .map((stage) => columnHtml(stage, stages[stage] || []))
      .join("")}</div>`;
  }

  function columnHtml(stage, items) {
    const rows = items.length
      ? items
          .slice(0, 12)
          .map(
            (it) =>
              `<div class="mc-content-item" title="${escapeAttr(it.path || it.name)}">
                 <span class="mc-content-item-name">${escapeHtml(it.name)}</span>
                 ${it.phase ? `<span class="mc-content-phase">${escapeHtml(it.phase)}</span>` : ""}
               </div>`,
          )
          .join("")
      : '<div class="mc-content-empty">—</div>';
    return `
      <div class="mc-content-col">
        <div class="mc-content-col-head">${STAGE_LABEL[stage] || stage} <span class="mc-content-col-count">${items.length}</span></div>
        <div class="mc-content-col-body">${rows}</div>
      </div>`;
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
    if (C.pollInterval) clearInterval(C.pollInterval);
    C.pollInterval = setInterval(refresh, C.POLL_MS);
  }

  window.MC_Content = C;
  window.MC_ContentInit = init;
})();
