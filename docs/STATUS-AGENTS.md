---
title: "Agent Observability — Status Report"
accessed_by: "agents"
---

# Agent Observability — Status Report

**Shipped:** 2026-06-25 (Mike's PDT session, ~12:14 PDT)
**Branch:** `feat/mc-agent-observability`
**Repo:** `~/Dev/mission-control-command-center/openclaw-command-center/`

## TL;DR

Mike can now see running sub-agents by name + status in his Mission Control
dashboard. Three endpoints + one UI panel, no new dependencies, 13 new unit
tests, zero regressions.

## What's live

### Endpoints (live on port 3333)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/mission/agents` | Currently-running sub-agents |
| `GET /api/mission/agents/history?since=ISO` | Completed in window (default 7d) |
| `GET /api/mission/agents/:runId` | Single agent by runId or label |

All three are wired in `src/index.js` next to the existing
`/api/mission/*` Phase 1 routes.

### UI panel (live)

"Running Agents" panel injected at the top of the Mission Control section
in `index.html`. Auto-refreshes every 8 seconds. Shows:

- **Header:** running count (badge) + last-updated timestamp
- **Live list:** each agent row has a pulsing status dot (status-colored),
  descriptive name (truncated with tooltip), model pill, requester channel,
  and live elapsed time
- **History toggle:** "Show recent history" button expands a 7-day rolling
  history of completed/failed agents (sorted by most recent first)

Styling lives in `public/css/dashboard.css` (Phase 3 section appended at
the bottom — matches existing `.mc-*` conventions).

### Tests

```
tests/agents.test.js
  ✔ agents: deriveStatus()  — 8 cases
  ✔ agents: mapAgent()      — 5 cases
ℹ tests 13   pass 13   fail 0
```

Status derivation covers all edge cases (running, completed, failed, timeout,
ambiguous). Mapping covers label fallbacks, live elapsed vs frozen elapsed,
and `spawnMode` → `mode` translation.

### Build + lint

```
npm run lint   → 0 errors (15 pre-existing warnings, none new)
npm run build  → esbuild bundle successful (lib/server.js, 216.4kb)
npm test       → 200 tests, 198 pass, 2 pre-existing failures in config.test.js
                  (same failures on main, unrelated to Phase 3)
```

## Source-of-truth map

| Data | Source | Authoritative for |
|------|--------|-------------------|
| Currently-running sub-agents | `~/.openclaw/subagents/runs.json` | Live state (gateway writes) |
| Recently-completed sub-agents | `~/.openclaw/subagents/runs.json` | Past 7 days |
| Agent history (long tail) | `~/.openclaw/workspace/Corvus/Operations/agent-log.jsonl` | Append-only log (Phase 3.5+) |

Currently only `runs.json` is being read (gateway keeps ~all history). The
`agent-log.jsonl` fallback exists for agents that ran before `runs.json` was
introduced or were cleaned up — **but the write hook hasn't been installed
yet** (Phase 3.5 backlog).

## Live verification (2026-06-25 ~12:21 PDT)

```bash
$ curl -s http://localhost:3333/api/mission/agents | jq '.count, .agents[0].name'
1
"MC-DevA-AgentObservability"

$ curl -s http://localhost:3333/api/mission/agents/history | jq '.count, .agents[0].name, .agents[0].status'
1
"MC-Research-BestPractices-UX"
"completed"
```

The first curl shows the very agent that built this feature (this subagent)
running in the dashboard — meta-confirmed end-to-end working.

## What didn't work as planned

1. **No live gateway SSE.** Investigated `http://localhost:18789/v1/sessions`
   but the gateway's HTTP surface doesn't expose per-agent state — it just
   manages sessions, not sub-agent runs. Fell back to reading `runs.json`
   directly from disk (gateway writes it synchronously when agents spawn).

2. **`status: "blocked"` is reserved but never produced.** No code path sets
   it. Listed in API for future use (e.g., agent waiting on user input). If
   any caller asks for it, we'll get a 404 for now and add the source.

3. **agent-log.jsonl is empty.** No writer exists yet. Future Phase 3.5 will
   add a hook in the Corvus spawn wrapper.

4. **No modal detail page.** Click on an agent row currently just
   `console.log`s the detail. Mike asked for "minimal" + "react to what's
   there" — modal can come in next iteration.

5. **8s polling.** Not SSE. Acceptable for "show me what's running right
   now" but introduces up to 8s lag on agent completion. SSE wire-up is
   Phase 3.5.

## Limitations

- **Agent label quality depends on spawn-time naming.** If Corvus spawns a
  sub-agent with `label: undefined`, the panel falls back to the UUID
  runId. The spec for descriptive names (`Solar-Layout-Finalize-2026-06-25`)
  is Mike's responsibility at spawn time — this endpoint just surfaces
  what's there.
- **No filtering yet.** History shows everything in 7 days. Filter chips
  (completed / failed / by model) are Phase 3.5.
- **No "acknowledge/dismiss" on history items.** Rolling list only.

## Next steps (Phase 3.5 — pending Mike's reaction)

Priority order based on what's most likely to surface something useful:

1. **`appendAgentLog()` write hook** — install in the Corvus spawn wrapper
   so future agents get recorded even if `runs.json` gets rotated.
2. **Detail modal** — clicking a row opens a modal with full task, outcome,
   transcript excerpt, parent session link.
3. **Filter chips** — completed / failed / by model / by parent channel.
4. **SSE wire-up** — replace 8s polling with event-driven updates.
5. **Cross-system observability** — wire `acp-router` so non-OpenClaw agent
   frameworks also surface here.

## Files changed

```
src/agents.js                 NEW    (287 lines)
src/index.js                  MOD    (+3 require + 18 route handlers)
public/partials/agents.html    NEW    (28 lines)
public/js/agents.js           NEW    (275 lines)
public/css/dashboard.css      MOD    (+180 lines, appended)
public/index.html             MOD    (+2 lines)
tests/agents.test.js          NEW    (140 lines)
PLAN.md                       NEW    (implementation plan)
docs/STATUS-AGENTS.md         NEW    (this file)
```

Total: **5 new files, 4 modified, 0 dependencies added.**