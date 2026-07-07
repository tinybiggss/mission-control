/**
 * Overnight brief (Phase 4) — tests
 *
 * Tests:
 *   - computeOvernight() — line synthesis from mind/crons/queue/tasks,
 *     ≤5 lines, graceful degradation
 *   - createOvernightAPI().list — HTTP handler
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { computeOvernight, createOvernightAPI } = require("../src/overnight");

const NOW = Date.parse("2026-07-07T14:00:00Z"); // 7:00 AM PT

const MIND = {
  mounted: true,
  consolidation: {
    date: "2026-07-07",
    model: "ollama/kimi-k2.6:cloud",
    connections: ["a", "b", "c"],
    patterns: ["p"],
    hypotheses: ["h1", "h2"],
    tensions: ["t1"],
    recurringThreads: ["OpenClaw ops repair #6", "distill-app worktrees"],
  },
  counts: { sessions: 26, consolidations: 41, stubs: 27 },
};

const JOBS = {
  jobs: [
    { id: "u1", name: "dreaming-nightly" },
    { id: "u2", name: "rt-rss-fetcher" },
    { id: "u3", name: "heartbeat-afternoon" },
    { id: "u4", name: "stale-job" },
  ],
};

const JOBS_STATE = {
  version: 1,
  jobs: {
    u1: { state: { lastRunAtMs: NOW - 4 * 3600e3, lastRunStatus: "ok" } },
    u2: { state: { lastRunAtMs: NOW - 2 * 3600e3, lastRunStatus: "ok" } },
    u3: { state: { lastRunAtMs: NOW - 8 * 3600e3, lastRunStatus: "error", consecutiveErrors: 3 } },
    u4: { state: { lastRunAtMs: NOW - 60 * 3600e3, lastRunStatus: "ok" } }, // outside window
  },
};

function makeQueueFile(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overnight-test-"));
  const file = path.join(dir, "capture-queue.json");
  fs.writeFileSync(file, JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `q${i}` }))));
  return file;
}

const TASKS = {
  tasks: [
    { text: "**stuck**", postpone: 15, is_completed: false },
    { text: "**stuck2**", postpone: 29, is_completed: false },
    { text: "**fine**", postpone: 1, is_completed: false },
  ],
};

function deps(over = {}) {
  return {
    getMind: () => MIND,
    readJobs: () => JOBS,
    readJobsState: () => JOBS_STATE,
    readTasks: () => TASKS,
    queueFile: makeQueueFile(6),
    now: NOW,
    ...over,
  };
}

describe("computeOvernight", () => {
  it("synthesizes at most 5 non-empty lines", () => {
    const r = computeOvernight(deps());
    assert.ok(r.lines.length >= 3 && r.lines.length <= 5, `got ${r.lines.length} lines`);
    assert.ok(r.lines.every((l) => typeof l === "string" && l.trim()));
  });
  it("summarizes the consolidation with counts", () => {
    const r = computeOvernight(deps());
    const line = r.lines.find((l) => l.includes("Dreaming"));
    assert.ok(line, "has a dreaming line");
    assert.match(line, /3 connections/);
    assert.match(line, /2 hypotheses/);
  });
  it("counts overnight cron runs and names failures", () => {
    const r = computeOvernight(deps());
    const line = r.lines.find((l) => l.includes("cron"));
    assert.match(line, /3 cron/); // u1,u2,u3 within 12h; u4 outside
    assert.match(line, /heartbeat-afternoon/);
  });
  it("reports the drift count", () => {
    const r = computeOvernight(deps());
    assert.ok(r.lines.some((l) => /2 task/.test(l) && /↩10\+/.test(l)));
    assert.strictEqual(r.stats.drifting, 2);
  });
  it("degrades gracefully with a dead ledger and missing files", () => {
    const r = computeOvernight(
      deps({
        getMind: () => ({ mounted: false }),
        readJobs: () => { throw new Error("boom"); },
        readJobsState: () => null,
        queueFile: "/nonexistent/q.json",
        readTasks: () => null,
      }),
    );
    assert.ok(r.lines.length >= 1);
    assert.ok(r.lines.some((l) => /no consolidation|ledger/i.test(l)));
  });
});

describe("createOvernightAPI", () => {
  it("serves JSON over the handler", () => {
    const api = createOvernightAPI(deps());
    const res = {
      statusCode: null,
      body: "",
      writeHead(code) { this.statusCode = code; },
      end(data) { this.body = data; },
    };
    api.list({}, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(JSON.parse(res.body).lines));
  });
});
