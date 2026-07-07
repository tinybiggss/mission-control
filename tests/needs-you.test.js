/**
 * Needs You (Phase 2) — tests
 *
 * Tests:
 *   - computeNeedsYou() — aggregation of health fails, capture queue,
 *     #discussion tasks, drafts rollup; sort order; graceful degradation
 *   - createNeedsYouAPI().list — HTTP handler
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { computeNeedsYou, createNeedsYouAPI } = require("../src/needs-you");

function tmpQueueFile(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "needs-you-test-"));
  const file = path.join(dir, "capture-queue.json");
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  return file;
}

const HEALTH = {
  overall: "failing",
  checks: [
    { id: "ok-check", label: "Fine thing", ok: true, severity: "error", detail: "all good" },
    { id: "corvus-scheduler", label: "Corvus scheduler", ok: false, severity: "error", detail: "404s" },
    { id: "ledger-stubs", label: "Ledger stub pile-up", ok: false, severity: "warn", detail: "27 stubs" },
  ],
};

const QUEUE = [
  { id: "q1", captured_at: "2026-07-02T10:55:00-07:00", capture_type: "action_item", content: "Mint the Substack key — PENDING_MIKE_TO_MINT" },
  { id: "q2", captured_at: "2026-07-05T23:32:00-07:00", capture_type: "discussion_item", content: "Should we restructure Obsidian?" },
];

const TASKS = {
  date: "2026-07-07",
  tasks: [
    { text: "**Talk about X** 💬", is_completed: false, tags: ["#discussion"], postpone: 4, project: "GHN", priority: "🔼" },
    { text: "normal task", is_completed: false, tags: ["#GHN"], postpone: 0, project: "GHN", priority: "🔼" },
    { text: "**done discussion**", is_completed: true, tags: ["#discussion"], postpone: 0, project: "GHN", priority: "🔼" },
  ],
};

const CONTENT = {
  up: true,
  total: 3,
  stages: {
    draft: [
      { name: "draft-2026-07-04-007-article-pitch", mtime: "2026-07-04T10:00:00Z" },
      { name: "draft-2026-07-04-006-linkedin", mtime: "2026-07-03T10:00:00Z" },
      { name: "draft-2026-07-02-001", mtime: "2026-07-01T10:00:00Z" },
    ],
    adapted: [],
    scheduled: [],
    published: [],
  },
};

function makeDeps(over = {}) {
  return {
    getHealth: () => HEALTH,
    getContent: () => CONTENT,
    readTasks: () => TASKS,
    queueFile: tmpQueueFile(QUEUE),
    ...over,
  };
}

describe("computeNeedsYou", () => {
  it("aggregates all four sources with correct types and counts", () => {
    const r = computeNeedsYou(makeDeps());
    const types = r.items.map((i) => i.type);
    assert.strictEqual(r.counts.health, 2);
    assert.strictEqual(r.counts.queue, 2);
    assert.strictEqual(r.counts.discussion, 1);
    assert.strictEqual(r.counts.drafts, 3);
    const draftsItem = r.items.find((i) => i.type === "drafts");
    assert.strictEqual(draftsItem.latest, "draft-2026-07-04-007-article-pitch");
    assert.strictEqual(draftsItem.link, "http://localhost:4321");
    assert.ok(types.includes("health") && types.includes("queue") && types.includes("discussion") && types.includes("drafts"));
  });
  it("drops passing health checks and completed/untagged tasks", () => {
    const r = computeNeedsYou(makeDeps());
    assert.ok(!r.items.some((i) => i.id === "ok-check"));
    assert.strictEqual(r.items.filter((i) => i.type === "discussion").length, 1);
    assert.match(r.items.find((i) => i.type === "discussion").text, /Talk about X/);
  });
  it("flags PENDING_MIKE queue items and sorts them above plain queue items", () => {
    const r = computeNeedsYou(makeDeps());
    const q = r.items.filter((i) => i.type === "queue");
    assert.strictEqual(q[0].pendingMike, true);
    assert.strictEqual(q[1].pendingMike, false);
  });
  it("orders item groups: health, then pendingMike, then discussion, then queue, then drafts", () => {
    const r = computeNeedsYou(makeDeps());
    const order = r.items.map((i) => (i.type === "queue" ? (i.pendingMike ? "pendingMike" : "queue") : i.type));
    const firstIdx = (t) => order.indexOf(t);
    assert.ok(firstIdx("health") < firstIdx("pendingMike"));
    assert.ok(firstIdx("pendingMike") < firstIdx("discussion"));
    assert.ok(firstIdx("discussion") < firstIdx("queue"));
    assert.strictEqual(order[order.length - 1], "drafts");
  });
  it("degrades gracefully: no drafts item when content unavailable, empty queue file, null tasks", () => {
    const r = computeNeedsYou(
      makeDeps({
        getContent: () => ({ up: false }),
        readTasks: () => null,
        queueFile: "/nonexistent/queue.json",
      }),
    );
    assert.strictEqual(r.counts.drafts, 0);
    assert.strictEqual(r.counts.queue, 0);
    assert.strictEqual(r.counts.discussion, 0);
    assert.strictEqual(r.counts.health, 2);
  });
  it("survives a throwing health getter", () => {
    const r = computeNeedsYou(makeDeps({ getHealth: () => { throw new Error("boom"); } }));
    assert.strictEqual(r.counts.health, 0);
    assert.ok(r.counts.queue > 0, "other sources still aggregated");
  });
});

describe("createNeedsYouAPI", () => {
  it("serves JSON over the handler", () => {
    const api = createNeedsYouAPI(makeDeps());
    const res = {
      statusCode: null,
      body: "",
      writeHead(code) { this.statusCode = code; },
      end(data) { this.body = data; },
    };
    api.list({}, res);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.ok(Array.isArray(parsed.items));
    assert.ok(parsed.counts.total >= 4);
  });
});
