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

const {
  scoreTask,
  cleanTaskText,
  bucketForProject,
  pickFocus,
  shapeTask,
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
