# Status: Today View + Planning vs Autonomous Mode Field

**Branch:** `feat/mc-today-view` (from `feat/mc-agent-observability`)
**Date:** 2026-06-25 13:30 PDT
**Author:** Corvus (sub-agent `MC-DevA-TodayView-Plus-Mode`)
**Requester:** Mike Jones (Telegram, 2026-06-25 13:11 PDT)

---

## Summary

Phase 4 ships the **Today view** (Mike's inbox) and the **Planning vs Autonomous
mode field**. Mike's confirmed rule: Today = planning-mode + legacy tasks only.
Autonomous tasks live in the Agents tab (no overlap).

---

## Endpoints added

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/mission/today` | Mike's inbox — planning + mixed + legacy (excludes autonomous) |
| `GET` | `/api/mission/tasks` | All open tasks, supports `?priority=`, `?project=`, `?mode=`, `?status=` |
| `GET` | `/api/mission/outstanding` | Alias for `/api/mission/tasks` |
| `POST` | `/api/mission/tasks/:id/promote-to-project` | Task → Project (defer) feature |
| `GET` | `/api/mission/projects` | Returns the project registry |

### Query params

- `?priority=🔺&priority=⏫` — multi-value (also comma-separated)
- `?project=rt&project=vp` — case-insensitive
- `?mode=planning|autonomous|mixed|legacy` — single or multi

### Today response shape

```json
{
  "tasks": [...],
  "count": 6,
  "planningCount": 1,
  "autonomousCount": 0,
  "mixedCount": 0,
  "legacyCount": 5,
  "asOf": "2026-06-25T20:20:11.480Z",
  "today": "2026-06-25"
}
```

---

## Schema changes

### New fields on `brain-dump.json` tasks

```json
{
  "mode": "planning|autonomous|mixed|null",
  "modeSetAt": "2026-06-25T20:20:43.222Z",
  "modeSetBy": "auto|mike|corvus",
  "lastTouchedAt": "2026-06-25T20:20:43.222Z"  // bumped automatically on update
}
```

### Backfill strategy

- **New tasks:** mode auto-derived from `assignee` + tags.
  - `assignee=corvus|claude` or `#assigned-corvus` → `autonomous`
  - `assignee=mike|anna` or `#planning` or `#assigned-mike` → `planning`
  - No signal → `null` (legacy flag)
- **Existing tasks:** left as `null` (treated as legacy, surfaced in Today for triage).
- **Explicit `mode` in parsed POST body:** wins outright, sets `modeSetBy: "mike"`.

### Project registry

New file: `~/.openclaw/workspace/mission-control/projects-registry.json`

```json
[
  {
    "id": "proj_xxx",
    "title": "...",
    "slug": "kebab-case",
    "parentId": null,
    "createdAt": "...",
    "promotedToProjectAt": "...",
    "sourceTaskId": "bd_xxx",
    "status": "open",
    "links": { "tags": [] }
  }
]
```

When a task is promoted:
- A new entry is appended to the registry.
- The source task is updated with `type: "project"` and `promotedToProjectId`.

---

## Files changed

### Backend
- `src/mission-control.js` — `mode` field on creation/update, new handlers, helpers.
- `src/mc-phase2.js` — `modeBreakdown` in kanban response (no schema break).
- `src/index.js` — routes for `/api/mission/today`, `/api/mission/tasks`, etc.

### Frontend
- `public/partials/today.html` — Today view partial.
- `public/partials/outstanding.html` — Outstanding view partial.
- `public/js/today.js` — Today view logic (8s polling).
- `public/js/outstanding.js` — Outstanding view logic (8s polling).
- `public/js/mission-control.js` — mode badge in kanban cards.
- `public/css/dashboard.css` — mode badge styles, row/list styles for Today/Outstanding.
- `public/index.html` — `<script>` tags + container divs.

### Tests
- `tests/mc-phase4-today.test.js` — **new**, 19 test groups covering mode derivation,
  today/outstanding filter logic, shape, sort, HTTP handlers, promote-to-project.

---

## Live verification

```bash
# Today (planning + mixed + legacy; NOT autonomous)
$ curl -s http://localhost:3333/api/mission/today | jq '.count, .planningCount, .autonomousCount, .legacyCount'
6
1
0
5

# Outstanding (all open tasks including autonomous)
$ curl -s http://localhost:3333/api/mission/outstanding | jq '.count'
7

# Priority filter
$ curl -s "http://localhost:3333/api/mission/today?priority=%F0%9F%94%BA" | jq '.count'
0

# Mode filter
$ curl -s "http://localhost:3333/api/mission/tasks?mode=autonomous" | jq '.count'
1

# Promote-to-project
$ curl -s -X POST http://localhost:3333/api/mission/tasks/bd_xxx/promote-to-project | jq '.project.id'
"proj_xxx"
```

---

## Test results

- **Before:** 211/213 passing (2 pre-existing config.test.js env failures).
- **After:** 271/273 passing (same 2 pre-existing failures; +60 new passing tests).
- **Lint:** 0 errors, 15 warnings (no new warnings introduced).

```
ℹ tests 273
✖ failing tests:
  ✖ has default auth mode of 'none'
  ✖ has default host of localhost
```

Both pre-existing failures depend on `process.env` defaults and are unaffected.

---

## Mode badge UI

Every task card now shows a mode badge:

- 🤝 **Planning** (green border) — Mike drives
- 🤖 **Autonomous** (blue border) — Corvus owns
- 🔀 **Mixed** (purple) — co-iterating
- ⚠️ **Legacy** (amber) — needs triage (mode was null)

The kanban card, Today row, and Outstanding row all show this badge with a hover tooltip.

---

## Limitations / what's NOT in this slice

1. **No drill-down panel** — clicking a task row doesn't open a detail modal. The
   `data-task-id` is exposed on every row so this is a single-file addition later.
2. **No "Talk to Corvus" affordance** (req #8) — header FAB / Telegram fallback is
   for Phase 5.
3. **Projects panel UI not wired** — the API exists (`/api/mission/projects`),
   but the dashboard doesn't render the registry yet.
4. **Per-project stalled threshold config** (Section 7 Q3 in research) — defaulted
   to global; per-project overrides still land in `velocity-config.json` but
   no UI hook yet.
5. **`mode` mutation API** — PATCH `/api/mission/braindump/:id` with `mode: ...`
   works (the existing endpoint accepts any field), but there's no UI button to
   flip a task's mode yet.
6. **Project parent linking** — `parentId` is stored but not visualized.

---

## Next steps (Phase 5 candidates)

1. Wire a left-nav tab to switch between Today / Outstanding / Projects views.
2. Add a detail panel for clicked tasks (use `obsidianRef` if present → open in Obsidian).
3. Add a header mode toggle (Both | 🤝 Planning | 🤖 Autonomous) — currently it's
   only on the Outstanding view's mode filter.
4. Implement `mixed` auto-promotion: if a planning task hasn't been touched in 24h
   and Corvus is the assignee, flip to `autonomous` (Section 7 Q2 in research).
5. Auto-archive at ≥3 postponements → automatic `promote-to-project` (Section 7 Q1).

---

## Rollback

```bash
git checkout feat/mc-agent-observability
# OR
git branch -D feat/mc-today-view
```

The schema additions are additive — `mode: null` on old tasks is harmless and the
UI treats them as "legacy, needs triage". Existing endpoints (`/api/mission/braindump`,
`/api/mc/kanban/:column`, etc.) all still work and return the new `mode` field if present.