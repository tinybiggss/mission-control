/**
 * Mission Control Phase 4 — Outstanding view (frontend)
 *
 * - Polls /api/mission/outstanding every 8s
 * - Filter chips: priority + mode
 * - Sort: age (default), age-asc, priority
 * - "Promote to project" action on rows (visible for all open tasks;
 *   the spec suggests ≥3 postponements but we don't gate the UI on it)
 */

(function () {
  "use strict";

  const Out = {
    state: {
      tasks: [],
      filterPriority: "all",
      filterMode: "all",
      sort: "age",
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
      console.error("[Outstanding]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Out.partialLoaded) return;
    try {
      const res = await fetch("/partials/outstanding.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Out.partialLoaded = true;
    } catch (e) {
      container.innerHTML =
        '<div class="mc-error">Failed to load Outstanding view.</div>';
    }
  }

  async function refresh() {
    const params = new URLSearchParams();
    if (Out.state.filterPriority !== "all") {
      params.set("priority", Out.state.filterPriority);
    }
    if (Out.state.filterMode !== "all") {
      params.set("mode", Out.state.filterMode);
    }
    const qs = params.toString();
    const data = await fetchJson("/api/mission/outstanding" + (qs ? `?${qs}` : ""));
    if (!data) return;
    Out.state.tasks = sortTasks(data.tasks || [], Out.state.sort);
    render();
  }

  function sortTasks(tasks, mode) {
    const list = [...tasks];
    if (mode === "age-asc") {
      list.sort((a, b) => (a.ageDays || 0) - (b.ageDays || 0));
    } else if (mode === "priority") {
      const rank = { "🔺": 4, "⏫": 3, "🔼": 2, "🧊": 1 };
      list.sort((a, b) => {
        const r = (rank[b.priority] || 0) - (rank[a.priority] || 0);
        if (r !== 0) return r;
        return (b.ageDays || 0) - (a.ageDays || 0);
      });
    }
    // Default "age" already applied server-side (age desc)
    return list;
  }

  function render() {
    renderHeader();
    renderFilters();
    renderList();
  }

  function renderHeader() {
    const countEl = document.getElementById("mc-outstanding-count");
    if (countEl) {
      countEl.textContent = `${Out.state.tasks.length} open`;
    }
  }

  function renderFilters() {
    const pBar = document.getElementById("mc-outstanding-priority-filter");
    if (pBar) {
      pBar.querySelectorAll(".mc-pill").forEach((pill) => {
        pill.classList.toggle(
          "mc-pill-active",
          pill.dataset.priority === Out.state.filterPriority
        );
      });
    }
    const mBar = document.getElementById("mc-outstanding-mode-filter");
    if (mBar) {
      mBar.querySelectorAll(".mc-pill").forEach((pill) => {
        pill.classList.toggle(
          "mc-pill-active",
          pill.dataset.mode === Out.state.filterMode
        );
      });
    }
  }

  function renderList() {
    const list = document.getElementById("mc-outstanding-list");
    if (!list) return;
    if (Out.state.tasks.length === 0) {
      list.innerHTML = '<div class="mc-empty">No open tasks match these filters.</div>';
      return;
    }
    list.innerHTML = Out.state.tasks.map(rowHtml).join("");
    list.querySelectorAll("[data-out-action]").forEach((btn) => {
      btn.addEventListener("click", onAction);
    });
  }

  function rowHtml(t) {
    const modeBadge = modeBadgeHtml(t.mode);
    const projectBadge = t.project
      ? `<span class="mc-badge mc-badge-project">#${escapeHtml(t.project)}</span>`
      : "";
    const prio = t.priority || "·";
    const postpone = t.postponeCount > 0
      ? `<span class="mc-row-postpone" title="Times postponed">↩ ${t.postponeCount}</span>`
      : "";
    const canPromote = t.postponeCount >= 3;
    return `
      <div class="mc-out-row" data-task-id="${escapeAttr(t.id)}">
        <div class="mc-row-prio">${escapeHtml(prio)}</div>
        <div class="mc-row-title">${escapeHtml(t.title)}</div>
        <div class="mc-row-meta">
          ${modeBadge}
          ${projectBadge}
          ${postpone}
          <span class="mc-row-age" title="Days since last touch">${t.ageDays}d</span>
        </div>
        <div class="mc-row-actions">
          ${canPromote
            ? `<button class="mc-btn-icon mc-btn-promote" data-out-action="promote" data-task-id="${escapeAttr(t.id)}" title="Promote to project">↑</button>`
            : `<button class="mc-btn-icon mc-btn-promote-disabled" disabled title="Promote available at ≥3 postponements (currently ${t.postponeCount})">↑</button>`}
          <button class="mc-btn-icon" data-out-action="done" data-task-id="${escapeAttr(t.id)}" title="Mark done">✓</button>
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
    const action = btn.dataset.outAction;
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

  function onPriorityClick(e) {
    const pill = e.target.closest(".mc-pill");
    if (!pill) return;
    const next = pill.dataset.priority || "all";
    if (next === Out.state.filterPriority) return;
    Out.state.filterPriority = next;
    refresh();
  }

  function onModeClick(e) {
    const pill = e.target.closest(".mc-pill");
    if (!pill) return;
    const next = pill.dataset.mode || "all";
    if (next === Out.state.filterMode) return;
    Out.state.filterMode = next;
    refresh();
  }

  function onSortChange(e) {
    Out.state.sort = e.target.value || "age";
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
    const pBar = document.getElementById("mc-outstanding-priority-filter");
    if (pBar) pBar.addEventListener("click", onPriorityClick);
    const mBar = document.getElementById("mc-outstanding-mode-filter");
    if (mBar) mBar.addEventListener("click", onModeClick);
    const sortEl = document.getElementById("mc-outstanding-sort-select");
    if (sortEl) sortEl.addEventListener("change", onSortChange);
    await refresh();
    if (Out.pollInterval) clearInterval(Out.pollInterval);
    Out.pollInterval = setInterval(refresh, Out.POLL_MS);
  }

  window.MC_Outstanding = Out;
  window.MC_OutstandingInit = init;
})();