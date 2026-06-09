/**
 * Mission Control Phase 1 — frontend
 *
 * Renders three panels:
 *   1. Three Things attention widget
 *   2. Brain Dump → triage board
 *   3. Signal-filtered activity feed
 *
 * Hooks into the existing dashboard by:
 *   - Injecting the partial HTML on DOMContentLoaded
 *   - Polling /api/mission/* endpoints (SSE-aware if available)
 *   - Wiring drag-and-drop and form interactions
 *
 * Stays vanilla JS, no build step.
 */

(function () {
  "use strict";

  const MC = {
    state: {
      threeThings: { items: [], total: 0, sources: {} },
      brainDump: { tasks: [] },
      feed: { items: [], digestCount: 0, neverShowCount: 0 },
      lastUpdated: null,
    },
    pollInterval: null,
    POLL_MS: 8000, // 8 seconds — gentle polling
  };

  // ============================================================================
  // PARTIAL INJECTION
  // ============================================================================

  async function injectPartial() {
    const container = document.getElementById("mission-control-container");
    if (!container) return;
    try {
      const res = await fetch("/partials/mission-control.html");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      container.innerHTML = html;
      console.log("[MC] Partial injected");
    } catch (e) {
      console.error("[MC] Failed to inject partial:", e);
      container.innerHTML =
        '<div class="mc-error">Failed to load Mission Control panels.</div>';
    }
  }

  // ============================================================================
  // API HELPERS
  // ============================================================================

  async function fetchJson(url, opts = {}) {
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opts,
      });
      if (!res.ok) {
        console.warn(`[MC] ${url} → HTTP ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[MC] ${url} fetch error:`, e);
      return null;
    }
  }

  async function refreshThreeThings() {
    const data = await fetchJson("/api/mission/three-things");
    if (data) MC.state.threeThings = data;
  }

  async function refreshBrainDump() {
    const data = await fetchJson("/api/mission/braindump");
    if (data) MC.state.brainDump = data;
  }

  async function refreshFeed() {
    const data = await fetchJson("/api/mission/feed");
    if (data) MC.state.feed = data;
  }

  async function refreshAll() {
    await Promise.all([refreshThreeThings(), refreshBrainDump(), refreshFeed()]);
    MC.state.lastUpdated = new Date();
    renderAll();
  }

  // ============================================================================
  // RENDERERS
  // ============================================================================

  function renderAll() {
    renderThreeThings();
    renderBrainDump();
    renderFeed();
    renderHeader();
  }

  function renderHeader() {
    const updated = document.getElementById("mc-updated");
    const summary = document.getElementById("mc-summary");
    if (!updated || !summary) return;

    if (MC.state.lastUpdated) {
      updated.textContent = `updated ${MC.state.lastUpdated.toLocaleTimeString()}`;
    } else {
      updated.textContent = "—";
    }

    const t = MC.state.threeThings;
    const f = MC.state.feed;
    summary.textContent =
      `${t.total || 0} attention • ${MC.state.brainDump.tasks.length} tasks • ${f.items.length} signals (${f.digestCount} digest, ${f.neverShowCount} hidden)`;
  }

  // ---- Panel 1: Three Things ----

  function renderThreeThings() {
    const list = document.getElementById("mc-threethings-list");
    if (!list) return;

    const items = MC.state.threeThings.items || [];
    if (items.length === 0) {
      list.innerHTML =
        '<div class="mc-empty">No urgent items. All clear. 🎉</div>';
      return;
    }

    list.innerHTML = items
      .map((it) => {
        const sevClass = `mc-item-${it.severity || "info"}`;
        const meta = it.meta || {};
        let metaStr = "";
        if (it.kind === "failure") {
          const ago = meta.lastRunAtMs
            ? `${Math.round((Date.now() - meta.lastRunAtMs) / 3600000)}h ago`
            : "";
          metaStr = `${ago} • ${meta.consecutiveErrors || 0} consecutive error${(meta.consecutiveErrors || 0) !== 1 ? "s" : ""}`;
        } else if (it.kind === "decision") {
          metaStr = `waiting since ${(meta.createdAt || "").slice(0, 10)} • ${meta.assignee || "unassigned"}`;
        } else if (it.kind) {
          metaStr = (meta.ts || "").slice(11, 16) || "";
        }
        return `
          <div class="mc-item ${sevClass}" data-id="${escapeAttr(it.id)}" data-source="${escapeAttr(it.source)}">
            <div class="mc-item-icon">${it.icon || "•"}</div>
            <div class="mc-item-body">
              <div class="mc-item-title">${escapeHtml(it.title)}</div>
              <div class="mc-item-detail">${escapeHtml(it.detail || "")}</div>
              <div class="mc-item-meta">${escapeHtml(metaStr)}</div>
            </div>
            <div class="mc-item-actions">
              ${
                it.actionUrl
                  ? `<button class="mc-btn-icon" data-action="open" data-url="${escapeAttr(it.actionUrl)}" title="Open">↗</button>`
                  : ""
              }
              <button class="mc-btn-icon" data-action="dismiss" data-id="${escapeAttr(it.id)}" title="Dismiss">✕</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire action handlers
    list.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", onThreeThingAction);
    });
  }

  async function onThreeThingAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const url = btn.dataset.url;
    if (action === "open" && url) {
      window.open(url, "_blank");
    } else if (action === "dismiss") {
      // For cron failures, no real dismiss yet — just visually fade
      // (we'd need to add a 'dismissed' field; for now hide and refetch in 30s)
      btn.closest(".mc-item")?.classList.add("mc-dismissed");
      setTimeout(() => refreshAll(), 500);
    }
  }

  // ---- Panel 2: Brain Dump ----

  function renderBrainDump() {
    const cols = document.getElementById("mc-braindump-columns");
    if (!cols) return;
    const tasks = MC.state.brainDump.tasks || [];

    // Reset all column bodies
    cols.querySelectorAll(".mc-column-body").forEach((body) => {
      body.innerHTML = "";
    });

    // Group by derived status
    const grouped = {
      unsorted: [],
      "urgent-important": [],
      schedule: [],
      delegate: [],
      icebox: [],
    };

    for (const t of tasks) {
      const st = deriveColumn(t);
      if (!grouped[st]) grouped[st] = [];
      grouped[st].push(t);
    }

    for (const [colName, list] of Object.entries(grouped)) {
      const body = cols.querySelector(`.mc-column-body[data-drop="${colName}"]`);
      const countEl = cols.querySelector(`[data-count-for="${colName}"]`);
      if (countEl) countEl.textContent = list.length;
      if (!body) continue;

      if (list.length === 0) {
        const emptyText = body.dataset.placeholder || "";
        body.innerHTML = `<div class="mc-empty mc-empty-sm">${escapeHtml(emptyText)}</div>`;
        continue;
      }

      body.innerHTML = list
        .map((t) => renderBrainDumpCard(t))
        .join("");
    }

    // Wire drag/drop
    wireDragAndDrop();
  }

  /**
   * Map task fields → column key.
   * Column key is "status" but we use a derived value for the Eisenhower
   * visual + icebox special case.
   */
  function deriveColumn(t) {
    if (t.status === "icebox") return "icebox";
    if (t.priority === "urgent-important") return "urgent-important";
    if (t.priority === "important-not-urgent") return "schedule";
    if (t.priority === "urgent-not-important") return "delegate";
    if (t.assignee === "corvus" || t.assignee === "claude") {
      return "delegate";
    }
    return "unsorted";
  }

  function renderBrainDumpCard(t) {
    const assigneeBadge = t.assignee
      ? `<span class="mc-badge mc-badge-${escapeAttr(t.assignee)}">${escapeHtml(t.assignee)}</span>`
      : "";
    const priorityBadge = t.priority
      ? `<span class="mc-badge mc-badge-priority">${escapeHtml(t.priority)}</span>`
      : "";
    const dueStr = t.due
      ? `<span class="mc-card-due">📅 ${escapeHtml(t.due)}</span>`
      : "";
    return `
      <div class="mc-card" draggable="true" data-task-id="${escapeAttr(t.id)}">
        <div class="mc-card-title">${escapeHtml(t.title)}</div>
        <div class="mc-card-meta">
          ${assigneeBadge}
          ${priorityBadge}
          ${dueStr}
        </div>
        <div class="mc-card-actions">
          <button class="mc-btn-icon" data-bd-action="edit" data-task-id="${escapeAttr(t.id)}" title="Edit">✎</button>
          <button class="mc-btn-icon" data-bd-action="delete" data-task-id="${escapeAttr(t.id)}" title="Delete">🗑</button>
        </div>
      </div>
    `;
  }

  function wireDragAndDrop() {
    const cards = document.querySelectorAll(".mc-card[draggable='true']");
    cards.forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", card.dataset.taskId);
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("mc-dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("mc-dragging");
      });
    });

    const bodies = document.querySelectorAll(".mc-column-body[data-drop]");
    bodies.forEach((body) => {
      body.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        body.classList.add("mc-drop-target");
      });
      body.addEventListener("dragleave", () => {
        body.classList.remove("mc-drop-target");
      });
      body.addEventListener("drop", async (e) => {
        e.preventDefault();
        body.classList.remove("mc-drop-target");
        const taskId = e.dataTransfer.getData("text/plain");
        const targetCol = body.dataset.drop;
        if (!taskId || !targetCol) return;
        await moveTaskToColumn(taskId, targetCol);
      });
    });

    // Action buttons
    document.querySelectorAll("[data-bd-action]").forEach((btn) => {
      btn.addEventListener("click", onBrainDumpAction);
    });
  }

  async function moveTaskToColumn(taskId, col) {
    const updates = mapColumnToUpdates(col);
    const data = await fetchJson(`/api/mission/braindump/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    if (data?.task) {
      // Update local cache
      const idx = MC.state.brainDump.tasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) MC.state.brainDump.tasks[idx] = data.task;
      renderBrainDump();
    }
  }

  function mapColumnToUpdates(col) {
    if (col === "icebox") {
      const until = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
      return { status: "icebox", iceboxFrozenUntil: until };
    }
    if (col === "unsorted") return { status: "unsorted" };
    if (col === "urgent-important") return { priority: "urgent-important", status: "todo" };
    if (col === "schedule") return { priority: "important-not-urgent", status: "todo" };
    if (col === "delegate") return { priority: "urgent-not-important", status: "todo" };
    return { status: col };
  }

  async function onBrainDumpAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.bdAction;
    const id = btn.dataset.taskId;
    if (action === "delete") {
      if (!confirm("Delete this task?")) return;
      await fetchJson(`/api/mission/braindump/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      MC.state.brainDump.tasks = MC.state.brainDump.tasks.filter((t) => t.id !== id);
      renderBrainDump();
    } else if (action === "edit") {
      const t = MC.state.brainDump.tasks.find((x) => x.id === id);
      if (!t) return;
      const newTitle = prompt("Edit title:", t.title);
      if (newTitle === null) return;
      const data = await fetchJson(`/api/mission/braindump/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: newTitle }),
      });
      if (data?.task) {
        const idx = MC.state.brainDump.tasks.findIndex((x) => x.id === id);
        if (idx >= 0) MC.state.brainDump.tasks[idx] = data.task;
        renderBrainDump();
      }
    }
  }

  async function onBrainDumpSubmit(e) {
    e.preventDefault();
    const input = document.getElementById("mc-braindump-input");
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    // Heuristic parsing — could be replaced with LLM call in Phase 2
    const parsed = parseBrainDumpText(raw);
    const submitBtn = document.querySelector("#mc-braindump-form button[type='submit']");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Capturing…";
    }
    const data = await fetchJson("/api/mission/braindump", {
      method: "POST",
      body: JSON.stringify({ rawText: raw, parsed }),
    });
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Capture";
    }
    if (data?.task) {
      MC.state.brainDump.tasks.push(data.task);
      input.value = "";
      renderBrainDump();
    }
  }

  /**
   * Lightweight heuristic parser. Returns: { title, project, priority, due, assignee, tags }
   * This is a placeholder — full LLM categorization is Phase 2.
   */
  function parseBrainDumpText(raw) {
    const text = raw.trim();
    const lower = text.toLowerCase();
    const result = {
      title: text.length > 80 ? text.slice(0, 77) + "…" : text,
      project: null,
      priority: null,
      due: null,
      assignee: null,
      tags: [],
    };

    // Priority heuristics
    if (/!{1,}|urgent|asap|critical|p0|🔥/.test(lower)) {
      result.priority = "urgent-important";
    } else if (/important|must|need to/.test(lower)) {
      result.priority = "important-not-urgent";
    }

    // Assignee heuristics
    if (/@(corvus|claude|anna|mike)/i.test(text)) {
      const m = text.match(/@(corvus|claude|anna|mike)/i);
      if (m) result.assignee = m[1].toLowerCase();
    } else if (/#assigned-corvus/i.test(text)) {
      result.assignee = "corvus";
    } else if (/#assigned-claude/i.test(text)) {
      result.assignee = "claude";
    } else if (/#assigned-mike/i.test(text)) {
      result.assignee = "mike";
    }

    // Due date heuristics
    const today = new Date();
    if (/today/i.test(lower)) {
      result.due = today.toISOString().slice(0, 10);
    } else if (/tomorrow/i.test(lower)) {
      const t = new Date(today.getTime() + 86400 * 1000);
      result.due = t.toISOString().slice(0, 10);
    } else if (/this week/i.test(lower)) {
      result.due = "this-week";
    } else if (/next week/i.test(lower)) {
      result.due = "next-week";
    }

    // Hashtags
    const tags = text.match(/#\w+/g) || [];
    result.tags = tags.map((t) => t.slice(1).toLowerCase());

    return result;
  }

  // ---- Panel 3: Activity Feed ----

  function renderFeed() {
    const list = document.getElementById("mc-feed-list");
    const sub = document.getElementById("mc-feed-sub");
    if (!list) return;

    const f = MC.state.feed;
    if (sub) {
      sub.textContent = `Signal-filtered • ${f.digestCount} digest • ${f.neverShowCount} hidden`;
    }

    if (!f.items || f.items.length === 0) {
      list.innerHTML =
        '<div class="mc-empty">No signal. Heartbeats filtered out.</div>';
      return;
    }

    list.innerHTML = f.items
      .slice(0, 20)
      .map((item) => {
        const ts = (item.ts || "").slice(11, 19) || "";
        const typeClass = `mc-feed-${item.type || "info"}`;
        const sevClass = `mc-feed-${item.severity || "info"}`;
        return `
          <div class="mc-feed-item ${typeClass} ${sevClass} ${item.acknowledged ? "mc-feed-acked" : ""}">
            <div class="mc-feed-time">${escapeHtml(ts)}</div>
            <div class="mc-feed-type">${escapeHtml(item.type || "")}</div>
            <div class="mc-feed-source">${escapeHtml(item.source || "")}</div>
            <div class="mc-feed-msg">${escapeHtml(item.message || "")}</div>
            <div class="mc-feed-actions">
              ${
                !item.acknowledged
                  ? `<button class="mc-btn-icon" data-feed-action="ack" data-id="${escapeAttr(item.id)}" title="Acknowledge">✓</button>`
                  : `<span class="mc-feed-acked-badge">✓</span>`
              }
              <button class="mc-btn-icon" data-feed-action="dismiss" data-id="${escapeAttr(item.id)}" title="Dismiss">✕</button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire actions
    list.querySelectorAll("[data-feed-action]").forEach((btn) => {
      btn.addEventListener("click", onFeedAction);
    });
  }

  async function onFeedAction(e) {
    const btn = e.currentTarget;
    const action = btn.dataset.feedAction;
    const id = btn.dataset.id;
    if (action === "ack") {
      await fetchJson(`/api/mission/feed/${encodeURIComponent(id)}/ack`, {
        method: "PATCH",
      });
      const item = MC.state.feed.items.find((f) => f.id === id);
      if (item) item.acknowledged = true;
      renderFeed();
    } else if (action === "dismiss") {
      await fetchJson(`/api/mission/feed/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      MC.state.feed.items = MC.state.feed.items.filter((f) => f.id !== id);
      renderFeed();
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function escapeHtml(text) {
    if (text == null) return "";
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, "&quot;");
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async function init() {
    console.log("[MC] Initializing Mission Control panels…");
    await injectPartial();

    // Wire form (after partial inject)
    const form = document.getElementById("mc-braindump-form");
    if (form) form.addEventListener("submit", onBrainDumpSubmit);

    // Cmd/Ctrl+Enter shortcut
    const input = document.getElementById("mc-braindump-input");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          form?.requestSubmit();
        }
      });
    }

    // Initial render
    await refreshAll();

    // Start polling
    if (MC.pollInterval) clearInterval(MC.pollInterval);
    MC.pollInterval = setInterval(refreshAll, MC.POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for debugging
  window.MissionControl = MC;
})();
