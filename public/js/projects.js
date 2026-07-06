/**
 * Mission Control Phase C — Projects (frontend)
 * Polls /api/mission/dev-projects every 60s. Card per project, warmest first.
 * Hook: window.MC_ProjectsInit(containerId)
 */
(function () {
  "use strict";

  const P = {
    state: { projects: [], asOf: null },
    pollInterval: null,
    POLL_MS: 60000,
    partialLoaded: false,
  };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Projects]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (P.partialLoaded) return;
    try {
      const res = await fetch("/partials/projects.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      P.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Projects.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/dev-projects");
    if (!data) return;
    P.state = data;
    render();
  }

  function relAge(iso) {
    if (!iso) return "no CC activity";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  }

  function render() {
    const sub = document.getElementById("mc-projects-sub");
    const asof = document.getElementById("mc-projects-asof");
    const grid = document.getElementById("mc-projects-grid");
    if (!grid) return;
    if (sub) sub.textContent = `${P.state.count || 0} tracked`;
    if (asof && P.state.asOf) asof.textContent = new Date(P.state.asOf).toLocaleTimeString();
    const projects = P.state.projects || [];
    grid.innerHTML = projects.length
      ? projects.map(cardHtml).join("")
      : '<div class="mc-empty">No PROJECT-MEMORY.json files found under ~/Dev.</div>';
  }

  function cardHtml(p) {
    const change = p.latestChange
      ? `<div class="mc-proj-change">↳ ${escapeHtml(p.latestChange.label || "")}${
          p.latestChange.date ? ` <span class="mc-proj-change-date">${escapeHtml(p.latestChange.date)}</span>` : ""
        }</div>`
      : "";
    const tasks =
      p.tasks && p.tasks.count
        ? `<div class="mc-proj-tasks"><span class="mc-proj-tasks-count">${p.tasks.count}</span> open · ${escapeHtml((p.tasks.items || [])[0] || "")}</div>`
        : "";
    const fresh = p.lastActivity && Date.now() - new Date(p.lastActivity).getTime() < 3 * 86400000;
    const obsidianUrl = p.dir ? `file://${encodeURI(p.dir)}` : null;
    return `
      <div class="mc-proj-card ${fresh ? "mc-proj-fresh" : ""}">
        <div class="mc-proj-top">
          <span class="mc-proj-name">${escapeHtml(p.name)}</span>
          <span class="mc-proj-age" title="Last Claude Code activity">${escapeHtml(relAge(p.lastActivity))}</span>
        </div>
        <div class="mc-proj-status">${escapeHtml(p.status || "—")}</div>
        ${change}
        ${tasks}
        ${obsidianUrl ? `<a class="mc-proj-open" href="${obsidianUrl}" title="Open folder">${escapeHtml(p.slug)} ↗</a>` : ""}
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
    if (P.pollInterval) clearInterval(P.pollInterval);
    P.pollInterval = setInterval(refresh, P.POLL_MS);
  }

  window.MC_Projects = P;
  window.MC_ProjectsInit = init;
})();
