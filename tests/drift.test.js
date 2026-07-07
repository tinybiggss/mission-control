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
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  titleKeyFor,
  findTaskLine,
  applyAction,
  newestDailyNote,
  listDrifting,
  runDriftAction,
  createDriftAPI,
} = require("../src/drift");

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

// ---------------------------------------------------------------------------
// Note IO + list + action + HTTP
// ---------------------------------------------------------------------------

function makeNoteDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-notes-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function makeQueueFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-queue-"));
  const file = path.join(dir, "capture-queue.json");
  fs.writeFileSync(file, "[]");
  return file;
}

describe("newestDailyNote", () => {
  it("picks the lexicographically newest daily note, ignoring backups", () => {
    const dir = makeNoteDir({
      "2026-07-05.md": "a",
      "2026-07-06.md": "b",
      "2026-07-06.md.backup": "c",
      "notes.txt": "d",
    });
    assert.ok(newestDailyNote(dir).endsWith("2026-07-06.md"));
  });
  it("returns null for missing/empty dirs", () => {
    assert.strictEqual(newestDailyNote("/nonexistent/nope"), null);
    assert.strictEqual(newestDailyNote(makeNoteDir({})), null);
  });
});

describe("listDrifting", () => {
  it("returns open ↩10+ tasks sorted by postpone desc", () => {
    const tasks = [
      { text: "**way stuck** 🔼", postpone: 29, is_completed: false, project: "GHN" },
      { text: "**mildly stuck** 🔼", postpone: 12, is_completed: false, project: "RT" },
      { text: "**fine**", postpone: 2, is_completed: false },
      { text: "**stuck but done**", postpone: 20, is_completed: true },
      { text: "[↩:: 15]", postpone: 15, is_completed: false }, // metadata-only row
    ];
    const list = listDrifting(() => ({ tasks }));
    assert.deepStrictEqual(list.map((t) => t.postpone), [29, 12]);
    assert.strictEqual(list[0].text, "way stuck");
  });
});

const NOTE_BODY = [
  "# Daily",
  "- [ ] **Stuck task — needs decision** 🔺 ➕ 2026-06-15 📅 2026-07-02 [↩:: 17] #assigned-mike",
  "- [ ] **Other task** 🔼",
].join("\n");

describe("runDriftAction", () => {
  it("set-due rewrites the line in the newest note atomically", () => {
    const noteDir = makeNoteDir({ "2026-07-05.md": "old", "2026-07-06.md": NOTE_BODY });
    const r = runDriftAction(
      { noteDir, queueFile: makeQueueFile(), today: "2026-07-07" },
      { task: "Stuck task — needs decision", action: "set-due", due: "2026-07-14" },
    );
    assert.strictEqual(r.ok, true);
    const content = fs.readFileSync(path.join(noteDir, "2026-07-06.md"), "utf8");
    assert.ok(content.includes("📅 2026-07-14"));
    assert.ok(!content.includes("📅 2026-07-02"));
    assert.ok(!fs.existsSync(path.join(noteDir, "2026-07-06.md.tmp")));
  });
  it("delegate rewrites the tag and queues a standup discussion item", () => {
    const noteDir = makeNoteDir({ "2026-07-06.md": NOTE_BODY });
    const queueFile = makeQueueFile();
    const r = runDriftAction(
      { noteDir, queueFile, today: "2026-07-07" },
      { task: "Stuck task — needs decision", action: "delegate" },
    );
    assert.strictEqual(r.ok, true);
    const content = fs.readFileSync(path.join(noteDir, "2026-07-06.md"), "utf8");
    assert.ok(content.includes("#assigned-corvus"));
    assert.ok(!content.includes("#assigned-mike"));
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf8"));
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].capture_type, "discussion_item");
    assert.match(queue[0].content, /Stuck task — needs decision/);
  });
  it("drop cancels the line with a ❌ stamp", () => {
    const noteDir = makeNoteDir({ "2026-07-06.md": NOTE_BODY });
    const r = runDriftAction(
      { noteDir, queueFile: makeQueueFile(), today: "2026-07-07" },
      { task: "Stuck task — needs decision", action: "drop" },
    );
    assert.strictEqual(r.ok, true);
    const content = fs.readFileSync(path.join(noteDir, "2026-07-06.md"), "utf8");
    assert.ok(content.includes("- [-] **Stuck task"));
    assert.ok(content.includes("❌ 2026-07-07"));
  });
  it("refuses on not-found, bad action, bad due", () => {
    const noteDir = makeNoteDir({ "2026-07-06.md": NOTE_BODY });
    const deps = { noteDir, queueFile: makeQueueFile(), today: "2026-07-07" };
    assert.strictEqual(runDriftAction(deps, { task: "no such task", action: "drop" }).status, 404);
    assert.strictEqual(runDriftAction(deps, { task: "Stuck", action: "explode" }).status, 400);
    assert.strictEqual(
      runDriftAction(deps, { task: "Stuck", action: "set-due", due: "next tuesday" }).status,
      400,
    );
    const content = fs.readFileSync(path.join(noteDir, "2026-07-06.md"), "utf8");
    assert.strictEqual(content, NOTE_BODY, "note untouched on refusals");
  });
});

describe("createDriftAPI", () => {
  function res(done) {
    return {
      statusCode: null,
      body: "",
      writeHead(code) { this.statusCode = code; },
      end(data) { this.body = data || ""; done(this); },
    };
  }
  it("GET list serves drifting tasks", () => {
    const api = createDriftAPI({ readTasks: () => ({ tasks: [{ text: "**x task**", postpone: 15, is_completed: false }] }) });
    let out;
    api.list({}, res((r) => (out = r)));
    assert.strictEqual(out.statusCode, 200);
    assert.strictEqual(JSON.parse(out.body).tasks.length, 1);
  });
  it("POST action returns the runDriftAction result envelope", async () => {
    const noteDir = makeNoteDir({ "2026-07-06.md": NOTE_BODY });
    const api = createDriftAPI({ noteDir, queueFile: makeQueueFile(), today: "2026-07-07" });
    const { EventEmitter } = require("events");
    const req = new EventEmitter();
    const result = await new Promise((resolve) => {
      api.action(req, res(resolve));
      req.emit("data", JSON.stringify({ task: "Other task", action: "drop" }));
      req.emit("end");
    });
    assert.strictEqual(result.statusCode, 200);
    assert.match(JSON.parse(result.body).after, /^- \[-\]/);
  });
});
