/**
 * Mission Control Phase 2 — tests
 *
 * Tests project link resolution, block ID generation,
 * auto-archive logic, velocity cap, and API handlers.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  resolveProjectLinks,
  generateBlockId,
  getTodayDate,
  autoArchiveStale,
  checkVelocityCap,
} = require("../src/mc-phase2");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-phase2-test-"));
}

function writeBrainDump(dir, tasks) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "brain-dump.json"), JSON.stringify(tasks, null, 2));
}

function writeVelocityConfig(dir, config) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "velocity-config.json"), JSON.stringify(config, null, 2));
}

function parseJsonResponse(body) {
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("mc-phase2: generateBlockId()", () => {
  it("returns 6-char lowercase alphanumeric", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateBlockId();
      assert.ok(
        /^[a-z0-9]{6}$/.test(id),
        `expected 6 lowercase chars, got: ${id}`
      );
    }
  });

  it("generates mostly unique IDs (no strict collision test needed)", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateBlockId());
    }
    assert.ok(ids.size >= 90, "should generate mostly unique IDs");
  });
});

describe("mc-phase2: resolveProjectLinks()", () => {
  it("resolves #RT, #VP, #GHN, #Apollo, #Corvus, #Distills to top-level links", () => {
    const result = resolveProjectLinks(["#RT", "#VP", "#GHN", "#Apollo", "#Corvus", "#Distills"]);
    assert.deepStrictEqual(result.links, [
      "[[Resilient Tomorrow]]",
      "[[Velocity Partners]]",
      "[[GHN]]",
      "[[Apollo Media Server]]",
      "[[Corvus]]",
      "[[Distills]]",
    ]);
    assert.deepStrictEqual(result.unknown, []);
  });

  it("resolves #solar to Projects/ path", () => {
    const result = resolveProjectLinks(["#solar"]);
    assert.deepStrictEqual(result.links, ["[[Projects/solar/Solar Build Plan]]"]);
  });

  it("returns unknown tags separately", () => {
    const result = resolveProjectLinks(["#RT", "#random-tag", "#alsoUnknown"]);
    assert.deepStrictEqual(result.links, ["[[Resilient Tomorrow]]"]);
    assert.deepStrictEqual(result.unknown, ["#random-tag", "#alsoUnknown"]);
  });

  it("is case-insensitive", () => {
    const result = resolveProjectLinks(["#rt", "#Rt", "#RT"]);
    assert.strictEqual(result.links.length, 3);
  });

  it("handles empty input", () => {
    const result = resolveProjectLinks([]);
    assert.deepStrictEqual(result.links, []);
    assert.deepStrictEqual(result.unknown, []);
  });

  it("strips leading # before matching", () => {
    const result = resolveProjectLinks(["rt", "vp", "solar"]);
    assert.strictEqual(result.links.length, 3);
  });
});

describe("mc-phase2: getTodayDate()", () => {
  it("returns YYYY-MM-DD format", () => {
    const d = getTodayDate();
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d), `expected YYYY-MM-DD, got: ${d}`);
  });
});

// ---------------------------------------------------------------------------
// Auto-archive
// ---------------------------------------------------------------------------

describe("mc-phase2: autoArchiveStale()", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("archives tasks > 60 days old with no due and no priority", () => {
    tmpDir = makeTempDir();
    const oldDate = new Date(Date.now() - 70 * 86400 * 1000).toISOString();
    writeBrainDump(tmpDir, [
      {
        id: "bd_old_1",
        title: "Old stale task",
        status: "todo",
        createdAt: oldDate,
        due: null,
        priority: null,
        tags: [],
      },
    ]);

    const result = autoArchiveStale(tmpDir);
    assert.strictEqual(result.archived, 1);
    assert.strictEqual(result.items[0].id, "bd_old_1");

    const remaining = JSON.parse(fs.readFileSync(path.join(tmpDir, "brain-dump.json"), "utf8"));
    assert.strictEqual(remaining.length, 0);
  });

  it("does NOT archive tasks with priority", () => {
    tmpDir = makeTempDir();
    const oldDate = new Date(Date.now() - 70 * 86400 * 1000).toISOString();
    writeBrainDump(tmpDir, [
      {
        id: "bd_old_priority",
        title: "Old with priority",
        status: "todo",
        createdAt: oldDate,
        due: null,
        priority: "important-not-urgent",
        tags: [],
      },
    ]);

    const result = autoArchiveStale(tmpDir);
    assert.strictEqual(result.archived, 0);
  });

  it("does NOT archive tasks with due date", () => {
    tmpDir = makeTempDir();
    const oldDate = new Date(Date.now() - 70 * 86400 * 1000).toISOString();
    writeBrainDump(tmpDir, [
      {
        id: "bd_old_due",
        title: "Old with due",
        status: "todo",
        createdAt: oldDate,
        due: "2026-06-10",
        priority: null,
        tags: [],
      },
    ]);

    const result = autoArchiveStale(tmpDir);
    assert.strictEqual(result.archived, 0);
  });

  it("does NOT archive done tasks", () => {
    tmpDir = makeTempDir();
    const oldDate = new Date(Date.now() - 70 * 86400 * 1000).toISOString();
    writeBrainDump(tmpDir, [
      {
        id: "bd_done_old",
        title: "Done old task",
        status: "done",
        createdAt: oldDate,
        due: null,
        priority: null,
        tags: [],
      },
    ]);

    const result = autoArchiveStale(tmpDir);
    assert.strictEqual(result.archived, 0);
  });

  it("leaves recent tasks alone", () => {
    tmpDir = makeTempDir();
    const recentDate = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    writeBrainDump(tmpDir, [
      {
        id: "bd_recent",
        title: "Recent task",
        status: "todo",
        createdAt: recentDate,
        due: null,
        priority: null,
        tags: [],
      },
    ]);

    const result = autoArchiveStale(tmpDir);
    assert.strictEqual(result.archived, 0);
  });
});

// ---------------------------------------------------------------------------
// Velocity cap
// ---------------------------------------------------------------------------

describe("mc-phase2: checkVelocityCap()", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("flags projects over default cap (5)", () => {
    tmpDir = makeTempDir();
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: `bd_${i}`,
      title: `Task ${i}`,
      status: "todo",
      project: "RT",
    }));
    writeBrainDump(tmpDir, tasks);

    const result = checkVelocityCap(tmpDir);
    assert.ok(result.exceeded.length > 0);
    const rtExceeded = result.exceeded.find((e) => e.project === "RT");
    assert.ok(rtExceeded, "RT should be in exceeded list");
    assert.strictEqual(rtExceeded.count, 7);
    assert.strictEqual(rtExceeded.cap, 5);
  });

  it("respects per-project overrides", () => {
    tmpDir = makeTempDir();
    writeVelocityConfig(tmpDir, { defaultCap: 5, perProject: { RT: 10 } });
    const tasks = Array.from({ length: 8 }, (_, i) => ({
      id: `bd_${i}`,
      title: `Task ${i}`,
      status: "todo",
      project: "RT",
    }));
    writeBrainDump(tmpDir, tasks);

    const result = checkVelocityCap(tmpDir);
    assert.strictEqual(result.exceeded.length, 0, "RT should be under custom cap of 10");
  });

  it("excludes done tasks from count", () => {
    tmpDir = makeTempDir();
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "T1", status: "todo", project: "VP" },
      { id: "bd_2", title: "T2", status: "done", project: "VP" },
      { id: "bd_3", title: "T3", status: "archived", project: "VP" },
    ]);

    const result = checkVelocityCap(tmpDir);
    assert.strictEqual(result.all.VP, 1, "only open tasks count");
  });

  it("returns all project counts", () => {
    tmpDir = makeTempDir();
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "T1", status: "todo", project: "RT" },
      { id: "bd_2", title: "T2", status: "todo", project: "VP" },
      { id: "bd_3", title: "T3", status: "todo", project: "GHN" },
    ]);

    const result = checkVelocityCap(tmpDir);
    assert.strictEqual(result.all.RT, 1);
    assert.strictEqual(result.all.VP, 1);
    assert.strictEqual(result.all.GHN, 1);
  });

  it("handles uncategorized tasks", () => {
    tmpDir = makeTempDir();
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "T1", status: "todo", project: null },
    ]);

    const result = checkVelocityCap(tmpDir);
    assert.strictEqual(result.all.uncategorized, 1);
  });
});

// ---------------------------------------------------------------------------
// API handler unit tests (sync portions)
// ---------------------------------------------------------------------------

describe("mc-phase2: kanban handler", () => {
  let tmpDir;
  let api;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const { createPhase2API } = require("../src/mc-phase2");
    api = createPhase2API({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function makeRes() {
    const r = { statusCode: null, body: "" };
    r.writeHead = (code) => { r.statusCode = code; };
    r.end = (data) => { if (typeof data === "string") r.body = data; };
    return r;
  }

  it("unsorted column returns only unsorted/backlog tasks", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "Unsorted", status: "unsorted" },
      { id: "bd_2", title: "Done", status: "done" },
    ]);

    const res = makeRes();
    api.kanban({ method: "GET", url: "/api/mc/kanban/unsorted", on: () => ({ on: () => {} }) }, res, "unsorted");
    const data = parseJsonResponse(res.body);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.cards[0].id, "bd_1");
  });

  it("done column returns done/archived tasks", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "Done", status: "done" },
      { id: "bd_2", title: "Archived", status: "archived" },
    ]);

    const res = makeRes();
    api.kanban({ method: "GET", url: "/api/mc/kanban/done", on: () => ({ on: () => {} }) }, res, "done");
    const data = parseJsonResponse(res.body);
    assert.strictEqual(data.count, 2);
  });

  it("kanban shows linkedCount", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_linked", title: "Linked", status: "todo", obsidianRef: "[[2026-06-09#^task-abc123]]" },
      { id: "bd_unlinked", title: "Unlinked", status: "todo" },
    ]);

    const res = makeRes();
    api.kanban({ method: "GET", url: "/api/mc/kanban/do-first", on: () => ({ on: () => {} }) }, res, "do-first");
    const data = parseJsonResponse(res.body);
    assert.strictEqual(data.linkedCount, 1);
    assert.strictEqual(data.count, 2);
  });

  it("do-first maps to todo/urgent-important status", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "Urgent", status: "urgent-important" },
      { id: "bd_2", title: "Generic todo", status: "todo" },
    ]);

    const res = makeRes();
    api.kanban({ method: "GET", url: "/api/mc/kanban/do-first", on: () => ({ on: () => {} }) }, res, "do-first");
    const data = parseJsonResponse(res.body);
    assert.ok(data.count >= 1);
  });
});

describe("mc-phase2: cardDelete handler (soft delete)", () => {
  let tmpDir;
  let api;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const { createPhase2API } = require("../src/mc-phase2");
    api = createPhase2API({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function makeRes() {
    const r = { statusCode: null, body: "" };
    r.writeHead = (code) => { r.statusCode = code; };
    r.end = (data) => { if (typeof data === "string") r.body = data; };
    return r;
  }

  it("soft-deletes card (sets status=archived)", () => {
    writeBrainDump(tmpDir, [{ id: "bd_to_delete", title: "Delete me", status: "todo" }]);

    const res = makeRes();
    api.cardDelete({ method: "DELETE", url: "/api/mc/card/bd_to_delete", on: () => ({ on: () => {} }) }, res, "bd_to_delete");
    const data = parseJsonResponse(res.body);
    assert.ok(data.ok);
    assert.strictEqual(data.card.status, "archived");

    // JSON still has the card (soft delete)
    const remaining = JSON.parse(fs.readFileSync(path.join(tmpDir, "brain-dump.json"), "utf8"));
    assert.strictEqual(remaining.length, 1);
  });

  it("returns 404 for unknown card", () => {
    const res = makeRes();
    api.cardDelete({ method: "DELETE", url: "/api/mc/card/nonexistent", on: () => ({ on: () => {} }) }, res, "nonexistent");
    assert.strictEqual(res.statusCode, 404);
  });
});

describe("mc-phase2: velocity handler", () => {
  let tmpDir;
  let api;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const { createPhase2API } = require("../src/mc-phase2");
    api = createPhase2API({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function makeRes() {
    const r = { statusCode: null, body: "" };
    r.writeHead = (code) => { r.statusCode = code; };
    r.end = (data) => { if (typeof data === "string") r.body = data; };
    return r;
  }

  it("returns velocity status", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_1", title: "T1", status: "todo", project: "RT" },
      { id: "bd_2", title: "T2", status: "todo", project: "RT" },
      { id: "bd_3", title: "T3", status: "todo", project: "RT" },
      { id: "bd_4", title: "T4", status: "todo", project: "RT" },
      { id: "bd_5", title: "T5", status: "todo", project: "RT" },
      { id: "bd_6", title: "T6", status: "todo", project: "RT" },
      { id: "bd_7", title: "T7", status: "todo", project: "VP" },
    ]);

    const res = makeRes();
    api.velocity({ method: "GET", url: "/api/mc/velocity", on: () => ({ on: () => {} }) }, res);
    const data = parseJsonResponse(res.body);
    assert.strictEqual(data.all.RT, 6);
    assert.strictEqual(data.all.VP, 1);
    assert.ok(data.exceeded.length > 0);
  });
});

describe("mc-phase2: cleanup handler", () => {
  let tmpDir;
  let api;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const { createPhase2API } = require("../src/mc-phase2");
    api = createPhase2API({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  function makeRes() {
    const r = { statusCode: null, body: "" };
    r.writeHead = (code) => { r.statusCode = code; };
    r.end = (data) => { if (typeof data === "string") r.body = data; };
    return r;
  }

  it("runs autoArchiveStale and checkVelocityCap", () => {
    const oldDate = new Date(Date.now() - 70 * 86400 * 1000).toISOString();
    writeBrainDump(tmpDir, [
      { id: "bd_old", title: "Old stale", status: "todo", createdAt: oldDate, due: null, priority: null, tags: [] },
      { id: "bd_new", title: "New task", status: "todo" },
    ]);

    const res = makeRes();
    api.cleanup({ method: "POST", url: "/api/mc/cleanup", on: () => ({ on: () => {} }) }, res);
    const data = parseJsonResponse(res.body);
    assert.ok(data.ok);
    assert.ok("autoArchived" in data);
    assert.ok("velocity" in data);
    assert.ok("doneSynced" in data);
  });
});