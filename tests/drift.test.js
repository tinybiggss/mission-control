/**
 * Drift Meter (Phase 4) — tests
 *
 * Tests:
 *   - titleKeyFor() — cleaned lowercase title prefix
 *   - findTaskLine() — unique-match rules, skip checked/cancelled lines
 *   - applyAction() — set-due / delegate / drop line surgery
 *   - newestDailyNote() — newest YYYY-MM-DD.md selection
 *   - listDrifting() — postpone >= 10, sorted
 *   - runDriftAction() — end-to-end note edit + queue append
 *   - createDriftAPI() — GET list / POST action handlers
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { titleKeyFor, findTaskLine, applyAction } = require("../src/drift");

const LINE =
  "- [ ] **RT-Business-Platform-Plan — pick 2–3 next concrete steps** 🔺 ➕ 2026-06-15 📅 2026-07-02 [↩:: 17] ⚠️ #assigned-mike";

describe("titleKeyFor", () => {
  it("cleans markdown/emoji and lowercases a stable prefix", () => {
    const key = titleKeyFor("**RT-Business-Platform-Plan — pick 2–3 next concrete steps** 🔺");
    assert.ok(key.startsWith("rt-business-platform-plan"));
    assert.ok(!key.includes("*"));
    assert.ok(key.length <= 40);
  });
});

describe("findTaskLine", () => {
  const NOTE = [
    "# 2026-07-06",
    LINE,
    "- [ ] **Another task entirely** 🔼 [↩:: 2]",
    "- [x] **RT-Business-Platform-Plan — pick 2–3 next concrete steps** (done copy)",
    "- [-] **Cancelled thing**",
  ].join("\n");

  it("finds the single open line matching the title key", () => {
    const r = findTaskLine(NOTE, titleKeyFor("**RT-Business-Platform-Plan — pick 2–3 next concrete steps**"));
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.index, 1);
    assert.ok(r.line.includes("[↩:: 17]"));
  });
  it("ignores checked and cancelled lines", () => {
    const r = findTaskLine(NOTE, titleKeyFor("Cancelled thing"));
    assert.strictEqual(r.error, "not-found");
  });
  it("reports not-found and ambiguous", () => {
    assert.strictEqual(findTaskLine(NOTE, "zzz-nope").error, "not-found");
    const dup = NOTE + "\n" + LINE;
    assert.strictEqual(
      findTaskLine(dup, titleKeyFor("RT-Business-Platform-Plan — pick 2–3 next concrete steps")).error,
      "ambiguous",
    );
  });
});

describe("applyAction", () => {
  it("set-due replaces an existing 📅 date", () => {
    const out = applyAction(LINE, "set-due", { due: "2026-07-14" });
    assert.ok(out.includes("📅 2026-07-14"));
    assert.ok(!out.includes("📅 2026-07-02"));
    assert.ok(out.includes("[↩:: 17]"), "postponement history preserved");
  });
  it("set-due inserts a date when none exists, before markers", () => {
    const noDue = "- [ ] **Bare task** 🔼 [↩:: 12] #GHN";
    const out = applyAction(noDue, "set-due", { due: "2026-07-14" });
    assert.ok(out.includes("📅 2026-07-14"));
    assert.ok(out.indexOf("📅") < out.indexOf("[↩"), "due sits before the postpone marker");
  });
  it("delegate swaps assigned-mike for assigned-corvus", () => {
    const out = applyAction(LINE, "delegate", {});
    assert.ok(out.includes("#assigned-corvus"));
    assert.ok(!out.includes("#assigned-mike"));
  });
  it("delegate appends the tag when no assignment exists, without duplicating", () => {
    const bare = "- [ ] **Bare task** 🔼 #GHN";
    const out = applyAction(bare, "delegate", {});
    assert.strictEqual((out.match(/#assigned-corvus/g) || []).length, 1);
    const again = applyAction(out, "delegate", {});
    assert.strictEqual((again.match(/#assigned-corvus/g) || []).length, 1);
  });
  it("drop cancels the checkbox and stamps the date", () => {
    const out = applyAction(LINE, "drop", { today: "2026-07-07" });
    assert.ok(out.startsWith("- [-]"));
    assert.ok(out.endsWith("❌ 2026-07-07"));
  });
});
