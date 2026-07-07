# Mission Control — Handoff to Fable 5

**From:** Claude (Opus 4.8) · **Date:** 2026-07-06 · **For:** Fable 5, invited to run through this whole project and find something brilliant.

> Mike's ask: *"Run through this entire project and see if you can come up with something brilliant."*
> This document exists so you don't burn your first 50K tokens rediscovering what's already known. Everything below is verified against the running code as of this date. Read it, run it, then go past it.

---

## 0. The 60-second orientation

**Mission Control** is Mike's personal command-center dashboard, running locally on **`:3333`**. It started life as a fork (`tinybiggss/mission-control`) of the open-source `openclaw-command-center` and was extended over Telegram (by the Corvus agent) into a personal GTD layer. On 2026-07-06 it was rebuilt from a *broken OpenClaw infrastructure monitor* into **Mike's daily operating picture** — one pane that unifies what needs him, what his agents did overnight, what's worth writing about, and how his projects and automations are doing.

**Run it right now:**
```bash
cd /Users/michaeljones/Dev/mission-control-command-center/openclaw-command-center
npm run build                 # esbuild src/ -> lib/server.js  (~15ms). REQUIRED after any src/ change.
launchctl kickstart -k gui/$(id -u)/com.mike.mission-control   # it runs as a LaunchAgent
open http://localhost:3333
npm test                      # 271/273 (2 pre-existing env-default failures — see §7)
```

**The single most important fact:** `lib/server.js` is a **generated esbuild bundle**. Editing `src/` does nothing until you `npm run build`. This is the #1 "why isn't my change showing" trap.

---

## 1. Who Mike is & how he actually works (design context)

Mike Jones — solo AI Implementation Expert (Jones Collaboration Company / Velocity Partners). A full agentic-workflow audit was done 2026-07-02; read it, it's the richest context you have: **`~/Dev/workflow-audit/report.md`**. Key truths that should shape any design:

- **Four work buckets:** (1) **Content** — "Resilient Tomorrow" (RT) newsletter/brand, his largest area; (2) **Coding/builds** — MJ_Online, distill-app, Connectioning, this dashboard; (3) **Client work** — GHN Academy course (under Velocity Partners); (4) **Research / technical Q&A**.
- **He works in evening bursts, "art-director" mode.** He steers on product/design; agents execute. Human turns are ~0–1 corrections per session — he engineered *for* autonomy ("I don't want to keep coming back and saying yes").
- **Two agents, one bus.** *Corvus* (OpenClaw, Ollama models, driven over Telegram) does first-pass content + automation. *Claude Code* (this) does high-touch editing/builds. The **memory ledger is the handoff bus** between them.
- **His pain points the audit found:** memory that records everything and recalls little (read paths broke silently for 10+ days); ~91% Opus-on-everything; sessions left open for days (a 50K-token startup tax + 843M cache-read tokens); automations that fail *silently* while logging "ok."
- **Ethos he's stated:** *minimal, "react to what's there," recognizable agent names, don't make me babysit.*

The whole point of this dashboard is to make the invisible visible and to be the surface he opens first each day.

---

## 2. Architecture (how it's built)

- **Backend:** Node ≥18, pure `http` module, **CommonJS, zero runtime deps**. Source in `src/` → **esbuild-bundled** to `lib/server.js`. Served by LaunchAgent `com.mike.mission-control`.
- **Frontend:** **vanilla JS, no framework, no build step.** Each panel self-injects its HTML partial then polls its API (8–60s). `morphdom` is the only vendored lib.
- **The house module pattern (copy it for anything new):** a backend module is `src/<name>.js` exporting a `createXAPI(deps)` factory + a module-level cache `{data, timestamp, refreshing}` + `refreshXAsync()` (guards on `refreshing`) + `getXCached()` (refresh-if-stale, return last-good). Canonical references: **`src/health.js`** and **`src/system-mind.js`** (both written this session), and **`src/agents.js`** (`safeReadJson`, JSONL reader). Register in `src/index.js`: `require` → factory call → a route branch in the big first-match `if/else` (put new `/api/*` branches **before** the `isJobsRoute`/`serveStatic` catch-all).
- **Frontend panel:** `public/partials/<name>.html` + `public/js/<name>.js` (IIFE exposing `window.MC_<Name>Init`) + a container `<div>` + `<script>` + init call in `public/index.html`; CSS lives in the single `public/css/dashboard.css`. Copy `public/js/system-mind.js` as your skeleton.
- **Auth:** tailscale mode, localhost-allowlisted (`config/dashboard.json`).

---

## 3. What's shipped (the 7 panels)

Everything below is live and verified. "Honest state" flags where the data is thinner than the UI implies — those gaps are opportunities.

| Panel | Endpoint | Source | Honest state |
|---|---|---|---|
| **Health / Ops** | `/api/mission/health` | filesystem self-checks | Green: mount, memory-injection, CLI polls. Red/amber (real): Corvus scheduler/publisher, gateway fallback ladder, ledger stubs. It's a *monitor*, not yet a *healer*. |
| **Today** (enriched) | `/api/mission/today` | brain-dump + Obsidian daily note + ledger | Shows a ledger "last session" brief, Obsidian daily-note tasks, and stalled flags. Actions: done, promote-to-project. |
| **The System Mind** | `/api/mission/system-mind` | `memory.jsonl` | Recent session summaries + last night's dreaming consolidation (connections/patterns/hypotheses/tensions/recurring-threads). This is the highest-signal, least-exploited data in the system. |
| **Signals** | `/api/mission/signals` | `rt-signal-scorer-queue.json` | Ranked + dismissible. **Reads the *queue*, not scored output** — the scorer's scored-output path was never found (`SCORED_SIGNALS_PATH` is a guess with fallback). Data is stale (Jun 10). |
| **Projects** | `/api/mission/dev-projects` | `PROJECT-MEMORY.json` ×6 + `TASKS.md` + Claude Code mtimes | Warmest-first, live status + open tasks + last-activity. Some projects show "no CC activity" (work happened in worktrees). |
| **Content pipeline** | `/api/mission/content` | proxy → corvus-dashboard `:4321` | 129 drafts, but **all land in the "draft" column** — corvus's `/api/drafts` only exposes drafts at PASS phases, so adapted/scheduled/published are empty. Pipeline is aspirational until corvus exposes stage. |
| **Automation schedule** | `/api/mission/agents/schedule` | `~/.openclaw/cron/jobs.json` | 34 cron jobs, failing/upcoming first, with failure badges (e.g. heartbeat-afternoon "18× fail"). Note: a few RT jobs render "NaNth of month" — a bug in the shared `src/cron.js` `cronToHuman` parser. |

Plus the pre-existing custom layer you inherit: **Three Things**, **Brain Dump** (Eisenhower kanban), **Activity Feed**, **Agent Observability** (Phase 3), **Obsidian Tasks** sync (Phase 2), **planning/autonomous mode** on tasks (Phase 4).

---

## 4. Live data sources (what's real to wire into)

All local. Confirmed present and queryable:

| Source | Path / access | Notes |
|---|---|---|
| **Memory ledger** | `/Volumes/MacMini_Extended/llm-memory/memory.jsonl` | JSONL, ~107 entries. Types: `session_summary`, `consolidation`, `decision`, `milestone`. **Drop `status:"stub"` rows.** Window on `date`. External volume — mount-guard everything. |
| **Nightly dreaming** | same file, `type:consolidation` | The `connections/patterns/hypotheses/tensions/recurring_threads` fields. Richest content in the system. |
| **Claude Code sessions** | `~/.claude/projects/<encoded>/*.jsonl` | Encoding: `/` and `_` → `-` (e.g. `MJ_Online` → `-Users-michaeljones-Dev-MJ-Online`). mtime = activity. |
| **PROJECT-MEMORY / TASKS** | `~/Dev/*/PROJECT-MEMORY.json` (6) + sibling `TASKS.md` | Schemas differ (`status` vs `current_phase`; `changelog` vs `update_history`) — read defensively. TASKS.md uses **markdown status tables** (⏳/✅), not `- [ ]`. |
| **OpenClaw state** | `~/.openclaw/` — `cron/jobs.json`, `subagents/runs.json`, `main.sqlite` (83MB RAG), `workspace/memory/` | The automation substrate. |
| **Corvus dashboard** | HTTP `localhost:4321/api/*` | Content pipeline. See §5 — it's mid-migration. |
| **Dead ends** | NATS (archived), Ghost API (not on disk) | Ignore. |

---

## 5. Known issues & the one deferred item

**Deferred (Mike's explicit call — do NOT touch without him):** the **Corvus scheduler/publisher** launchd jobs POST to `/api/schedule/run` and `/api/publish/run`, which 404. Root cause: **corvus-dashboard is mid-migration from Express to SvelteKit.** The running process on `:4321` is the *old Express* `server.js` (14 routes); the scheduler/publisher + all recent features live in the *newer SvelteKit* app (`src/routes/api/schedule/run/+server.ts`, `src/lib/server/scheduler.ts`/`publisher.ts`) which is built (`adapter-node`) but not being served. The fix is to finish the cutover (point the LaunchAgent at `node build/index.js`), **verify `/api/drafts` parity first** (this dashboard's Content panel depends on it), and **dry-run publish before letting it post** (outward-facing). This is its own session. Full context: memory note `mission-control-rebuild-2026-07.md`.

**Other known gaps (fair game):**
- Signals reads the queue, not scored output (scorer output path unknown).
- Content pipeline has only the "draft" stage populated.
- `cronToHuman` (`src/cron.js`) mis-parses some RT cron expressions ("NaNth of month").
- Stock OpenClaw cruft still present but quarantined: `/api/jobs` 500s at startup (missing module), Cerebro/Operators panels are empty, zh-CN i18n, LLM fuel gauges (dead — `openclaw` CLI auth expired; polls are gated off behind `integrations.openclawCli.enabled`).
- The memory ledger has 26+ permanent `stub` entries (Stop hook records *that* a session happened, not *what*).

---

## 6. Where "brilliant" might live (springboards, not instructions)

Mike didn't ask for a bug list — he asked for something brilliant. These are provocations. Ignore them and find your own if you see further.

1. **The dashboard observes; it doesn't yet *anticipate*.** Every panel is a feed. What would it mean for Mission Control to surface *the one thing that matters right now* — synthesized across panels — instead of seven parallel lists? (The audit's finding: back when memory injection worked, the assistant reached for the right skill *before Mike named it*. That's the bar.)
2. **The panels don't talk to each other.** A Signal about "mutual aid" and a Project open-thread about the RT community series and a consolidation *tension* are shown in three different boxes. The connective tissue — "this signal answers this open thread" — is exactly what the nightly *dreaming* already computes but never routes anywhere actionable. What if the dashboard closed those loops?
3. **"Art-director mode" wants a cockpit, not a readout.** Mike steers, agents execute. Today the dashboard is read-only-ish. What's the minimal, safe set of *dispatch* affordances — "have Corvus draft this signal," "promote this consolidation hypothesis into a project" — that turn watching into directing without becoming a babysitting surface? (Note the guardrail in §8.)
4. **The System Mind is underused.** Consolidations produce *hypotheses* and *tensions* every night. Nobody tracks whether they ever get resolved. A dashboard that showed a hypothesis's lifespan — raised, tested, confirmed/killed — would turn nightly noise into a genuine thinking instrument.
5. **Health could self-heal, not just self-report.** It already detects the silent failures. The gap between "shows red" and "fixed it (or filed it, or pinged Telegram)" is where reliability actually lives.
6. **The 50K startup-tax problem is unsolved.** Mike pays mostly for context logistics, not thinking. Could Mission Control *be* the priming surface — the thing that hands a new session its warm context in one shot, so cold starts stop costing?
7. **Signal → content → publish is a funnel nobody can see end-to-end.** Trend-watcher → scorer → draft → adapt → schedule → publish spans three systems (OpenClaw crons, the vault, corvus-dashboard). Making that one visible, honest funnel — with the leaks marked — would be its own kind of brilliant.

---

## 7. Verification & how not to break things

- **Build discipline:** `npm run build` after every `src/` change, then `launchctl kickstart -k gui/$(id -u)/com.mike.mission-control`. Verify endpoints with `curl -s localhost:3333/api/mission/<x> | jq`, then eyeball at `:3333`.
- **Tests:** `npm test` — expect **271/273**. The two failures (`config.test.js`: default host/auth) are pre-existing and env-dependent; don't chase them.
- **The server is live and Mike uses it.** It's a LaunchAgent (KeepAlive) — a crash self-restarts, but don't leave it broken. `server.err` should stay near-empty; if it balloons, something's re-spawning the `openclaw` CLI (the gate in `src/openclaw.js` / `config.js` prevents this).

---

## 8. Ground rules (non-negotiable)

- **Nothing outward-facing without Mike.** Publishing content, sending Telegram/email, posting to platforms, pushing git — all require his explicit go-ahead. The Corvus publisher is the sharp edge here.
- **Don't push to main.** Work on `feat/mc-today-view` (current) or a new branch. Commit when asked.
- **Preserve the running dashboard.** Additive changes over rewrites; quarantine broken stock panels rather than ripping the shell out from under features that work.
- **Match the house style.** Vanilla JS, the `createXAPI` factory + cache pattern, one CSS file, mount-guard every external-volume read. Read like the code around you.
- **Be honest in the UI.** This whole project exists because things failed *silently*. A panel that shows stale/partial data should say so (see how Signals flags "from queue (unscored)" and Health flags the 168-byte placeholder).

---

## 9. File map & references

- **This session's work:** commit `bf9c270` on `feat/mc-today-view`. New modules: `src/{health,system-mind,projects,signals,corvus-proxy}.js` + 6 panel `partial/js` sets + `src/agents.js` `scheduleBoard()`. Plumbing (outside this repo): `~/.openclaw/scripts/cross-system-context-refresh.sh` (mount-aware), `~/.openclaw/scripts/rotate-openclaw-logs.sh` (+ hourly crontab).
- **The plan that produced it:** `~/.claude/plans/based-on-all-the-linear-pillow.md`.
- **The audit (read this):** `~/Dev/workflow-audit/report.md` + evidence in `~/Dev/workflow-audit/data/`.
- **Project memory:** `~/.claude/projects/-Users-michaeljones-Dev-mission-control-command-center/memory/` — `MEMORY.md` (index), `workflow-audit-2026-07.md`, `mission-control-rebuild-2026-07.md`.
- **Phase history:** `PLAN.md`, `STATUS-TODAY.md` (Corvus's Phases 0–4).
- **Router + wiring:** `src/index.js`. **Config/gates:** `src/config.js`. **CLI circuit-breaker:** `src/openclaw.js`.

---

*One last thing: Mike treats his agents as teammates — named, with memory and continuity. He values "I'm not sure" over a confident wrong answer, and he thinks mistakes are how we learn. Be direct, be opinionated, and if you find something better than everything above, do that instead. — Claude*
