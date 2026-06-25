---
title: "Mission Control — Implementation Plan"
accessed_by: "agents, mc-phase2, mission-control"
---

# Mission Control — Implementation Plan

Mission Control is Mike's personal command center dashboard for OpenClaw.
This plan tracks the phased rollout of custom panels + integrations.

## Phase Overview

| Phase | Scope | Status | Branch |
|-------|-------|--------|--------|
| 0 | Repo foundation (Node + esbuild + LaunchAgent) | ✅ Shipped | — |
| 1 | Three custom panels (Three Things, Brain Dump, Activity Feed) | ✅ Shipped | `feat/mission-control-phase2-integration` (initial) |
| 2 | Obsidian Tasks integration (kanban + promote + rollover) | ✅ Shipped | `feat/mission-control-phase2-integration` |
| 3 | Agent Observability (live sub-agent tracker) | ✅ Shipped | `feat/mc-agent-observability` |
| 4 | TBD (planning vs autonomous split, calendar view) | 📋 Spec phase | — |

## Phase 3 — Agent Observability

**Goal:** Mike wants to see running sub-agents by descriptive name + status in
the dashboard. No more opaque UUIDs.

### Why

Mike's quote: *"I want to make agents something that I can recognize the name
when they get executed so I can see how they're running in a mission control."*

Today: sub-agents spawn with UUIDs and the only visibility is the gateway's
`~/.openclaw/subagents/runs.json` file — not surfaced anywhere user-facing.

### What ships

- **3 new REST endpoints** under `/api/mission/agents/*`
- **1 new UI panel** ("Running Agents") injected above the existing Mission
  Control section in the dashboard
- **13 unit tests** for status derivation + record mapping

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Dashboard (browser)                                             │
│   └── agents.js (vanilla JS, 8s polling)                         │
│         └── fetch /api/mission/agents[?.../history|/runId]      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Node server (lib/server.js, esbuild bundled)                    │
│   └── src/agents.js (createAgentsAPI factory)                   │
│         ├── getRunningAgents()    → reads runs.json             │
│         ├── getCompletedAgents()  → reads runs.json (filtered)  │
│         ├── getAllHistory()       → runs.json + agent-log.jsonl │
│         ├── findAgent()           → by runId OR label           │
│         ├── mapAgent()            → derive status, format       │
│         └── deriveStatus()        → running/completed/failed/...│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Filesystem (single source of truth)                             │
│   ~/.openclaw/subagents/runs.json            — gateway writes   │
│   ~/.openclaw/workspace/Corvus/Operations/   — agent-log.jsonl  │
│     append-only, written by Corvus on spawn (Phase 3.5)         │
└─────────────────────────────────────────────────────────────────┘
```

### Endpoint specs

#### `GET /api/mission/agents`

Returns currently-running sub-agents (no `endedAt`, or `outcome.status === "running"`).

```json
{
  "agents": [
    {
      "runId": "0bcc9192-6795-4db8-8fc1-3f27e9924e29",
      "name": "MC-DevA-AgentObservability",
      "label": "MC-DevA-AgentObservability",
      "status": "running",
      "model": "light",
      "runtime": "subagent",
      "startedAt": "2026-06-25T19:15:08.125Z",
      "elapsedSeconds": 357,
      "parentSession": "agent:main:telegram:direct:8633920976",
      "task": "Implement agent observability for Mike's Mission Control dashboard...",
      "spawnMode": "run",
      "mode": "autonomous",
      "requesterOrigin": { "channel": "telegram", "to": "telegram:8633920976" }
    }
  ],
  "count": 1,
  "asOf": "2026-06-25T19:21:04.946Z"
}
```

#### `GET /api/mission/agents/history?since=ISO_DATE`

Returns agents completed since the timestamp (defaults to 7 days ago).

- Source 1: `~/.openclaw/subagents/runs.json` (authoritative for live state)
- Source 2: `~/.openclaw/workspace/Corvus/Operations/agent-log.jsonl`
  (filled in by Corvus on spawn, deduped by runId)

```json
{
  "agents": [ ... ],
  "count": 12,
  "windowStart": "2026-06-18T00:00:00Z",
  "windowEnd": "2026-06-25T19:21:04.946Z"
}
```

#### `GET /api/mission/agents/:identifier`

Returns one agent by runId (UUID) or label (exact or case-insensitive).

Returns 404 with `{ error, identifier }` if not found.

### Status derivation

| Condition | Status |
|-----------|--------|
| No `endedAt` and `outcome.status === "running"` (or missing) | `running` |
| `endedReason === "subagent-complete"` OR `outcome.status ∈ {ok, success, completed}` | `completed` |
| `endedReason === "subagent-failed"` OR `outcome.status ∈ {error, failed, timeout, cancelled}` | `failed` |
| (Reserved for future blocked state — currently no source produces it) | `blocked` |

### Files touched

| File | Change |
|------|--------|
| `src/agents.js` | **NEW** — endpoint handlers + status derivation (287 lines) |
| `src/index.js` | +3 lines (require + factory) +18 lines (route handlers) |
| `public/partials/agents.html` | **NEW** — panel markup (28 lines) |
| `public/js/agents.js` | **NEW** — frontend polling + rendering (275 lines) |
| `public/css/dashboard.css` | +180 lines — panel styles |
| `public/index.html` | +2 lines — container div + script tag |
| `tests/agents.test.js` | **NEW** — 13 unit tests (140 lines) |
| `docs/STATUS-AGENTS.md` | **NEW** — live status report |

Total: 5 new files, 3 modified.

### Known limitations / Phase 3.5 backlog

1. **agent-log.jsonl write hook not installed.** When Corvus spawns a sub-agent
   via `sessions_spawn`, it doesn't currently append a record to
   `agent-log.jsonl`. The history endpoint still works (reads from
   `runs.json`), but future: agents spawned before runs.json existed, or that
   were cleaned up, won't appear in history. **Fix:** add a write hook in the
   Corvus spawn wrapper.

2. **History is read-only.** No way to acknowledge/dismiss completed agents
   from the UI yet. Currently just a rolling list.

3. **Click → modal detail.** Clicking an agent row logs to console (debugging).
   Should open a modal with full task + outcome. Currently minimal — Mike
   asked for "minimal" and "react to what's there."

4. **No SSE for running agents.** Currently 8s polling. Could switch to SSE
   for instant updates when agents spawn/complete. Phase 3.5+.

5. **`status: "blocked"` is reserved but never produced.** No code path sets
   it. Listed in API for future use (e.g., agent waiting on user input).

### Next steps (Phase 3.5+)

- [ ] Add `appendAgentLog()` helper that Corvus calls on `sessions_spawn`
- [ ] Modal for agent detail (task body, full outcome, related transcript excerpt)
- [ ] Filter chips on history: completed / failed / by model / by parent
- [ ] "Acknowledge" button to dismiss completed agents from the rolling list
- [ ] SSE channel for `agent.spawn` / `agent.complete` events (replace polling)
- [ ] Wire into `acp-router` so external agent frameworks show up too

## Conventions

- **Module location:** `src/<feature>.js` for backend, `public/js/<feature>.js`
  for frontend, `public/partials/<feature>.html` for injected HTML.
- **Style:** Vanilla JS, no build step for frontend. CommonJS for backend.
- **Wiring:** Factory pattern — `createFeatureAPI({ deps })` returns
  `{ handler1, handler2, ... }`. Routes added in `src/index.js`.
- **Testing:** `node --test tests/<feature>.test.js`. Pure logic in factories,
  mocked I/O for handlers.
- **Polling cadence:** 8s default (matches existing Mission Control panels).
- **No new deps.** All Phase 3 code uses Node built-ins + what's already in
  `package.json`.