/**
 * Mission Control Phase 1 — Focus Deck (frontend)
 *
 * - Polls /api/mission/focus every 60s (sidecar regenerates once a day,
 *   but done-state and cache freshness matter)
 * - Renders: North Star strip → NOW hero → next 2 → low-energy alternate,
 *   plus today's calendar and honest drift counts.
 *
 * Hook: window.MC_FocusInit(containerId)
 */

(function () {
  "use strict";

  const Focus = {
    state: null,
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
      console.error("[Focus]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Focus.partialLoaded) return;
    try {
      const res = await fetch("/partials/focus.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Focus.partialLoaded = true;
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Focus Deck.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/focus");
    if (!data) return;
    Focus.state = data;
    render();
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function taskMetaHtml(t) {
    const bits = [];
    if (t.overdue) bits.push(`<span class="mc-focus-overdue">overdue ${esc(t.due)}</span>`);
    else if (t.due) bits.push(`<span>due ${esc(t.due)}</span>`);
    if (t.postpone >= 10) bits.push(`<span class="mc-focus-drift">↩ ${t.postpone}×</span>`);
    if (t.project && t.project !== "Uncategorized") bits.push(`<span>${esc(t.project)}</span>`);
    return bits.join(" · ");
  }

  function dispatchBtnHtml(t) {
    // One click = "research: <task>" into Corvus's capture queue (needs-you.js
    // defines window.MC_Dispatch; the next heartbeat picks the entry up).
    return `<button class="mc-focus-dispatch" data-text="${esc(t.text)}" title="Send to Corvus as overnight research">→ Corvus</button>`;
  }

  function heroHtml(t) {
    if (!t) return '<div class="mc-focus-empty">Nothing on the plate — check the sidecar.</div>';
    const open = t.obsidianUri
      ? `<a class="mc-focus-open" href="${esc(t.obsidianUri)}" title="Open in Obsidian">Open ↗</a>`
      : "";
    return `
      <div class="mc-focus-hero-text">${esc(t.text)}</div>
      <div class="mc-focus-hero-meta">${taskMetaHtml(t)} ${open} ${dispatchBtnHtml(t)}</div>`;
  }

  function nextHtml(next) {
    if (!next || !next.length) return "";
    return (
      '<div class="mc-focus-label-sub">then</div>' +
      next
        .map(
          (t) => `
        <div class="mc-focus-next-item">
          <span class="mc-focus-next-text">${esc(t.text)}</span>
          <span class="mc-focus-next-meta">${taskMetaHtml(t)} ${dispatchBtnHtml(t)}</span>
        </div>`,
        )
        .join("")
    );
  }

  function lowEnergyHtml(t) {
    if (!t) return "";
    return `<details class="mc-focus-le"><summary>low energy? one easy win ▾</summary>
      <div class="mc-focus-next-item"><span class="mc-focus-next-text">${esc(t.text)}</span>
      <span class="mc-focus-next-meta">${taskMetaHtml(t)}</span></div></details>`;
  }

  function northStarHtml(ns, counts) {
    if (!ns) return "";
    return (
      ns.buckets
        .map(
          (b) =>
            `<span class="mc-focus-bucket${b.taskCount ? " has-tasks" : ""}" title="${esc(ns.vision || b.label)}">
            ${b.emoji} ${esc(b.label)}${b.taskCount ? ` <b>${b.taskCount}</b>` : ""}
          </span>`,
        )
        .join("") +
      (counts && counts.corvusPlate
        ? `<span class="mc-focus-bucket mc-focus-corvus" title="Tasks assigned to Corvus">🐦‍⬛ Corvus <b>${counts.corvusPlate}</b></span>`
        : "")
    );
  }

  function render() {
    const s = Focus.state;
    const hero = document.getElementById("mc-focus-hero");
    if (!hero || !s) return;

    document.getElementById("mc-focus-northstar").innerHTML = northStarHtml(s.northStar, s.counts);

    if (s.available === false) {
      hero.innerHTML =
        '<div class="mc-focus-empty">⚠️ No task sidecar found (Corvus/Task Data). task-rollover.py runs at 6:05 AM.</div>';
      return;
    }

    hero.innerHTML = heroHtml(s.now.hero);
    document.getElementById("mc-focus-next").innerHTML = nextHtml(s.now.next);
    document.getElementById("mc-focus-lowenergy").innerHTML = lowEnergyHtml(s.lowEnergyPick);

    document.getElementById("mc-focus-calendar").innerHTML =
      (s.calendar || [])
        .map((e) => `<div class="mc-focus-cal-item">${esc(e.title)}<span>${esc(e.time)}</span></div>`)
        .join("") || '<div class="mc-focus-empty">No meetings today 🎉</div>';

    const c = s.counts || {};
    document.getElementById("mc-focus-counts").innerHTML = `
      <span title="Open tasks on the plate">${c.open || 0} open</span>
      <span class="${c.overdue ? "mc-focus-overdue" : ""}">${c.overdue || 0} overdue</span>
      <span class="${c.drifting ? "mc-focus-drift" : ""}" title="Postponed 10+ times">${c.drifting || 0} drifting</span>`;

    const src = document.getElementById("mc-focus-source");
    if (src) {
      src.textContent =
        `from task-rollover ${s.date}` + (s.stale ? " — STALE (no sidecar for today yet)" : "");
      src.className = s.stale ? "mc-focus-stale" : "";
    }
  }

  function wireDispatchClicks(container) {
    container.addEventListener("click", async (e) => {
      const btn = e.target.closest(".mc-focus-dispatch");
      if (!btn || typeof window.MC_Dispatch !== "function") return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "…";
      const result = await window.MC_Dispatch("research", btn.dataset.text, "Focus Deck task");
      btn.disabled = false;
      btn.textContent = result && result.ok ? "queued ✓" : "failed ✗";
      setTimeout(() => (btn.textContent = original), 3000);
    });
  }

  window.MC_FocusInit = async function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    await injectPartial(container);
    wireDispatchClicks(container);
    await refresh();
    if (Focus.pollInterval) clearInterval(Focus.pollInterval);
    Focus.pollInterval = setInterval(refresh, Focus.POLL_MS);
  };
})();
