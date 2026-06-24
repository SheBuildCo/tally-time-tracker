# Tally

Automatic time tracking for client billables — built for consultant teams who
need accurate, low-effort billing without starting and stopping timers.

Tally pairs a proven open-source autonomous tracker
([**ActivityWatch**](https://activitywatch.net/), MPL-2.0) with a custom
dashboard that maps your captured app & website usage to **clients**, **projects**
and **billable rates**, then shows you clean analytics and billable totals.

- **Autonomous capture** — ActivityWatch records the active desktop app *and* the
  active browser tab/URL, with idle (AFK) time excluded. No manual timers.
- **Works across web & desktop** — Outlook desktop, Microsoft Teams, plus web apps
  (client PM tools under their logins, Outlook on the web, Canva, …).
- **Maps usage → clients** — simple rules on app name, window title or web domain
  attribute time to the right client and mark it billable or internal.
- **Clean dashboard** — overview, per-client billables, per-app/site breakdown, and
  time trends.
- **Private by default** — this MVP runs locally; your data stays on your machine
  (ActivityWatch never uploads to the cloud).

> **Status:** MVP — single user, Windows, local-only. See
> [Roadmap](#roadmap) for what's deliberately deferred.

## How it fits together

```
 ActivityWatch (localhost:5600)             Tally (this app, Next.js)
 ┌───────────────────────────┐  REST/AQL   ┌──────────────────────────────┐
 │ aw-watcher-window  (apps) │ ──────────▶ │ lib/activitywatch  read usage │
 │ aw-watcher-afk     (idle) │             │ lib/categorize     map→client │
 │ aw-watcher-web     (URLs) │             │ lib/analytics      aggregate  │
 └───────────────────────────┘             │ dashboard          visualise  │
                                           └──────────────────────────────┘
```

Tally **only reads** from ActivityWatch — it never writes tracking data — so the
tracker remains the single source of truth for recorded time.

## Quick start

1. **Install & run ActivityWatch** on the Windows machine and add the browser
   extension. Full steps: [`docs/SETUP.md`](docs/SETUP.md). Confirm it's up at
   <http://localhost:5600>.
2. **Install and run Tally:**
   ```bash
   npm install
   npm run dev        # http://localhost:3000
   ```
3. Open the dashboard. The **Settings** page seeds your firm's common apps
   (Outlook, Teams, Canva) and shows any **unassigned** usage with one-click rule
   suggestions — assign each app/site to a client to start billing it.

## Configuration

Environment variables (all optional):

| Variable          | Default                  | Purpose                                   |
| ----------------- | ------------------------ | ----------------------------------------- |
| `AW_BASE_URL`     | `http://localhost:5600`  | ActivityWatch server URL                  |
| `TALLY_DATA_DIR`  | `./data`                 | Where the local SQLite store lives        |
| `TALLY_DB_PATH`   | `<data>/tally.db`        | Explicit SQLite file path (overrides dir) |

Clients, billable rates and mapping rules live in a small local SQLite database
(`data/tally.db`, gitignored). Usage events are **not** stored there — they're
queried from ActivityWatch on demand.

## Scripts

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `npm run dev`    | Start the dashboard (dev)            |
| `npm run build`  | Production build                     |
| `npm start`      | Run the production build             |
| `npm test`       | Run unit tests (categorize/analytics)|

## Project layout

```
app/            Next.js App Router — pages + API routes
  api/          analytics, clients, rules, health
lib/            activitywatch (AW client), categorize, analytics, db, report
components/     dashboard UI (Tremor + Tailwind)
__tests__/      unit tests with AW event fixtures
docs/SETUP.md   Windows install guide for ActivityWatch + browser extension
```

## Roadmap

Deferred from this MVP, designed for but not yet built:

- Central team server + multi-user sync (the `lib/` logic can point at a central
  aggregator instead of `localhost:5600`).
- Authentication & roles.
- Invoice generation/export.
- macOS / Linux support and a packaged desktop build.

## Licensing

This project consumes ActivityWatch's local API; ActivityWatch is MPL-2.0 and runs
as a separate process. UI dependencies (Next.js, Tremor, Tailwind) are MIT.
