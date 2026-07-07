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

  async function fetchJson(url, opts) {
    try {
      const res = await fetch(url, opts || { headers: { "Content-Type": "application/json" } });
      if (!res.ok && res.status >= 500) return null;
      return await res.json(); // drift/action returns JSON error envelopes on 4xx
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
    updateDriftSummary(c);
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

  // ---------------------------------------------------------------------
  // Drift Meter (Phase 4): triage ↩10+ tasks — real date / delegate / drop.
  // Lazy-loads /api/mission/drift when the details element is first opened.
  // ---------------------------------------------------------------------

  const Drift = { loaded: false };

  async function loadDrift() {
    const list = document.getElementById("mc-drift-list");
    if (!list) return;
    const data = await fetchJson("/api/mission/drift");
    if (!data) {
      list.innerHTML = '<div class="mc-focus-empty">Failed to load drifting tasks.</div>';
      return;
    }
    Drift.loaded = true;
    list.innerHTML = data.tasks.length
      ? data.tasks.map(driftRowHtml).join("")
      : '<div class="mc-focus-empty">Nothing drifting — the plate is honest 🎉</div>';
  }

  function driftRowHtml(t) {
    return `
      <div class="mc-drift-row" data-task="${esc(t.text)}">
        <span class="mc-drift-count">↩ ${t.postpone}×</span>
        <span class="mc-drift-text">${esc(t.text)}
          <span class="mc-focus-next-meta">${t.due ? `due ${esc(t.due)} · ` : ""}${esc(t.project)}</span>
        </span>
        <span class="mc-drift-actions">
          <button class="mc-drift-btn" data-act="set-due" title="Give it a real date">📅</button>
          <button class="mc-drift-btn" data-act="delegate" title="Hand to Corvus (raises at next standup)">🐦‍⬛</button>
          <button class="mc-drift-btn" data-act="drop" title="Formally drop — cancels the task">✖</button>
          <span class="mc-drift-due-picker" hidden>
            <input type="date" class="mc-drift-date" />
            <button class="mc-drift-btn" data-act="confirm-due">✓</button>
          </span>
        </span>
      </div>`;
  }

  async function postDriftAction(row, action, due) {
    const body = { task: row.dataset.task, action };
    if (due) body.due = due;
    const result = await fetchJson("/api/mission/drift/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result && result.ok) {
      row.classList.add("mc-drift-done");
      const label = { "set-due": `due ${due} ✓`, delegate: "delegated to Corvus ✓", drop: "dropped ✓" }[action];
      row.querySelector(".mc-drift-actions").innerHTML = `<span class="mc-drift-result">${label}</span>`;
      refresh(); // hero/next/counts may have changed
    } else {
      const msg = (result && result.error) || "failed — try in Obsidian";
      row.querySelector(".mc-drift-actions").innerHTML = `<span class="mc-drift-result mc-focus-overdue">${esc(msg)}</span>`;
    }
  }

  function wireDrift(container) {
    const details = container.querySelector("#mc-focus-drift") || document.getElementById("mc-focus-drift");
    if (!details) return;
    details.addEventListener("toggle", () => {
      if (details.open && !Drift.loaded) loadDrift();
    });
    details.addEventListener("click", (e) => {
      const btn = e.target.closest(".mc-drift-btn");
      if (!btn) return;
      const row = btn.closest(".mc-drift-row");
      const act = btn.dataset.act;
      if (act === "set-due") {
        const picker = row.querySelector(".mc-drift-due-picker");
        picker.hidden = !picker.hidden;
      } else if (act === "confirm-due") {
        const due = row.querySelector(".mc-drift-date").value;
        if (due) postDriftAction(row, "set-due", due);
      } else if (act === "delegate" || act === "drop") {
        postDriftAction(row, act);
      }
    });
  }

  function updateDriftSummary(counts) {
    const summary = document.getElementById("mc-drift-summary");
    if (summary && counts) {
      summary.textContent = counts.drifting
        ? `🎯 ${counts.drifting} drifting ↩10+ — triage ▾`
        : "no drifting tasks 🎉";
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
    wireDrift(container);
    await refresh();
    if (Focus.pollInterval) clearInterval(Focus.pollInterval);
    Focus.pollInterval = setInterval(refresh, Focus.POLL_MS);
  };
})();
