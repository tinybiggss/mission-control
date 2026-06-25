/**
 * Mission Control Phase 4 — Today / Outstanding / Mode tests
 *
 * Tests:
 *   - deriveMode() — mapping rules
 *   - filterTasksForToday() — Mike's inbox rules
 *   - filterTasksForOutstanding() — all open tasks
 *   - shapeTaskForView() — output shape
 *   - sortForToday / sortForOutstanding
 *   - promoteTaskToProject() — task → project
 *   - HTTP handlers: today, outstanding, tasks, promote-to-project
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  createMissionControlAPI,
  deriveMode,
  filterTasksForToday,
  filterTasksForOutstanding,
  shapeTaskForView,
  sortForToday,
  sortForOutstanding,
  applyPriorityFilter,
  applyProjectFilter,
  applyModeFilter,
  parseArrayParam,
  todayDateLA,
  ageDaysForTask,
  priorityEmojiForTask,
  promoteTaskToProject,
  readProjectRegistry,
  addBrainDump,
  readBrainDump,
} = require("../src/mission-control");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-phase4-test-"));
}

function writeBrainDump(dir, tasks) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "brain-dump.json"), JSON.stringify(tasks, null, 2));
}

function makeRes() {
  const r = { statusCode: null, body: "" };
  r.writeHead = (code) => {
    r.statusCode = code;
  };
  r.end = (data) => {
    if (typeof data === "string") r.body = data;
  };
  return r;
}

function parseBody(res) {
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------
// deriveMode
// ---------------------------------------------------------------------------

describe("mission-control: deriveMode()", () => {
  it("returns 'autonomous' for #assigned-corvus + assignee=corvus", () => {
    assert.strictEqual(
      deriveMode({ assignee: "corvus", tags: ["assigned-corvus"] }),
      "autonomous"
    );
  });

  it("returns 'autonomous' for assignee=corvus alone", () => {
    assert.strictEqual(deriveMode({ assignee: "corvus" }), "autonomous");
  });

  it("returns 'autonomous' for assignee=claude", () => {
    assert.strictEqual(deriveMode({ assignee: "claude" }), "autonomous");
  });

  it("returns 'planning' for #planning tag", () => {
    assert.strictEqual(deriveMode({ tags: ["planning"] }), "planning");
  });

  it("returns 'planning' for #assigned-mike tag", () => {
    assert.strictEqual(deriveMode({ tags: ["assigned-mike"] }), "planning");
  });

  it("returns 'planning' for assignee=mike", () => {
    assert.strictEqual(deriveMode({ assignee: "mike" }), "planning");
  });

  it("returns 'planning' for assignee=anna", () => {
    assert.strictEqual(deriveMode({ assignee: "anna" }), "planning");
  });

  it("returns null for legacy tasks (no assignee, no relevant tag)", () => {
    assert.strictEqual(deriveMode({}), null);
    assert.strictEqual(deriveMode({ assignee: null, tags: [] }), null);
    assert.strictEqual(deriveMode({ tags: ["random"] }), null);
  });

  it("is case-insensitive on tags", () => {
    assert.strictEqual(
      deriveMode({ assignee: "corvus", tags: ["Assigned-Corvus"] }),
      "autonomous"
    );
    assert.strictEqual(deriveMode({ tags: ["Planning"] }), "planning");
  });

  it("explicit mode passes through", () => {
    assert.strictEqual(deriveMode({ mode: "mixed" }), "mixed");
    assert.strictEqual(deriveMode({ mode: "autonomous" }), "autonomous");
  });
});

// ---------------------------------------------------------------------------
// filterTasksForToday
// ---------------------------------------------------------------------------

describe("mission-control: filterTasksForToday()", () => {
  it("includes mode=planning tasks", () => {
    const tasks = [
      { id: "t1", status: "todo", mode: "planning", due: "2026-06-25" },
    ];
    const out = filterTasksForToday(tasks, { today: "2026-06-25" });
    assert.strictEqual(out.length, 1);
  });

  it("includes mode=mixed tasks", () => {
    const tasks = [
      { id: "t1", status: "todo", mode: "mixed", due: null },
    ];
    const out = filterTasksForToday(tasks, { today: "2026-06-25" });
    assert.strictEqual(out.length, 1);
  });

  it("includes mode=null legacy tasks (needs triage)", () => {
    const tasks = [
      { id: "t1", status: "unsorted", mode: null, due: null },
    ];
    const out = filterTasksForToday(tasks, { today: "2026-06-25" });
    assert.strictEqual(out.length, 1);
  });

  it("EXCLUDES mode=autonomous tasks (those live in Agents tab)", () => {
    const tasks = [
      { id: "t1", status: "todo", mode: "autonomous", due: "2026-06-25" },
    ];
    const out = filterTasksForToday(tasks, { today: "2026-06-25" });
    assert.strictEqual(out.length, 0);
  });

  it("EXCLUDES done tasks", () => {
    const tasks = [
      { id: "t1", status: "done", mode: "planning" },
      { id: "t2", status: "archived", mode: "planning" },
    ];
    const out = filterTasksForToday(tasks, { today: "2026-06-25" });
    assert.strictEqual(out.length, 0);
  });

  it("includes due=today, due=past, due=null tasks; excludes future-dated", () => {
    const tasks = [
      { id: "today", status: "todo", mode: "planning", due: "2026-06-25" },
      { id: "past", status: "todo", mode: "planning", due: "2026-06-20" },
      { id: "null", status: "todo", mode: "planning", due: null },
      { id: "future", status: "todo", mode: "planning", due: "2026-07-01" },
    ];
    const out = filterTasksForToday(tasks, { today: "2026-06-25" });
    const ids = out.map((t) => t.id);
    assert.deepStrictEqual(ids.sort(), ["null", "past", "today"]);
  });
});

// ---------------------------------------------------------------------------
// filterTasksForOutstanding
// ---------------------------------------------------------------------------

describe("mission-control: filterTasksForOutstanding()", () => {
  it("includes all open tasks regardless of mode", () => {
    const tasks = [
      { id: "t1", status: "todo", mode: "planning" },
      { id: "t2", status: "todo", mode: "autonomous" },
      { id: "t3", status: "unsorted", mode: null },
    ];
    const out = filterTasksForOutstanding(tasks);
    assert.strictEqual(out.length, 3);
  });

  it("excludes done and archived", () => {
    const tasks = [
      { id: "t1", status: "todo" },
      { id: "t2", status: "done" },
      { id: "t3", status: "archived" },
    ];
    const out = filterTasksForOutstanding(tasks);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, "t1");
  });
});

// ---------------------------------------------------------------------------
// shapeTaskForView
// ---------------------------------------------------------------------------

describe("mission-control: shapeTaskForView()", () => {
  it("produces compact card shape with mode + priority + ageDays", () => {
    const t = {
      id: "bd_x",
      title: "Hello",
      status: "todo",
      priority: "urgent-important",
      due: "2026-06-25",
      project: "RT",
      assignee: "mike",
      tags: [],
      mode: "planning",
      modeSetBy: "auto",
      modeSetAt: "2026-06-25T00:00:00Z",
      postponeCount: 2,
      createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    };
    const shaped = shapeTaskForView(t);
    assert.strictEqual(shaped.id, "bd_x");
    assert.strictEqual(shaped.priority, "🔺");
    assert.strictEqual(shaped.mode, "planning");
    assert.strictEqual(shaped.modeLabel, "planning");
    assert.strictEqual(shaped.postponeCount, 2);
    assert.ok(shaped.ageDays >= 4 && shaped.ageDays <= 6, `ageDays=${shaped.ageDays}`);
  });

  it("maps mode=null to legacy badge (still null in payload)", () => {
    const t = { id: "x", title: "Legacy", status: "todo", mode: null };
    const shaped = shapeTaskForView(t);
    assert.strictEqual(shaped.mode, null);
  });

  it("falls back to rawText when title missing", () => {
    const t = { id: "x", status: "todo", rawText: "fallback title" };
    const shaped = shapeTaskForView(t);
    assert.strictEqual(shaped.title, "fallback title");
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe("mission-control: sortForToday()", () => {
  it("sorts by priority desc, then age desc", () => {
    const now = Date.now();
    const tasks = [
      { priority: "🔼", ageDays: 5 },
      { priority: "🔺", ageDays: 1 },
      { priority: "🔺", ageDays: 10 },
      { priority: "⏫", ageDays: 3 },
    ];
    const sorted = sortForToday(tasks, now);
    assert.strictEqual(sorted[0].priority, "🔺");
    assert.strictEqual(sorted[0].ageDays, 10);
    assert.strictEqual(sorted[1].priority, "🔺");
    assert.strictEqual(sorted[1].ageDays, 1);
    assert.strictEqual(sorted[2].priority, "⏫");
    assert.strictEqual(sorted[3].priority, "🔼");
  });
});

describe("mission-control: sortForOutstanding()", () => {
  it("sorts by age desc, then priority desc", () => {
    const tasks = [
      { priority: "🔺", ageDays: 1 },
      { priority: "🔺", ageDays: 10 },
      { priority: "⏼" /* actually any low-rank */, ageDays: 5 },
      { priority: "⏫", ageDays: 3 },
    ];
    // Use actual low-rank value to avoid surprises
    tasks[2].priority = "🔼";
    const sorted = sortForOutstanding(tasks);
    assert.strictEqual(sorted[0].ageDays, 10);
    assert.strictEqual(sorted[1].ageDays, 5);
    assert.strictEqual(sorted[2].ageDays, 3);
    assert.strictEqual(sorted[3].ageDays, 1);
  });
});

// ---------------------------------------------------------------------------
// apply*Filter helpers
// ---------------------------------------------------------------------------

describe("mission-control: applyPriorityFilter()", () => {
  it("filters by priority emojis", () => {
    const tasks = [
      { priority: "🔺" },
      { priority: "⏫" },
      { priority: "🔼" },
    ];
    const out = applyPriorityFilter(tasks, ["🔺", "⏫"]);
    assert.strictEqual(out.length, 2);
  });

  it("returns all when filter is empty", () => {
    const tasks = [{ priority: "🔺" }, { priority: "⏫" }];
    const out = applyPriorityFilter(tasks, []);
    assert.strictEqual(out.length, 2);
  });

  it("supports 'all' placeholder", () => {
    const tasks = [{ priority: "🔺" }, { priority: "⏫" }];
    const out = applyPriorityFilter(tasks, ["all"]);
    assert.strictEqual(out.length, 2);
  });
});

describe("mission-control: applyProjectFilter()", () => {
  it("filters case-insensitively", () => {
    const tasks = [{ project: "RT" }, { project: "VP" }, { project: null }];
    const out = applyProjectFilter(tasks, ["rt"]);
    assert.strictEqual(out.length, 1);
  });

  it("skips tasks with null project", () => {
    const tasks = [{ project: null }, { project: "RT" }];
    const out = applyProjectFilter(tasks, ["rt"]);
    assert.strictEqual(out.length, 1);
  });
});

describe("mission-control: applyModeFilter()", () => {
  it("matches by mode string", () => {
    const tasks = [
      { mode: "planning" },
      { mode: "autonomous" },
      { mode: null },
      { mode: "mixed" },
    ];
    const out = applyModeFilter(tasks, ["planning", "mixed"]);
    assert.strictEqual(out.length, 2);
  });

  it("treats null mode as 'legacy' when 'legacy' in filter", () => {
    const tasks = [{ mode: null }, { mode: "planning" }];
    const out = applyModeFilter(tasks, ["legacy"]);
    assert.strictEqual(out.length, 1);
  });
});

describe("mission-control: parseArrayParam()", () => {
  it("returns empty when no param", () => {
    const sp = new URLSearchParams("");
    assert.deepStrictEqual(parseArrayParam(sp, "priority"), []);
  });

  it("returns array of single param", () => {
    const sp = new URLSearchParams("priority=🔺");
    assert.deepStrictEqual(parseArrayParam(sp, "priority"), ["🔺"]);
  });

  it("supports multiple same-name params", () => {
    const sp = new URLSearchParams("priority=🔺&priority=⏫");
    assert.deepStrictEqual(parseArrayParam(sp, "priority"), ["🔺", "⏫"]);
  });

  it("supports comma-separated values", () => {
    const sp = new URLSearchParams("priority=🔺,⏫");
    assert.deepStrictEqual(parseArrayParam(sp, "priority"), ["🔺", "⏫"]);
  });
});

// ---------------------------------------------------------------------------
// ageDaysForTask / todayDateLA / priorityEmojiForTask
// ---------------------------------------------------------------------------

describe("mission-control: ageDaysForTask()", () => {
  it("computes age from createdAt", () => {
    const t = {
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    };
    const age = ageDaysForTask(t);
    assert.strictEqual(age, 3);
  });

  it("prefers lastTouchedAt over updatedAt", () => {
    const t = {
      createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      lastTouchedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    };
    assert.strictEqual(ageDaysForTask(t), 1);
  });

  it("returns 0 for missing timestamps", () => {
    assert.strictEqual(ageDaysForTask({}), 0);
  });
});

describe("mission-control: todayDateLA()", () => {
  it("returns YYYY-MM-DD", () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayDateLA()));
  });
});

describe("mission-control: priorityEmojiForTask()", () => {
  it("returns 🧊 for icebox status", () => {
    assert.strictEqual(priorityEmojiForTask({ status: "icebox" }), "🧊");
  });
  it("returns 🔺 for urgent-important", () => {
    assert.strictEqual(priorityEmojiForTask({ priority: "urgent-important" }), "🔺");
  });
  it("returns ⏫ for important-not-urgent", () => {
    assert.strictEqual(priorityEmojiForTask({ priority: "important-not-urgent" }), "⏫");
  });
  it("returns 🔼 for urgent-not-important", () => {
    assert.strictEqual(priorityEmojiForTask({ priority: "urgent-not-important" }), "🔼");
  });
  it("returns null when no priority/status mapping", () => {
    assert.strictEqual(priorityEmojiForTask({ status: "todo" }), null);
  });
});

// ---------------------------------------------------------------------------
// addBrainDump / updateBrainDumpTask mode stamping
// ---------------------------------------------------------------------------

describe("mission-control: addBrainDump() mode derivation", () => {
  let tmpDir;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it("new tasks get auto-derived mode", () => {
    tmpDir = makeTempDir();
    const t = addBrainDump(tmpDir, "hello world", { assignee: "corvus" });
    assert.strictEqual(t.mode, "autonomous");
    assert.strictEqual(t.modeSetBy, "auto");
    assert.ok(t.modeSetAt);
  });

  it("new tasks get explicit mode when passed", () => {
    tmpDir = makeTempDir();
    const t = addBrainDump(tmpDir, "x", { mode: "mixed" });
    assert.strictEqual(t.mode, "mixed");
    assert.strictEqual(t.modeSetBy, "mike");
  });

  it("new tasks with no assignee get mode=null (legacy)", () => {
    tmpDir = makeTempDir();
    const t = addBrainDump(tmpDir, "legacy task");
    assert.strictEqual(t.mode, null);
  });
});

// ---------------------------------------------------------------------------
// promoteTaskToProject
// ---------------------------------------------------------------------------

describe("mission-control: promoteTaskToProject()", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTempDir();
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it("creates a project entry and links the source task", () => {
    writeBrainDump(tmpDir, [
      {
        id: "bd_src",
        title: "Long-standing todo",
        status: "todo",
        mode: "planning",
        postponeCount: 3,
      },
    ]);

    const result = promoteTaskToProject(tmpDir, "bd_src");
    assert.ok(result.ok);
    assert.ok(result.project.id.startsWith("proj_"));
    assert.strictEqual(result.project.sourceTaskId, "bd_src");
    assert.strictEqual(result.project.status, "open");

    const registry = readProjectRegistry(tmpDir);
    assert.strictEqual(registry.length, 1);
    assert.strictEqual(registry[0].id, result.project.id);

    // Task is updated with type=project + promotedToProjectId
    const tasks = readBrainDump(tmpDir);
    assert.strictEqual(tasks[0].type, "project");
    assert.strictEqual(tasks[0].promotedToProjectId, result.project.id);
    assert.ok(tasks[0].promotedToProjectAt);
  });

  it("returns error when task not found", () => {
    const result = promoteTaskToProject(tmpDir, "missing");
    assert.strictEqual(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler: today
// ---------------------------------------------------------------------------

describe("mission-control: today handler", () => {
  let tmpDir;
  let api;
  beforeEach(() => {
    tmpDir = makeTempDir();
    api = createMissionControlAPI({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns only planning+mixed+legacy tasks (not autonomous)", () => {
    writeBrainDump(tmpDir, [
      {
        id: "p1",
        title: "Planning task",
        status: "todo",
        mode: "planning",
        priority: "urgent-important",
        due: "2026-06-25",
        createdAt: new Date().toISOString(),
      },
      {
        id: "a1",
        title: "Autonomous task",
        status: "todo",
        mode: "autonomous",
        assignee: "corvus",
        createdAt: new Date().toISOString(),
      },
      {
        id: "l1",
        title: "Legacy task",
        status: "unsorted",
        mode: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = makeRes();
    api.today({ url: "/api/mission/today", on: () => ({ on: () => {} }) }, res);
    const data = parseBody(res);
    assert.strictEqual(res.statusCode, 200);
    const ids = data.tasks.map((t) => t.id);
    assert.ok(ids.includes("p1"));
    assert.ok(!ids.includes("a1"), "autonomous tasks must be excluded from Today");
    assert.ok(ids.includes("l1"));
    assert.strictEqual(data.planningCount, 1);
    assert.strictEqual(data.autonomousCount, 0);
    assert.strictEqual(data.legacyCount, 1);
    assert.ok(data.today);
    assert.ok(data.asOf);
  });

  it("sorts tasks by priority desc, then age desc", () => {
    writeBrainDump(tmpDir, [
      {
        id: "low",
        title: "Low pri",
        status: "todo",
        mode: "planning",
        priority: "important-not-urgent",
        createdAt: new Date().toISOString(),
      },
      {
        id: "high",
        title: "High pri",
        status: "todo",
        mode: "planning",
        priority: "urgent-important",
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
    ]);

    const res = makeRes();
    api.today({ url: "/api/mission/today", on: () => ({ on: () => {} }) }, res);
    const data = parseBody(res);
    assert.strictEqual(data.tasks[0].id, "high");
  });

  it("flags overdue tasks", () => {
    writeBrainDump(tmpDir, [
      {
        id: "od",
        title: "Overdue",
        status: "todo",
        mode: "planning",
        priority: "urgent-important",
        due: "2025-01-01", // way in the past
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = makeRes();
    api.today({ url: "/api/mission/today", on: () => ({ on: () => {} }) }, res);
    const data = parseBody(res);
    assert.strictEqual(data.tasks[0].overdue, true);
  });

  it("supports ?priority= filter", () => {
    writeBrainDump(tmpDir, [
      {
        id: "u",
        title: "Urgent",
        status: "todo",
        mode: "planning",
        priority: "urgent-important",
        createdAt: new Date().toISOString(),
      },
      {
        id: "s",
        title: "Schedule",
        status: "todo",
        mode: "planning",
        priority: "important-not-urgent",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = makeRes();
    api.today(
      { url: "/api/mission/today?priority=%F0%9F%94%BA", on: () => ({ on: () => {} }) },
      res
    );
    const data = parseBody(res);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.tasks[0].id, "u");
  });
});

// ---------------------------------------------------------------------------
// HTTP handler: outstanding / tasks
// ---------------------------------------------------------------------------

describe("mission-control: outstanding handler", () => {
  let tmpDir;
  let api;
  beforeEach(() => {
    tmpDir = makeTempDir();
    api = createMissionControlAPI({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns ALL open tasks including autonomous", () => {
    writeBrainDump(tmpDir, [
      {
        id: "p1",
        title: "Planning",
        status: "todo",
        mode: "planning",
        createdAt: new Date().toISOString(),
      },
      {
        id: "a1",
        title: "Autonomous",
        status: "todo",
        mode: "autonomous",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = makeRes();
    api.outstanding({ url: "/api/mission/outstanding", on: () => ({ on: () => {} }) }, res);
    const data = parseBody(res);
    assert.strictEqual(data.count, 2);
  });

  it("supports ?mode=autonomous filter", () => {
    writeBrainDump(tmpDir, [
      { id: "p1", title: "P", status: "todo", mode: "planning", createdAt: new Date().toISOString() },
      { id: "a1", title: "A", status: "todo", mode: "autonomous", createdAt: new Date().toISOString() },
    ]);
    const res = makeRes();
    api.outstanding(
      { url: "/api/mission/outstanding?mode=autonomous", on: () => ({ on: () => {} }) },
      res
    );
    const data = parseBody(res);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.tasks[0].id, "a1");
  });

  it("supports ?priority= filter", () => {
    writeBrainDump(tmpDir, [
      { id: "u", title: "U", status: "todo", mode: "planning", priority: "urgent-important", createdAt: new Date().toISOString() },
      { id: "s", title: "S", status: "todo", mode: "planning", priority: "important-not-urgent", createdAt: new Date().toISOString() },
    ]);
    const res = makeRes();
    api.outstanding(
      { url: "/api/mission/outstanding?priority=%F0%9F%94%BA", on: () => ({ on: () => {} }) },
      res
    );
    const data = parseBody(res);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.tasks[0].id, "u");
  });

  it("sorts by age desc", () => {
    writeBrainDump(tmpDir, [
      { id: "new", title: "New", status: "todo", mode: "planning", createdAt: new Date().toISOString() },
      { id: "old", title: "Old", status: "todo", mode: "planning", createdAt: new Date(Date.now() - 30 * 86400000).toISOString() },
    ]);
    const res = makeRes();
    api.outstanding({ url: "/api/mission/outstanding", on: () => ({ on: () => {} }) }, res);
    const data = parseBody(res);
    assert.strictEqual(data.tasks[0].id, "old");
  });
});

// ---------------------------------------------------------------------------
// HTTP handler: promote-to-project
// ---------------------------------------------------------------------------

describe("mission-control: promoteToProject handler", () => {
  let tmpDir;
  let api;
  beforeEach(() => {
    tmpDir = makeTempDir();
    api = createMissionControlAPI({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it("creates project and returns it", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_promote", title: "Promote me", status: "todo", mode: "planning", postponeCount: 4 },
    ]);

    const res = makeRes();
    api.promoteToProject(
      { url: "/api/mission/tasks/bd_promote/promote-to-project", on: () => ({ on: () => {} }) },
      res,
      "bd_promote"
    );
    assert.strictEqual(res.statusCode, 200);
    const data = parseBody(res);
    assert.ok(data.ok);
    assert.ok(data.project.id.startsWith("proj_"));
  });

  it("returns 404 for missing task", () => {
    const res = makeRes();
    api.promoteToProject(
      { url: "/api/mission/tasks/missing/promote-to-project", on: () => ({ on: () => {} }) },
      res,
      "missing"
    );
    assert.strictEqual(res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler: projectsList
// ---------------------------------------------------------------------------

describe("mission-control: projectsList handler", () => {
  let tmpDir;
  let api;
  beforeEach(() => {
    tmpDir = makeTempDir();
    api = createMissionControlAPI({ getOpenClawDir: () => "/fake", dataDir: tmpDir });
  });
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns empty registry when nothing promoted yet", () => {
    const res = makeRes();
    api.projectsList({ url: "/api/mission/projects", on: () => ({ on: () => {} }) }, res);
    const data = parseBody(res);
    assert.strictEqual(data.count, 0);
    assert.deepStrictEqual(data.projects, []);
  });

  it("returns registry after promotion", () => {
    writeBrainDump(tmpDir, [
      { id: "bd_p1", title: "P1", status: "todo", mode: "planning" },
    ]);
    const res1 = makeRes();
    api.promoteToProject(
      { url: "/api/mission/tasks/bd_p1/promote-to-project", on: () => ({ on: () => {} }) },
      res1,
      "bd_p1"
    );

    const res2 = makeRes();
    api.projectsList({ url: "/api/mission/projects", on: () => ({ on: () => {} }) }, res2);
    const data = parseBody(res2);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.projects[0].sourceTaskId, "bd_p1");
  });
});