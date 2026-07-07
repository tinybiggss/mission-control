/**
 * Focus Deck (Phase 1) — tests
 *
 * Tests:
 *   - scoreTask() — priority/due/postpone/assigned weighting
 *   - cleanTaskText() — markdown + emoji stripping
 *   - bucketForProject() — project → North Star bucket mapping
 *   - pickFocus() — hero/next/low-energy selection, corvus exclusion
 *   - shapeTask() — panel output shape incl. obsidian URI
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  scoreTask,
  cleanTaskText,
  bucketForProject,
  pickFocus,
  shapeTask,
  readLatestTaskData,
  readNorthStar,
  computeFocus,
  createFocusAPI,
} = require("../src/focus");

const T = (over = {}) => ({
  text: "**Do the thing** — details 🔼",
  created: "2026-07-01",
  due: null,
  postpone: 0,
  is_completed: false,
  tags: [],
  priority: "🔼",
  assigned: null,
  project: "GHN",
  source_file:
    "/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space/Week and Daily Plans/2026-07-05.md",
  ...over,
});

describe("scoreTask", () => {
  const today = "2026-07-06";
  it("returns -Infinity for completed or empty tasks", () => {
    assert.strictEqual(scoreTask(T({ is_completed: true }), today), -Infinity);
    assert.strictEqual(scoreTask(T({ text: "" }), today), -Infinity);
  });
  it("weights priority emoji", () => {
    assert.ok(scoreTask(T({ priority: "🔺" }), today) > scoreTask(T({ priority: "🔽" }), today));
  });
  it("boosts overdue and near-due", () => {
    const overdue = scoreTask(T({ due: "2026-07-02" }), today);
    const nearDue = scoreTask(T({ due: "2026-07-07" }), today);
    const noDue = scoreTask(T(), today);
    assert.ok(overdue > nearDue);
    assert.ok(nearDue > noDue);
  });
  it("boosts chronic postponement in steps", () => {
    assert.ok(scoreTask(T({ postpone: 29 }), today) > scoreTask(T({ postpone: 12 }), today));
    assert.ok(scoreTask(T({ postpone: 12 }), today) > scoreTask(T({ postpone: 3 }), today));
  });
  it("boosts assigned-mike", () => {
    assert.ok(scoreTask(T({ assigned: "mike" }), today) > scoreTask(T(), today));
  });
});

describe("cleanTaskText", () => {
  it("strips markdown bold and trailing priority emoji", () => {
    assert.strictEqual(cleanTaskText("**Review GHN course** — gaps 🔼"), "Review GHN course — gaps");
    assert.strictEqual(cleanTaskText("plain text"), "plain text");
  });
});

describe("bucketForProject", () => {
  it("maps projects to North Star buckets", () => {
    assert.strictEqual(bucketForProject("GHN"), "money");
    assert.strictEqual(bucketForProject("Velocity Partners"), "money");
    assert.strictEqual(bucketForProject("Resilient Tomorrow"), "legacy");
    assert.strictEqual(bucketForProject("Solar / NeighborhoodShare"), "legacy");
    assert.strictEqual(bucketForProject("Personal / Family"), "family");
    assert.strictEqual(bucketForProject("Uncategorized"), null);
  });
});

describe("pickFocus", () => {
  const today = "2026-07-06";
  it("puts the highest-scoring mike-side task first and excludes corvus tasks", () => {
    const tasks = [
      T({ text: "corvus job ⏫", priority: "⏫", assigned: "corvus" }),
      T({ text: "**big one** 🔺", priority: "🔺", due: "2026-07-02", postpone: 16, assigned: "mike" }),
      T({ text: "medium 🔼" }),
      T({ text: "small 🔽", priority: "🔽" }),
    ];
    const { hero, next, corvusPlate } = pickFocus(tasks, today);
    assert.match(hero.text, /big one/);
    assert.strictEqual(next.length, 2);
    assert.strictEqual(corvusPlate, 1);
    assert.ok(!next.some((t) => /corvus job/.test(t.text)));
  });
  it("offers a low-energy pick that is not the hero", () => {
    const tasks = [
      T({ text: "**big one** 🔺", priority: "🔺", due: "2026-07-02", postpone: 16 }),
      T({ text: "small win 🔽", priority: "🔽", postpone: 1 }),
    ];
    const { hero, lowEnergyPick } = pickFocus(tasks, today);
    assert.match(hero.text, /big one/);
    assert.match(lowEnergyPick.text, /small win/);
  });
  it("handles empty task lists", () => {
    const { hero, next, lowEnergyPick } = pickFocus([], today);
    assert.strictEqual(hero, null);
    assert.deepStrictEqual(next, []);
    assert.strictEqual(lowEnergyPick, null);
  });
});

function makeTempVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-test-"));
  fs.mkdirSync(path.join(dir, "Task Data"), { recursive: true });
  return dir;
}

const SIDE = (date, tasks, extra = {}) => ({
  date,
  generated_at: `${date}T06:05:00`,
  generator: "task-rollover.py v1.0 (Phase 1)",
  tasks,
  calendar_events: [{ title: "GHN Super Cohort", time: "today at 10:00 AM - 11:00 AM", raw: "" }],
  metadata: { total_open: tasks.length },
  ...extra,
});

describe("readLatestTaskData", () => {
  it("reads the newest YYYY-MM-DD-tasks.json", () => {
    const vault = makeTempVault();
    const tdd = path.join(vault, "Task Data");
    fs.writeFileSync(path.join(tdd, "2026-07-05-tasks.json"), JSON.stringify(SIDE("2026-07-05", [])));
    fs.writeFileSync(path.join(tdd, "2026-07-06-tasks.json"), JSON.stringify(SIDE("2026-07-06", [T()])));
    fs.writeFileSync(path.join(tdd, "notes.txt"), "ignore me");
    const data = readLatestTaskData(tdd);
    assert.strictEqual(data.date, "2026-07-06");
    assert.strictEqual(data.tasks.length, 1);
  });
  it("returns null when the dir is missing or empty", () => {
    assert.strictEqual(readLatestTaskData("/nonexistent/nope"), null);
    const vault = makeTempVault();
    assert.strictEqual(readLatestTaskData(path.join(vault, "Task Data")), null);
  });
});

describe("readNorthStar", () => {
  it("extracts the vision quote and returns the five buckets", () => {
    const vault = makeTempVault();
    const nsFile = path.join(vault, "North Star.md");
    fs.writeFileSync(
      nsFile,
      '# North Star\n\n## The Vision\n\n**"A life where I work 4 hours a day."**\n\n## What I Actually Want\n\n### Money & Security\n- x\n### Health\n- x\n',
    );
    const ns = readNorthStar(nsFile);
    assert.match(ns.vision, /4 hours a day/);
    assert.strictEqual(ns.buckets.length, 5);
    assert.strictEqual(ns.buckets[0].key, "money");
  });
  it("falls back to static buckets when the file is missing", () => {
    const ns = readNorthStar("/nonexistent/ns.md");
    assert.strictEqual(ns.buckets.length, 5);
    assert.strictEqual(ns.vision, null);
  });
});

describe("computeFocus", () => {
  it("assembles the full payload", () => {
    const vault = makeTempVault();
    const tdd = path.join(vault, "Task Data");
    const nsFile = path.join(vault, "North Star.md");
    fs.writeFileSync(nsFile, '## The Vision\n\n**"Vision here."**\n');
    fs.writeFileSync(
      path.join(tdd, "2026-07-06-tasks.json"),
      JSON.stringify(
        SIDE("2026-07-06", [
          T({ text: "**hero task** 🔺", priority: "🔺", due: "2026-07-02", postpone: 16, project: "GHN" }),
          T({ text: "second 🔼", project: "Resilient Tomorrow" }),
          T({ text: "corvus thing ⏫", assigned: "corvus" }),
          T({ text: "done", is_completed: true }),
        ]),
      ),
    );
    const f = computeFocus({ taskDataDir: tdd, northStarFile: nsFile, today: "2026-07-06" });
    assert.strictEqual(f.available, true);
    assert.strictEqual(f.date, "2026-07-06");
    assert.match(f.now.hero.text, /hero task/);
    assert.strictEqual(f.now.next.length, 1);
    assert.strictEqual(f.counts.corvusPlate, 1);
    assert.strictEqual(f.counts.open, 3);
    assert.strictEqual(f.counts.overdue, 1);
    assert.strictEqual(f.counts.drifting, 1);
    assert.strictEqual(f.calendar.length, 1);
    assert.match(f.northStar.vision, /Vision here/);
    // bucket task counts laddered
    const money = f.northStar.buckets.find((b) => b.key === "money");
    assert.strictEqual(money.taskCount, 1);
  });
  it("degrades honestly when no sidecar exists", () => {
    const f = computeFocus({
      taskDataDir: "/nonexistent",
      northStarFile: "/nonexistent",
      today: "2026-07-06",
    });
    assert.strictEqual(f.available, false);
    assert.strictEqual(f.northStar.buckets.length, 5);
  });
});

describe("createFocusAPI", () => {
  it("serves JSON over the handler", () => {
    const api = createFocusAPI({ taskDataDir: "/nonexistent", northStarFile: "/nonexistent" });
    const res = {
      statusCode: null,
      body: "",
      writeHead(code) {
        this.statusCode = code;
      },
      end(data) {
        this.body = data;
      },
    };
    api.list({}, res);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.available, false);
  });
});

describe("shapeTask", () => {
  it("emits the panel shape incl. obsidian URI", () => {
    const s = shapeTask(T({ due: "2026-07-02", postpone: 29, tags: ["#GHN"] }), "2026-07-06");
    assert.strictEqual(s.text, "Do the thing — details");
    assert.strictEqual(s.project, "GHN");
    assert.strictEqual(s.bucket, "money");
    assert.strictEqual(s.due, "2026-07-02");
    assert.strictEqual(s.overdue, true);
    assert.strictEqual(s.postpone, 29);
    assert.strictEqual(s.priority, "🔼");
    assert.ok(s.obsidianUri.startsWith("obsidian://open?vault=Mike_Thinking_Space&file="));
    assert.ok(s.obsidianUri.includes("Week%20and%20Daily%20Plans"));
  });
});
