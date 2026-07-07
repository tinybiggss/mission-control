/**
 * Corvus dispatch (Phase 2) — tests
 *
 * Tests:
 *   - buildCaptureEntry() — intent mapping, schema, id format
 *   - appendCapture() — append preserving existing, create-if-missing, atomic
 *   - createDispatchAPI().dispatch — POST handler validation + success
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");

const { buildCaptureEntry, appendCapture, createDispatchAPI, INTENTS } = require("../src/dispatch");

function tmpQueue(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
  const file = path.join(dir, "capture-queue.json");
  if (initial !== undefined) fs.writeFileSync(file, JSON.stringify(initial, null, 2));
  return file;
}

describe("buildCaptureEntry", () => {
  const now = new Date("2026-07-07T10:00:00Z");
  it("maps capture → discussion_item with verbatim content", () => {
    const e = buildCaptureEntry({ intent: "capture", text: "an idea" }, now);
    assert.strictEqual(e.capture_type, "discussion_item");
    assert.strictEqual(e.content, "an idea");
    assert.strictEqual(e.source, "mission-control");
    assert.match(e.id, /^mc-dispatch-2026-07-07-an-idea-/);
    assert.strictEqual(e.captured_at, now.toISOString());
  });
  it("maps research/draft → action_item with vocabulary prefix", () => {
    assert.strictEqual(buildCaptureEntry({ intent: "research", text: "topic X" }, now).content, "research: topic X");
    assert.strictEqual(buildCaptureEntry({ intent: "research", text: "topic X" }, now).capture_type, "action_item");
    assert.strictEqual(buildCaptureEntry({ intent: "draft", text: "post Y" }, now).content, "draft: post Y");
  });
  it("appends context when provided", () => {
    const e = buildCaptureEntry({ intent: "capture", text: "idea", context: "from Focus Deck" }, now);
    assert.match(e.content, /\[context: from Focus Deck\]$/);
  });
});

describe("appendCapture", () => {
  it("appends to an existing queue, preserving prior entries", () => {
    const file = tmpQueue([{ id: "existing-1", content: "old" }]);
    const len = appendCapture(file, { id: "new-1", content: "new" });
    assert.strictEqual(len, 2);
    const queue = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(queue[0].id, "existing-1");
    assert.strictEqual(queue[1].id, "new-1");
    assert.ok(!fs.existsSync(file + ".tmp"), "no temp file left behind");
  });
  it("creates the file when missing", () => {
    const file = tmpQueue(undefined);
    const len = appendCapture(file, { id: "first" });
    assert.strictEqual(len, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8"))[0].id, "first");
  });
  it("recovers from corrupt json by starting a fresh array", () => {
    const file = tmpQueue(undefined);
    fs.writeFileSync(file, "{not json");
    const len = appendCapture(file, { id: "x" });
    assert.strictEqual(len, 1);
  });
});

function fakeReq(bodyObj) {
  const req = new EventEmitter();
  process.nextTick(() => {
    req.emit("data", typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj));
    req.emit("end");
  });
  return req;
}

function fakeRes(done) {
  return {
    statusCode: null,
    body: "",
    writeHead(code) {
      this.statusCode = code;
    },
    end(data) {
      this.body = data || "";
      done(this);
    },
  };
}

function postDispatch(api, body) {
  return new Promise((resolve) => {
    api.dispatch(fakeReq(body), fakeRes(resolve));
  });
}

describe("createDispatchAPI", () => {
  it("appends a valid dispatch and returns ok", async () => {
    const file = tmpQueue([]);
    const api = createDispatchAPI({ queueFile: file });
    const res = await postDispatch(api, { intent: "research", text: "look into X" });
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.ok, true);
    assert.match(parsed.id, /^mc-dispatch-/);
    assert.strictEqual(parsed.queueLength, 1);
    const queue = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(queue[0].content, "research: look into X");
  });
  it("rejects bad intent, empty text, oversize text and bad JSON", async () => {
    const file = tmpQueue([]);
    const api = createDispatchAPI({ queueFile: file });
    assert.strictEqual((await postDispatch(api, { intent: "yolo", text: "x" })).statusCode, 400);
    assert.strictEqual((await postDispatch(api, { intent: "capture", text: "  " })).statusCode, 400);
    assert.strictEqual(
      (await postDispatch(api, { intent: "capture", text: "x".repeat(2001) })).statusCode,
      400,
    );
    assert.strictEqual((await postDispatch(api, "{nope")).statusCode, 400);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).length, 0, "nothing appended");
  });
});

describe("INTENTS", () => {
  it("exposes exactly the three vocabulary intents", () => {
    assert.deepStrictEqual(Object.keys(INTENTS).sort(), ["capture", "draft", "research"]);
  });
});
