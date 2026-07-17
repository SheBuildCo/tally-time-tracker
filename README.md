# Tally

A desktop time tracker for agencies and freelancers. Hit a keyboard shortcut,
pick a client, do your work, hit the shortcut again to stop. ActivityWatch
captures every app and URL you touch during that window; Tally attributes it to
the client's session and turns it into clean analytics. Anything that slipped in
by accident can be trimmed after the fact.

## How it works

- **Manual timer, seamless capture.** A global shortcut opens a client picker.
  Everything you do while the timer runs is assigned to that client — no need to
  tag individual apps or URLs. This solves the "generic URL can't be attributed"
  problem: the timer window _is_ the attribution.
- **ActivityWatch under the hood.** Tally is a read-only consumer of the local
  [ActivityWatch](https://activitywatch.net) REST API (window watcher + AFK
  watcher + browser extension). It never writes to AW.
- **Runs in the background.** Lives in the system tray, can auto-start at login,
  and stays out of the way until you need it.
- **Post-session editing.** Open any session and exclude activities that weren't
  really work for that client; analytics update accordingly.
- **Optional team sync.** Each machine can push its tracked time to a shared
  Supabase (Postgres) database, so the whole team's hours show up in one place
  (Dashboard → **Team**). Local SQLite stays the source of truth: tracking works
  offline whether or not sync is set up. See [Team sync](#team-sync).

## Stack

- **Electron + electron-vite** — desktop shell with instant HMR in dev
- **React 19 + TypeScript + Tailwind** — renderer UI
- **better-sqlite3** — local SQLite storage; the app works fully offline
- **postgres (postgres.js)** — optional push to the shared team database
- **Zustand** — renderer state
- **Vitest** — unit tests for the analytics/attribution logic

## Team sync

Off by default — the app is fully usable without it.

**Per person, once:** Settings → **Team sync** → enter your name and the shared
database connection string → **Save** (it verifies the connection before
storing). A **Mine / Team** toggle then appears on the Dashboard. Your time
pushes every 5 minutes, and **Sync now** forces it.

Two things to get right:

- **Everyone needs a different name.** The name is the team-wide identity — two
  people using the same one merge into a single person.
- **The connection string is a shared password.** Anyone holding it can read and
  change the team's data. It's stored locally per machine (never in the build or
  the repo), so rotating the Supabase password is enough to cut access — no new
  installer needed.

**Setting up the database (once for the team):** apply
[`supabase/schema.sql`](supabase/schema.sql) to a Supabase project
(`psql "$DATABASE_URL" -f supabase/schema.sql`, or the Supabase SQL editor).
To seed it from an existing machine's history:

```bash
DATABASE_URL=postgres://… TALLY_PERSON_NAME="Your Name" \
  npx electron scripts/import-to-supabase.ts [path-to-tally.db]
```

Run it via `ELECTRON_RUN_AS_NODE=1 npx electron …`, not plain `node`:
`postinstall` rebuilds `better-sqlite3` against Electron's ABI, so the system
Node can't load it. The import is idempotent, matches clients by name, and
defaults to `%APPDATA%/tally/tally.db` — prefer pointing it at a copy, since the
live file is being written to while the app runs.

### How it fits together

```
 Each machine                                  Supabase (shared)
 ┌────────────────────────────┐  every 5 min   ┌──────────────────────────┐
 │ ActivityWatch (localhost)  │  ─── push ───▶ │ people / clients          │
 │ Tally  →  local SQLite     │                │ daily_activity (+person)  │
 │   (source of truth)        │                │ timer_sessions (+person)  │
 └────────────────────────────┘                └──────────────────────────┘
      works offline, always                      Dashboard → Team reads this
```

Sync never blocks tracking: it fails soft and the next run catches up. Clients
are matched **by name**, because ids are per-machine autoincrement and mean
nothing to the team. `report_history` (local PDF/CSV paths) and `app_settings`
(shortcuts, auto-launch) stay local — they're machine-specific.

## Development

```bash
npm install        # installs deps + rebuilds better-sqlite3 for Electron
npm run dev        # launches Electron with hot-reloading renderer
npm test           # runs the vitest suite
npm run typecheck  # tsc over main + renderer
npm run build:win  # produces a Windows installer
```

`npm run dev` opens the app with full HMR — edit anything under `src/renderer`
and it reloads instantly, no rebuild required.

## Architecture

```
src/
  main/         Electron main process
    db.ts             SQLite schema + queries
    activitywatch.ts  read-only AW REST client
    categorize.ts     rule engine (app/title/domain → client)
    analytics.ts      rollups + manual-timer session overrides
    ingest.ts         AW → categorize → override → rollup pipeline
    reports.ts        client work-summary PDF/CSV generation
    timer.ts          in-memory timer state machine
    supabase.ts       shared-database connection (optional, from Settings)
    sync.ts           local → shared push + team summary
    shortcuts.ts      global keyboard shortcuts
    tray.ts           system tray
    windows.ts        main window + client-picker popup
    handlers.ts       IPC registry
  preload/      contextBridge → window.tally
  renderer/     React app (dashboard, sessions, clients, settings) + picker popup
  shared/       types shared across main and renderer
supabase/
  schema.sql    shared team database (mirrors db.ts + a person dimension)
scripts/
  import-to-supabase.ts   one-time: seed the shared DB from a local store
```

The manual timer is the heart of it: `applySessionOverrides` in `analytics.ts`
reassigns every activity inside a timer window to the session's client, unless
the user has excluded it — overriding whatever the passive rules would have said.

Two details in `sync.ts` are load-bearing and easy to break: the shared schema
stores "no client" as `-1` (Postgres rejects `NULL` in a primary key, and
unattributed time is most of a manual-timer day), and rows are merged/summed
before insert because SQLite treats `NULL`s in a primary key as distinct while
Postgres does not. `sync.test.ts` covers both — they silently lose time if
mishandled.

## Requirements

- Windows (primary target; macOS/Linux build configs included)
- [ActivityWatch](https://activitywatch.net) desktop app running, with the
  browser extension installed for per-URL accuracy
