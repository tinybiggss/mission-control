/**
 * Mission Control Phase 3 — Unified Ops Registry (frontend)
 *
 * - Polls /api/mission/ops every 60s
 * - Roll-up strip is always visible; opening it reveals the timeline +
 *   the full board grouped by scheduler (OpenClaw crons / LaunchAgents /
 *   crontab). Quiet when green, loud when failing.
 *
 * Hook: window.MC_OpsInit(containerId)
 */

(function () {
  "use strict";

  const Ops = { state: null, pollInterval: null, POLL_MS: 60000, partialLoaded: false };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Ops]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Ops.partialLoaded) return;
    try {
      const res = await fetch("/partials/ops.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Ops.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Operations.</div>';
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  const DOT = {
    ok: "🟢",
    running: "🟢",
    failing: "🔴",
    parked: "⏸️",
    disabled: "⚪",
    "not-loaded": "🟡",
  };

  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function summaryHtml(s, groups) {
    const bits = [`${s.total} scheduled`, `${s.ok + s.running} ok`];
    if (s.failing) {
      const names = [...groups.openclawCron, ...groups.launchAgents, ...groups.crontab]
        .filter((i) => i.status === "failing")
        .map((i) => i.name);
      bits.push(`<span class="mc-ops-failing">${s.failing} failing: ${esc(names.join(", "))}</span>`);
    }
    if (s.parked) bits.push(`${s.parked} parked`);
    if (s.disabled) bits.push(`${s.disabled} disabled`);
    return bits.join(" · ");
  }

  function timelineHtml(t) {
    if (!t) return "";
    const recent = t.recent.length
      ? `last 12h: ${t.recent.length} runs (${t.recent
          .slice(0, 4)
          .map((r) => esc(r.name))
          .join(", ")}${t.recent.length > 4 ? ", …" : ""})`
      : "last 12h: no runs";
    const upcoming = t.upcoming.length
      ? ` · next up: ${t.upcoming
          .slice(0, 3)
          .map((u) => `${esc(u.name)} ${fmtTime(u.at)}`)
          .join(", ")}`
      : "";
    return recent + upcoming;
  }

  function rowHtml(i) {
    return `<div class="mc-ops-row mc-ops-${esc(i.status)}">
      <span class="mc-ops-dot">${DOT[i.status] || "⚪"}</span>
      <span class="mc-ops-name">${esc(i.name)}</span>
      <span class="mc-ops-sched">${esc(i.schedule)}</span>
      <span class="mc-ops-detail">${esc(i.detail || "")}</span>
    </div>`;
  }

  function groupHtml(title, items) {
    if (!items || !items.length) return "";
    // Failing first, then running/ok, parked/disabled last
    const order = { failing: 0, "not-loaded": 1, running: 2, ok: 3, parked: 4, disabled: 5 };
    const sorted = [...items].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    return `<div class="mc-ops-group">
      <div class="mc-ops-group-title">${esc(title)} (${items.length})</div>
      ${sorted.map(rowHtml).join("")}
    </div>`;
  }

  function render() {
    const s = Ops.state;
    const summary = document.getElementById("mc-ops-summary");
    if (!summary || !s) return;
    summary.innerHTML = summaryHtml(s.summary, s.groups);
    document.getElementById("mc-ops-timeline").innerHTML = timelineHtml(s.timeline);
    document.getElementById("mc-ops-board").innerHTML =
      groupHtml("OpenClaw crons", s.groups.openclawCron) +
      groupHtml("LaunchAgents", s.groups.launchAgents) +
      groupHtml("crontab", s.groups.crontab) +
      Object.entries(s.sources)
        .filter(([, v]) => v !== "ok")
        .map(([k, v]) => `<div class="mc-ops-source-err">⚠ ${esc(k)} source: ${esc(v)}</div>`)
        .join("");
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/ops");
    if (!data) return;
    Ops.state = data;
    render();
  }

  window.MC_OpsInit = async function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    await injectPartial(container);
    await refresh();
    if (Ops.pollInterval) clearInterval(Ops.pollInterval);
    Ops.pollInterval = setInterval(refresh, Ops.POLL_MS);
  };
})();
