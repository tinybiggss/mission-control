/**
 * Mission Control Phase 4 — Overnight brief (frontend)
 *
 * - Polls /api/mission/overnight every 5 min (inputs change nightly/hourly)
 * - Renders ≤5 plain lines; "details ▸" opens the detail-panels fold and
 *   scrolls to the System Mind.
 *
 * Hook: window.MC_OvernightInit(containerId)
 */

(function () {
  "use strict";

  const Overnight = { pollInterval: null, POLL_MS: 300000, partialLoaded: false };

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[Overnight]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Overnight.partialLoaded) return;
    try {
      const res = await fetch("/partials/overnight.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Overnight.partialLoaded = true;
      const more = document.getElementById("mc-overnight-more");
      if (more) {
        more.addEventListener("click", (e) => {
          e.preventDefault();
          const fold = document.getElementById("mc-fold-panels");
          if (fold) fold.open = true;
          const mind = document.getElementById("mc-system-mind-container");
          if (mind) mind.scrollIntoView({ behavior: "smooth" });
        });
      }
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Overnight brief.</div>';
    }
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/overnight");
    const ul = document.getElementById("mc-overnight-lines");
    if (!ul || !data) return;
    ul.innerHTML = (data.lines || []).length
      ? data.lines.map((l) => `<li>${esc(l)}</li>`).join("")
      : '<li class="mc-focus-empty">Quiet night.</li>';
  }

  window.MC_OvernightInit = async function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    await injectPartial(container);
    await refresh();
    if (Overnight.pollInterval) clearInterval(Overnight.pollInterval);
    Overnight.pollInterval = setInterval(refresh, Overnight.POLL_MS);
  };
})();
