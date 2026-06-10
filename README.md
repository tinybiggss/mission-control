# Corvus Dashboard

Local web dashboard for reviewing and approving Resilient Tomorrow content produced by the Corvus Content Engine (OpenClaw skills).

## What It Does (Phase 2a)

- Reads content drafts and platform-adapted versions directly from the Obsidian vault
- Groups adapted versions under their parent drafts
- Shows all platform versions for a single draft in one card
- Lets you Approve / Reject / Edit each platform version inline
- Bulk approve all platform versions of a draft with one click
- Filter by status (Pending / Approved / Rejected / All) and platform
- Auto-refreshes via SvelteKit invalidation after each action

## Chat Session Logging

The Express server (`server.js`) hosts the AI chat panel at `/api/chat`. Every chat round-trip (Mike → Corvus) is captured to disk for future agent training and editorial-history review.

**What gets logged:**
- Timestamp (ISO 8601)
- Session ID (UUID, shared between Mike's message and Corvus's response)
- Article ID (from frontmatter `article_id` / `title` / `id`, else derived from the draft filename, else `"untitled"`)
- Article path (the draft the user is currently editing)
- Sender (`"Mike Jones"` or `"Corvus"`)
- Message type (heuristic: `directive` / `feedback` / `question` / `approval` / `response` / `error`)
- Content
- Draft size and comment count (context, helps summarizers)

**Storage:** `~/.openclaw/workspace/session-logs/YYYY-MM-DD/dashboard-{article}-{session-hash}.jsonl` — one JSONL file per session, append-only. Each round-trip (Mike + Corvus) is in one file. Writes are fire-and-forget and serialized per-file so events stay in order; log IO never blocks the chat response and never crashes the dashboard.

**Retrieval API:**
- `GET /api/sessions/latest` — most recent session (metadata only)
- `GET /api/sessions/:article_id` — all sessions for an article, grouped with their messages

See `~/.openclaw/workspace/projects/session-capture/Session-Capture-Design-Spec.md` for the full design.

## What's Deferred

- **Phase 2b:** Calendar + Kanban views, scheduling
- **Phase 2c:** Analytics dashboard with charts
- **Phase 2d:** Discord thread integration for discussions, preference learning capture
- **Phase 3:** Publishing to social platforms
- **Phase 4:** Performance tracking (Substack scraping, platform metrics)
- **Phase 5:** Optimizer feedback loop

## Requirements

- Node.js 20+ (via Homebrew: `brew install node`)
- pnpm (`npm install -g pnpm`)
- Obsidian vault at `/Users/michaeljones/Dev/Obsidian/Mike_Thinking_Space`

## Development

```bash
pnpm install
pnpm dev
```

Dev server runs at `http://localhost:5173` with hot reload.

## Testing

```bash
pnpm test:unit   # Vitest unit tests (28 tests)
pnpm test:e2e    # Playwright E2E tests (3 tests, uses fixture vault)
pnpm test        # Both
```

## Production (Always-On via LaunchAgent)

The dashboard is already running at `http://localhost:4321` via a macOS LaunchAgent.

**To rebuild after code changes:**
```bash
pnpm build
launchctl kickstart -k gui/$(id -u)/local.mike.corvus-dashboard
```

`kickstart -k` stops the running process and starts a fresh one against the new `build/` bundle in a single step. Required after any code change — otherwise the running Node process keeps references to the previous bundle's chunks and new routes return 500. Use `unload`/`load` (below) only if the plist itself changed.

**To stop:**
```bash
launchctl unload ~/Library/LaunchAgents/local.mike.corvus-dashboard.plist
```

**To start:**
```bash
launchctl load ~/Library/LaunchAgents/local.mike.corvus-dashboard.plist
```

**Logs:**
- Stdout: `~/Library/Logs/corvus-dashboard.log`
- Stderr: `~/Library/Logs/corvus-dashboard.error.log`

**Status check:**
```bash
launchctl list | grep corvus-dashboard
# Format: <PID> <exit-code> <label>
# PID non-zero and exit-code 0 = healthy
```

## How It Talks to Corvus

```
Corvus skills (OpenClaw cron jobs)
         │
         │ writes markdown files
         ▼
Obsidian vault
  ├── Resilient Tomorrow/Content Drafts/YYYY-MM-DD/draft-*.md
  └── Resilient Tomorrow/Content Adapted/YYYY-MM-DD/draft-*/[platform].md
         │
         │ reads on every page load
         ▼
Corvus Dashboard (this app)
         │
         │ Mike approves/rejects/edits
         ▼
Updates frontmatter status in the same vault files
         │
         │ Corvus skills read updated status on next run
         ▼
Pipeline continues
```

Corvus writes. Dashboard reads and updates. No database, no sync layer. The vault markdown files ARE the state.

## Architecture Decisions

- **SvelteKit + Svelte 5 runes** — lightweight, fast component model, minimal runtime. Great for this scale of UI.
- **Obsidian vault as source of truth** — no database, no sync issues. Corvus skills and dashboard read/write the same files.
- **Direct file system access** — `gray-matter` for frontmatter parsing, `node:fs/promises` for I/O. No API intermediary between skills and dashboard.
- **Defensive frontmatter parsing** — skips files with malformed YAML and logs warnings, so one bad draft doesn't crash the queue.
- **LaunchAgent for always-on** — Mac Mini native, survives reboots, standard log location, `KeepAlive` restarts on crash.
- **$env/dynamic/private** — lets `pnpm dev` read `.env` automatically while still working when env is set externally (LaunchAgent, Playwright).

## Tech Stack

- SvelteKit (Svelte 5, Vite)
- TypeScript
- Tailwind CSS 3 with custom RT color palette
- gray-matter (YAML frontmatter parser)
- Vitest (unit tests)
- Playwright (E2E tests)
- @sveltejs/adapter-node (production build)

## Ports

- Dev server: `5173` (`pnpm dev`)
- Production (LaunchAgent): `4321`
- E2E test server: `4322` (auto-managed by Playwright)

## Related Docs

- Design spec: `docs/superpowers/specs/2026-04-15-corvus-content-engine-design.md` (in Obsidian vault)
- Phase 1 plan: `docs/superpowers/plans/2026-04-15-corvus-content-engine-phase1.md` (in vault)
- Phase 2a plan: `docs/superpowers/plans/2026-04-16-corvus-dashboard-phase2a.md` (in vault)

## File Structure

```
corvus-dashboard/
├── src/
│   ├── lib/
│   │   ├── server/        # Vault I/O, frontmatter (server-only)
│   │   ├── grouping.ts    # Pure functions, shared with client
│   │   ├── types.ts       # TypeScript interfaces
│   │   └── components/    # Svelte UI components
│   ├── routes/
│   │   ├── +layout.svelte # App shell (header, etc.)
│   │   ├── +page.server.ts # Server loader for approval queue
│   │   ├── +page.svelte   # Main approval queue UI
│   │   └── api/           # REST endpoints
│   ├── app.css
│   └── app.html
├── tests/
│   ├── unit/              # Vitest
│   ├── e2e/               # Playwright
│   └── fixtures/vault/    # Sample vault structure for tests
├── launchagent/           # Source-of-truth plist for LaunchAgent
├── build/                 # Production bundle (git-ignored)
├── .env                   # VAULT_ROOT + PORT (git-ignored)
├── .env.example           # Template
├── svelte.config.js
├── vite.config.ts
├── playwright.config.ts
├── tailwind.config.ts
└── README.md              # You are here
```
