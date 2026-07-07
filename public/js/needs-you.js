/**
 * Mission Control Phase 2 — Needs You (frontend)
 *
 * - Polls /api/mission/needs-you every 30s
 * - Renders the decision inbox: failing health, PENDING_MIKE queue items,
 *   #discussion tasks, the rest of Corvus's inbox, drafts backlog rollup.
 * - Quick-dispatch bar: POST /api/mission/dispatch with capture/research/draft.
 *
 * Hook: window.MC_NeedsInit(containerId)
 */

(function () {
  "use strict";

  const Needs = {
    state: null,
    pollInterval: null,
    POLL_MS: 30000,
    partialLoaded: false,
  };

  async function fetchJson(url, opts) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("[NeedsYou]", url, e);
      return null;
    }
  }

  async function injectPartial(container) {
    if (Needs.partialLoaded) return;
    try {
      const res = await fetch("/partials/needs-you.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      container.innerHTML = await res.text();
      Needs.partialLoaded = true;
      wireDispatchBar();
    } catch (e) {
      container.innerHTML = '<div class="mc-error">Failed to load Needs You.</div>';
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/mission/needs-you");
    if (!data) return;
    Needs.state = data;
    render();
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  // Shared with focus.js by convention: POST a dispatch, return {ok,...}|null
  window.MC_Dispatch = async function (intent, text, context) {
    return fetchJson("/api/mission/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent, text, context }),
    });
  };

  function wireDispatchBar() {
    const input = document.getElementById("mc-dispatch-text");
    const send = document.getElementById("mc-dispatch-send");
    if (!input || !send) return;
    const doSend = async () => {
      const text = input.value.trim();
      if (!text) return;
      const intent = document.getElementById("mc-dispatch-intent").value;
      send.disabled = true;
      send.textContent = "…";
      const result = await window.MC_Dispatch(intent, text, "quick-dispatch bar");
      send.disabled = false;
      if (result && result.ok) {
        input.value = "";
        send.textContent = "queued ✓";
        setTimeout(() => (send.textContent = "→ Corvus"), 2500);
        refresh();
      } else {
        send.textContent = "failed ✗";
        setTimeout(() => (send.textContent = "→ Corvus"), 2500);
      }
    };
    send.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSend();
    });
  }

  function itemHtml(i) {
    if (i.type === "health") {
      const dot = i.severity === "error" ? "🔴" : "🟡";
      return `<div class="mc-needs-item mc-needs-${esc(i.severity)}">
        <span class="mc-needs-icon">${dot}</span>
        <span class="mc-needs-text"><b>${esc(i.label)}</b> — ${esc(i.detail)}</span>
      </div>`;
    }
    if (i.type === "queue") {
      const badge = i.pendingMike ? '<span class="mc-needs-badge">waiting on you</span>' : "";
      return `<div class="mc-needs-item${i.pendingMike ? " mc-needs-warn" : ""}">
        <span class="mc-needs-icon">📨</span>
        <span class="mc-needs-text">${badge}${esc(i.content)}</span>
      </div>`;
    }
    if (i.type === "discussion") {
      const drift = i.postpone >= 10 ? ` <span class="mc-focus-drift">↩ ${i.postpone}×</span>` : "";
      return `<div class="mc-needs-item">
        <span class="mc-needs-icon">💬</span>
        <span class="mc-needs-text">${esc(i.text)}${drift} <span class="mc-needs-dim">· ${esc(i.project)}</span></span>
      </div>`;
    }
    if (i.type === "drafts") {
      return `<div class="mc-needs-item">
        <span class="mc-needs-icon">📝</span>
        <span class="mc-needs-text"><b>${i.count} drafts</b> awaiting review in the content pipeline
          <span class="mc-needs-dim">· latest: ${esc(i.latest || "")}</span>
          <a href="${esc(i.link)}" target="_blank">open ↗</a></span>
      </div>`;
    }
    return "";
  }

  function render() {
    const s = Needs.state;
    const list = document.getElementById("mc-needs-list");
    if (!list || !s) return;

    const count = document.getElementById("mc-needs-count");
    if (count) count.textContent = s.counts.total ? `(${s.counts.total})` : "";

    list.innerHTML = s.items.length
      ? s.items.map(itemHtml).join("")
      : '<div class="mc-focus-empty">Nothing needs you right now 🎉</div>';
  }

  window.MC_NeedsInit = async function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    await injectPartial(container);
    await refresh();
    if (Needs.pollInterval) clearInterval(Needs.pollInterval);
    Needs.pollInterval = setInterval(refresh, Needs.POLL_MS);
  };
})();
