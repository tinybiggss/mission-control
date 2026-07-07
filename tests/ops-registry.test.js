/**
 * Unified Ops Registry (Phase 3) — tests
 *
 * Tests:
 *   - parseLaunchctlList / plistSchedule / parseCrontab — source parsers
 *   - shapeOpenclawCron / shapeLaunchAgent — status derivation
 *   - summarize / timeline — rollups
 *   - computeOps / createOpsAPI — assembly + HTTP
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  parseLaunchctlList,
  plistSchedule,
  parseCrontab,
  shapeOpenclawCron,
  shapeLaunchAgent,
  summarize,
  timeline,
  computeOps,
  createOpsAPI,
} = require("../src/ops-registry");

describe("parseLaunchctlList", () => {
  it("maps labels to pid/lastExit, '-' pid → null", () => {
    const text = [
      "PID\tStatus\tLabel",
      "-\t0\tlocal.mike.task-rollover",
      "912\t0\tlocal.mike.corvus-dashboard",
      "-\t1\tlocal.mike.inbox-processor",
      "82788\t-15\tcom.mike.mission-control",
    ].join("\n");
    const map = parseLaunchctlList(text);
    assert.deepStrictEqual(map["local.mike.task-rollover"], { pid: null, lastExit: 0 });
    assert.deepStrictEqual(map["local.mike.corvus-dashboard"], { pid: 912, lastExit: 0 });
    assert.deepStrictEqual(map["local.mike.inbox-processor"], { pid: null, lastExit: 1 });
    assert.strictEqual(map["PID"], undefined, "header row skipped");
  });
});

describe("plistSchedule", () => {
  it("describes KeepAlive services", () => {
    assert.strictEqual(plistSchedule({ KeepAlive: true }), "always-on service");
    assert.strictEqual(plistSchedule({ KeepAlive: { SuccessfulExit: false } }), "always-on service");
  });
  it("describes StartInterval", () => {
    assert.strictEqual(plistSchedule({ StartInterval: 3600 }), "every 60 min");
    assert.strictEqual(plistSchedule({ StartInterval: 90 }), "every 90 sec");
  });
  it("describes calendar intervals incl. weekday arrays", () => {
    assert.strictEqual(plistSchedule({ StartCalendarInterval: { Hour: 10, Minute: 0 } }), "daily at 10:00");
    assert.strictEqual(
      plistSchedule({
        StartCalendarInterval: [
          { Hour: 8, Minute: 0, Weekday: 1 },
          { Hour: 8, Minute: 0, Weekday: 5 },
        ],
      }),
      "Mon, Fri at 8:00",
    );
  });
  it("falls back for schedule-less plists", () => {
    assert.strictEqual(plistSchedule({ RunAtLoad: true }), "at login");
    assert.strictEqual(plistSchedule({}), "manual");
  });
});

describe("parseCrontab", () => {
  it("parses entries, skipping comments and blanks", () => {
    const text = [
      "# comment",
      "",
      "30 6 * * * /Users/mike/.openclaw/scripts/cross-system-context-refresh.sh >/dev/null 2>&1",
      "0 * * * * /Users/mike/.openclaw/scripts/rotate-openclaw-logs.sh",
    ].join("\n");
    const items = parseCrontab(text);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].name, "cross-system-context-refresh.sh");
    assert.match(items[0].schedule, /6:30am|Daily at 6:30/i);
    assert.match(items[1].schedule, /Hourly/);
    assert.strictEqual(items[0].source, "crontab");
  });
});

describe("shapeOpenclawCron", () => {
  const job = { id: "u1", name: "rt-rss-fetcher", enabled: true, schedule: { kind: "cron", expr: "0 7 * * *" } };
  it("derives ok/failing/disabled", () => {
    const ok = shapeOpenclawCron(job, { state: { lastRunAtMs: 5, lastRunStatus: "ok" } });
    assert.strictEqual(ok.status, "ok");
    assert.strictEqual(ok.source, "openclaw-cron");
    assert.match(ok.schedule, /7am|Daily/);
    const failing = shapeOpenclawCron(job, { state: { lastRunAtMs: 5, lastRunStatus: "error", consecutiveErrors: 3 } });
    assert.strictEqual(failing.status, "failing");
    assert.match(failing.detail, /3 consecutive/);
    const disabled = shapeOpenclawCron({ ...job, enabled: false }, null);
    assert.strictEqual(disabled.status, "disabled");
  });
});

describe("shapeLaunchAgent", () => {
  const PARKED = new Set(["local.mike.corvus-scheduler"]);
  it("running / failing / ok / parked / not-loaded", () => {
    assert.strictEqual(
      shapeLaunchAgent("a", { KeepAlive: true }, { pid: 99, lastExit: 0 }, PARKED).status,
      "running",
    );
    assert.strictEqual(
      shapeLaunchAgent("b", {}, { pid: null, lastExit: 1 }, PARKED).status,
      "failing",
    );
    assert.strictEqual(
      shapeLaunchAgent("c", { StartCalendarInterval: { Hour: 6 } }, { pid: null, lastExit: 0 }, PARKED).status,
      "ok",
    );
    const parked = shapeLaunchAgent("local.mike.corvus-scheduler", {}, undefined, PARKED);
    assert.strictEqual(parked.status, "parked");
    assert.match(parked.detail, /by design/i);
    assert.strictEqual(shapeLaunchAgent("d", {}, undefined, PARKED).status, "not-loaded");
  });
});

describe("summarize + timeline", () => {
  const NOW = 1000 * 3600 * 24;
  const items = [
    { status: "ok", lastRunAt: NOW - 3600e3, nextRunAt: NOW + 3600e3, name: "a" },
    { status: "failing", lastRunAt: NOW - 2 * 3600e3, name: "b" },
    { status: "running", name: "c" },
    { status: "parked", name: "d" },
    { status: "disabled", name: "e" },
    { status: "ok", lastRunAt: NOW - 20 * 3600e3, nextRunAt: NOW + 2 * 3600e3, name: "f" },
  ];
  it("summarize counts statuses", () => {
    const s = summarize(items);
    assert.deepStrictEqual(s, { total: 6, ok: 2, running: 1, failing: 1, parked: 1, disabled: 1, notLoaded: 0 });
  });
  it("timeline windows recent 12h and sorts upcoming", () => {
    const t = timeline(items, NOW);
    assert.deepStrictEqual(t.recent.map((r) => r.name), ["a", "b"]);
    assert.deepStrictEqual(t.upcoming.map((r) => r.name), ["a", "f"]);
  });
});

describe("computeOps + createOpsAPI", () => {
  const deps = {
    readCronJobs: () => ({ jobs: [{ id: "u1", name: "job1", enabled: true, schedule: { kind: "cron", expr: "0 7 * * *" } }] }),
    readCronState: () => ({ jobs: { u1: { state: { lastRunAtMs: 10, lastRunStatus: "ok" } } } }),
    listPlists: () => [{ label: "local.mike.thing", plist: { KeepAlive: true } }],
    readLaunchctl: () => "1\t0\tlocal.mike.thing",
    readCrontabText: () => "0 * * * * /x/rotate.sh",
    now: 12 * 3600e3,
  };
  it("assembles groups, summary, sources health", () => {
    const r = computeOps(deps);
    assert.strictEqual(r.groups.openclawCron.length, 1);
    assert.strictEqual(r.groups.launchAgents.length, 1);
    assert.strictEqual(r.groups.crontab.length, 1);
    assert.strictEqual(r.summary.total, 3);
    assert.strictEqual(r.summary.running, 1);
    assert.ok(r.sources.crontab === "ok");
  });
  it("dedupes LaunchAgents sharing one label and flags the duplicate plist", () => {
    const r = computeOps({
      ...deps,
      listPlists: () => [
        { label: "local.mike.thing", plist: { KeepAlive: true } },
        { label: "local.mike.thing", plist: {} },
      ],
    });
    assert.strictEqual(r.groups.launchAgents.length, 1);
    assert.match(r.groups.launchAgents[0].detail, /2 plist files share this label/);
  });
  it("degrades per-source without throwing", () => {
    const r = computeOps({ ...deps, readCrontabText: () => { throw new Error("no crontab"); } });
    assert.strictEqual(r.groups.crontab.length, 0);
    assert.notStrictEqual(r.sources.crontab, "ok");
    assert.strictEqual(r.summary.total, 2);
  });
  it("serves over HTTP", () => {
    const api = createOpsAPI(deps);
    const res = { statusCode: null, body: "", writeHead(c) { this.statusCode = c; }, end(d) { this.body = d; } };
    api.list({}, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(JSON.parse(res.body).summary.total >= 3);
  });
});
