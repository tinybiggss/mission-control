/**
 * Mission Control Phase A — Health / Ops self-monitor (frontend)
 *
 * - Polls /api/mission/health every 15s
 * - Renders a green/amber/red status grid of the audit's silent-failure checks
 *
 * Hook: window.MC_HealthInit(containerId)
 */

(function () {
  "use strict";

  const Health = {
    state: { overall: null, counts: {}, checks: [], asOf: null },
    pollInterval: null,
    POLL_MS: 15000,
    partialLoaded: false,
  };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Health]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Health.partialLoaded) return;
    try {
      const res = await fetch("/partials/health.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Health.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Health panel.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/health");
    if (!data) return;
    Health.state = data;
    render();
  }

  function statusClass(check) {
    if (check.ok) return "ok";
    return check.severity === "error" ? "error" : "warn";
  }

  function statusIcon(cls) {
    return cls === "ok" ? "🟢" : cls === "warn" ? "🟡" : "🔴";
  }

  function render() {
    const dot = document.getElementById("mc-health-overall-dot");
    const summary = document.getElementById("mc-health-summary");
    const asof = document.getElementById("mc-health-asof");
    const grid = document.getElementById("mc-health-grid");
    if (!grid) return;

    const overall = Health.state.overall || "ok";
    if (dot) dot.className = `mc-health-dot mc-health-dot-${overall}`;
    if (summary) {
      const c = Health.state.counts || {};
      summary.textContent =
        overall === "ok"
          ? `All ${c.total || 0} checks green`
          : `${c.errors || 0} failing · ${c.warnings || 0} warning · ${c.ok || 0} ok`;
    }
    if (asof && Health.state.asOf) {
      asof.textContent = new Date(Health.state.asOf).toLocaleTimeString();
    }

    const checks = Health.state.checks || [];
    if (!checks.length) {
      grid.innerHTML = '<div class="mc-empty">No health data.</div>';
      return;
    }
    grid.innerHTML = checks.map(cardHtml).join("");
  }

  function cardHtml(check) {
    const cls = statusClass(check);
    const value = check.value
      ? `<span class="mc-health-value">${escapeHtml(check.value)}</span>`
      : "";
    return `
      <div class="mc-health-card mc-health-${cls}">
        <div class="mc-health-card-top">
          <span class="mc-health-icon">${statusIcon(cls)}</span>
          <span class="mc-health-label">${escapeHtml(check.label)}</span>
          ${value}
        </div>
        <div class="mc-health-detail">${escapeHtml(check.detail || "")}</div>
      </div>
    `;
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
    if (Health.pollInterval) clearInterval(Health.pollInterval);
    Health.pollInterval = setInterval(refresh, Health.POLL_MS);
  }

  window.MC_Health = Health;
  window.MC_HealthInit = init;
})();
