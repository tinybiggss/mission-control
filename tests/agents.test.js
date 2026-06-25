/**
 * Agent Observability (Phase 3) — tests
 *
 * Tests status derivation + record mapping. Doesn't touch real subagents/runs.json
 * (that file is the live gateway's authoritative state).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { deriveStatus, mapAgent } = require("../src/agents");

// ---------------------------------------------------------------------------
// deriveStatus
// ---------------------------------------------------------------------------

describe("agents: deriveStatus()", () => {
  it("returns 'running' when no endedAt and no outcome.status", () => {
    assert.strictEqual(
      deriveStatus({
        startedAt: Date.now() - 1000,
        endedAt: null,
        outcome: { status: "running" },
      }),
      "running",
    );
  });

  it("returns 'running' when no endedAt and outcome missing", () => {
    assert.strictEqual(deriveStatus({ startedAt: Date.now() - 1000 }), "running");
  });

  it("returns 'completed' when endedReason is 'subagent-complete'", () => {
    assert.strictEqual(
      deriveStatus({
        endedAt: Date.now(),
        endedReason: "subagent-complete",
        outcome: { status: "ok" },
      }),
      "completed",
    );
  });

  it("returns 'failed' when endedReason is 'subagent-failed'", () => {
    assert.strictEqual(
      deriveStatus({
        endedAt: Date.now(),
        endedReason: "subagent-failed",
        outcome: { status: "error" },
      }),
      "failed",
    );
  });

  it("returns 'failed' when outcome.status is 'timeout'", () => {
    assert.strictEqual(
      deriveStatus({
        endedAt: Date.now(),
        outcome: { status: "timeout" },
        endedReason: "timeout",
      }),
      "failed",
    );
  });

  it("returns 'failed' when outcome.status is 'error'", () => {
    assert.strictEqual(
      deriveStatus({
        endedAt: Date.now(),
        outcome: { status: "error" },
      }),
      "failed",
    );
  });

  it("returns 'completed' when outcome.status is 'ok' (even without endedReason)", () => {
    assert.strictEqual(
      deriveStatus({
        endedAt: Date.now(),
        outcome: { status: "ok" },
      }),
      "completed",
    );
  });

  it("returns 'completed' when endedAt present but outcome is ambiguous", () => {
    assert.strictEqual(
      deriveStatus({
        endedAt: Date.now(),
        outcome: {},
      }),
      "completed",
    );
  });
});

// ---------------------------------------------------------------------------
// mapAgent
// ---------------------------------------------------------------------------

describe("agents: mapAgent()", () => {
  it("preserves label and uses it as name when present", () => {
    const now = Date.now();
    const mapped = mapAgent({
      runId: "abc-123",
      label: "Solar-Layout-Finalize-2026-06-25",
      startedAt: now - 5000,
      endedAt: now,
      endedReason: "subagent-complete",
      outcome: { status: "ok", startedAt: now - 5000, endedAt: now, elapsedMs: 5000 },
      model: "ollama/sonnet:cloud",
      spawnMode: "run",
      task: "Finalize the home solar array layout.",
      requesterSessionKey: "agent:main:telegram:direct:8633920976",
      requesterOrigin: { channel: "telegram", to: "8633920976" },
    });

    assert.strictEqual(mapped.name, "Solar-Layout-Finalize-2026-06-25");
    assert.strictEqual(mapped.label, "Solar-Layout-Finalize-2026-06-25");
    assert.strictEqual(mapped.status, "completed");
    assert.strictEqual(mapped.runtime, "subagent");
    assert.strictEqual(mapped.elapsedSeconds, 5);
    assert.strictEqual(mapped.parentSession, "agent:main:telegram:direct:8633920976");
    assert.strictEqual(mapped.mode, "autonomous");
    assert.strictEqual(mapped.requesterOrigin.channel, "telegram");
  });

  it("falls back to runId when label is missing", () => {
    const mapped = mapAgent({
      runId: "fallback-id",
      startedAt: Date.now(),
    });
    assert.strictEqual(mapped.name, "fallback-id");
    assert.strictEqual(mapped.label, null);
  });

  it("computes live elapsed seconds for running agents", () => {
    const mapped = mapAgent({
      runId: "live-1",
      label: "live-1",
      startedAt: Date.now() - 10_000,
    });
    assert.strictEqual(mapped.status, "running");
    assert.ok(mapped.elapsedSeconds >= 9 && mapped.elapsedSeconds <= 11);
  });

  it("freezes elapsed seconds for completed agents", () => {
    const start = Date.now() - 60_000;
    const end = start + 30_000;
    const mapped = mapAgent({
      runId: "done-1",
      label: "done-1",
      startedAt: start,
      endedAt: end,
      endedReason: "subagent-complete",
      outcome: { status: "ok", startedAt: start, endedAt: end, elapsedMs: 30_000 },
    });
    assert.strictEqual(mapped.elapsedSeconds, 30);
  });

  it("handles spawnMode=session by marking mode as interactive", () => {
    const mapped = mapAgent({
      runId: "inter-1",
      label: "inter-1",
      startedAt: Date.now(),
      spawnMode: "session",
    });
    assert.strictEqual(mapped.mode, "interactive");
  });
});