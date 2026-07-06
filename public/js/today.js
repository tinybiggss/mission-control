/**
 * Mission Control Phase 4 — Today view (frontend)
 *
 * - Polls /api/mission/today every 8s
 * - Renders list grouped by overdue/today/no-due
 * - Priority filter chips
 * - Mode badge per row
 *
 * Hooks: window.MC_Today.init(containerId) — call from mission-control.js
 */

(function () {
  "use strict";

  const Today = {
    state: {
      tasks: [],
      counts: {},
      today: null,
      asOf: null,
      filterPriority: "all",
      brief: null,
      obsidianTasks: [],
    },
    pollInterval: null,
    POLL_MS: 8000,
    partialLoaded: false,
  };

  async function fetchJson(url, opts = {}) {
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opts,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Today]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Today.partialLoaded) return;
    try {
      const res = await fetch("/partials/today.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Today.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Today view.</div>';
    }
  }

  async function refresh() {
    const params = new URLSearchParams();
    if (Today.state.filterPriority !== "all") {
      params.set("priority", Today.state.filterPriority);
    }
    const qs = params.toString();
    const data = await fetchJson("/api/mission/today" + (qs ? `?${qs}` : ""));
    if (!data) return;
    Today.state.tasks = data.tasks || [];
    Today.state.counts = {
      planning: data.planningCount,
      mixed: data.mixedCount,
      autonomous: data.autonomousCount,
      legacy: data.legacyCount,
    };
    Today.state.today = data.today;
    Today.state.asOf = data.asOf;
    Today.state.brief = data.brief || null;
    Today.state.obsidianTasks = data.obsidianTasks || [];
    render();
  }

  function render() {
    renderHeader();
    renderStats();
    renderBrief();
    renderFilter();
    renderList();
    renderObsidian();
  }

  function renderBrief() {
    const el = document.getElementById("mc-today-brief");
    if (!el) return;
    const b = Today.state.brief;
    if (!b || !b.summary) {
      el.innerHTML = "";
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const proj = b.project
      ? `<span class="mc-badge mc-badge-project">${escapeHtml(b.project)}</span>`
      : "";
    const threads = (b.openThreads || [])
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join("");
    el.innerHTML = `
      <div class="mc-today-brief-label">↩ Last session ${proj} <span class="mc-today-brief-date">${escapeHtml(b.date || "")}</span></div>
      <div class="mc-today-brief-summary">${escapeHtml(b.summary)}</div>
      ${threads ? `<ul class="mc-today-brief-threads">${threads}</ul>` : ""}
    `;
  }

  function renderObsidian() {
    const el = document.getElementById("mc-today-obsidian");
    if (!el) return;
    const tasks = Today.state.obsidianTasks || [];
    if (!tasks.length) {
      el.innerHTML = "";
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.innerHTML = `
      <div class="mc-today-obsidian-label">📓 From today's Obsidian note <span class="mc-today-obsidian-count">${tasks.length}</span></div>
      ${tasks
        .map(
          (t) =>
            `<div class="mc-today-obsidian-row"><span class="mc-obsidian-check">☐</span> ${escapeHtml(t.text)}</div>`
        )
        .join("")}
    `;
  }

  function renderHeader() {
    const el = document.getElementById("mc-today-date");
    if (!el) return;
    if (Today.state.today) {
      const d = new Date(Today.state.today + "T12:00:00-07:00");
      el.textContent = d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
  }

  function renderStats() {
    const c = Today.state.counts;
    const stats = document.getElementById("mc-today-stats");
    if (!stats) return;
    stats.querySelector('[data-stat="planning"]').textContent = `🤝 ${c.planning || 0}`;
    stats.querySelector('[data-stat="mixed"]').textContent = `🔀 ${c.mixed || 0}`;
    stats.querySelector('[data-stat="legacy"]').textContent = `⚠️ ${c.legacy || 0}`;
    stats.querySelector('[data-stat="total"]').textContent =
      `${Today.state.tasks.length} shown`;
  }

  function renderFilter() {
    const bar = document.getElementById("mc-today-filters");
    if (!bar) return;
    bar.querySelectorAll(".mc-pill").forEach((pill) => {
      pill.classList.toggle(
        "mc-pill-active",
        pill.dataset.priority === Today.state.filterPriority
      );
    });
  }

  function renderList() {
    const list = document.getElementById("mc-today-list");
    if (!list) return;

    if (Today.state.tasks.length === 0) {
      list.innerHTML =
        '<div class="mc-empty">🎉 Today is clear. No planning-mode tasks pending.</div>';
      return;
    }

    const groups = { overdue: [], today: [], later: [], nodue: [] };
    for (const t of Today.state.tasks) {
      if (t.overdue) groups.overdue.push(t);
      else if (t.due === Today.state.today) groups.today.push(t);
      else if (t.due) groups.later.push(t);
      else groups.nodue.push(t);
    }

    let html = "";
    if (groups.overdue.length > 0) {
      html += section("⚠️ OVERDUE", groups.overdue, "mc-group-overdue");
    }
    if (groups.today.length > 0) {
      html += section("📅 DUE TODAY", groups.today, "mc-group-today");
    }
    if (groups.later.length > 0) {
      html += section("📆 SCHEDULED", groups.later, "mc-group-later");
    }
    if (groups.nodue.length > 0) {
      html += section("📥 NO DUE DATE", groups.nodue, "mc-group-nodue");
    }
    list.innerHTML = html;

    // Wire actions
    list.querySelectorAll("[data-today-action]").forEach((btn) => {
      btn.addEventListener("click", onAction);
    });
  }

  function section(title, tasks, cls) {
    return `
      <div class="mc-today-group ${cls}">
        <div class="mc-today-group-header">${title} <span class="mc-today-group-count">${tasks.length}</span></div>
        ${tasks.map(rowHtml).join("")}
      </div>
    `;
  }

  function rowHtml(t) {
    const modeBadge = modeBadgeHtml(t.mode);
    const projectBadge = t.project
      ? `<span class="mc-badge mc-badge-project">#${escapeHtml(t.project)}</span>`
      : "";
    const dueStr = t.due
      ? `<span class="mc-row-due ${t.overdue ? "mc-row-due-overdue" : ""}">📅 ${escapeHtml(t.due)}</span>`
      : '<span class="mc-row-due mc-row-due-none">—</span>';
    const prio = t.priority || "·";
    return `
      <div class="mc-today-row ${t.overdue ? "mc-row-overdue" : ""} ${t.stalled ? "mc-row-stalled" : ""}" data-task-id="${escapeAttr(t.id)}">
        <div class="mc-row-prio">${escapeHtml(prio)}</div>
        <div class="mc-row-title">${escapeHtml(t.title)}${t.stalled ? ' <span class="mc-stalled-tag" title="Stalled — 7+ days untouched">🕸️</span>' : ""}</div>
        <div class="mc-row-meta">
          ${modeBadge}
          ${projectBadge}
          ${dueStr}
          <span class="mc-row-age" title="Days since last touch">${t.ageDays}d</span>
        </div>
        <div class="mc-row-actions">
          <button class="mc-btn-icon" data-today-action="done" data-task-id="${escapeAttr(t.id)}" title="Mark done">✓</button>
          <button class="mc-btn-icon" data-today-action="promote" data-task-id="${escapeAttr(t.id)}" title="Promote to project">↑</button>
        </div>
      </div>
    `;
  }

  function modeBadgeHtml(mode) {
    if (mode === "planning") return '<span class="mc-badge mc-mode-planning" title="Planning — Mike drives">🤝</span>';
    if (mode === "autonomous") return '<span class="mc-badge mc-mode-autonomous" title="Autonomous — Corvus owns">🤖</span>';
    if (mode === "mixed") return '<span class="mc-badge mc-mode-mixed" title="Mixed — co-iterating">🔀</span>';
    return '<span class="mc-badge mc-mode-legacy" title="Legacy — needs triage">⚠️</span>';
  }

  async function onAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.todayAction;
    const id = btn.dataset.taskId;
    if (!id) return;
    if (action === "done") {
      const data = await fetchJson(
        `/api/mission/braindump/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "done" }),
        }
      );
      if (data?.task) refresh();
    } else if (action === "promote") {
      const data = await fetchJson(
        `/api/mission/tasks/${encodeURIComponent(id)}/promote-to-project`,
        { method: "POST" }
      );
      if (data?.ok) refresh();
    }
  }

  function onFilterClick(e) {
    const pill = e.target.closest(".mc-pill");
    if (!pill) return;
    const next = pill.dataset.priority || "all";
    if (next === Today.state.filterPriority) return;
    Today.state.filterPriority = next;
    refresh();
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
    const bar = document.getElementById("mc-today-filters");
    if (bar) bar.addEventListener("click", onFilterClick);
    await refresh();
    if (Today.pollInterval) clearInterval(Today.pollInterval);
    Today.pollInterval = setInterval(refresh, Today.POLL_MS);
  }

  window.MC_Today = Today;
  window.MC_TodayInit = init;
})();