/**
 * Mission Control Phase D — Automation schedule board (frontend)
 * Polls /api/mission/agents/schedule every 30s. OpenClaw cron jobs, failing +
 * upcoming first. Hook: window.MC_ScheduleInit(containerId)
 */
(function () {
  "use strict";

  const S = {
    state: { jobs: [], summary: {}, asOf: null },
    pollInterval: null,
    POLL_MS: 30000,
    partialLoaded: false,
  };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Schedule]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (S.partialLoaded) return;
    try {
      const res = await fetch("/partials/schedule.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      S.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load schedule.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/agents/schedule");
    if (!data) return;
    S.state = data;
    render();
  }

  function jobStatus(j) {
    if (!j.enabled) return "disabled";
    if ((j.consecutiveErrors || 0) > 0 || j.lastStatus === "error" || j.lastStatus === "failed")
      return "failing";
    if (j.nextRun === "overdue") return "overdue";
    return "ok";
  }

  const DOT = { ok: "🟢", failing: "🔴", overdue: "🟡", disabled: "⚪" };

  function render() {
    const sub = document.getElementById("mc-schedule-sub");
    const asof = document.getElementById("mc-schedule-asof");
    const list = document.getElementById("mc-schedule-list");
    if (!list) return;
    const s = S.state.summary || {};
    if (sub)
      sub.textContent = `${s.enabled || 0} active · ${s.failing || 0} failing · ${s.disabled || 0} off`;
    if (asof && S.state.asOf) asof.textContent = new Date(S.state.asOf).toLocaleTimeString();

    const jobs = S.state.jobs || [];
    if (!jobs.length) {
      list.innerHTML = '<div class="mc-empty">No cron jobs found.</div>';
      return;
    }
    list.innerHTML = jobs.map(rowHtml).join("");
  }

  function rowHtml(j) {
    const st = jobStatus(j);
    const errBadge =
      (j.consecutiveErrors || 0) > 0
        ? `<span class="mc-sched-err">${j.consecutiveErrors}× fail</span>`
        : "";
    return `
      <div class="mc-sched-row mc-sched-${st}">
        <span class="mc-sched-dot">${DOT[st]}</span>
        <span class="mc-sched-name" title="${escapeAttr(j.description || "")}">${escapeHtml(j.name)}</span>
        <span class="mc-sched-when">${escapeHtml(j.scheduleHuman || j.schedule || "—")}</span>
        <span class="mc-sched-next">next ${escapeHtml(j.nextRun || "—")}</span>
        <span class="mc-sched-last">${escapeHtml(j.lastRunStr || "never")}</span>
        ${errBadge}
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
    if (S.pollInterval) clearInterval(S.pollInterval);
    S.pollInterval = setInterval(refresh, S.POLL_MS);
  }

  window.MC_Schedule = S;
  window.MC_ScheduleInit = init;
})();
