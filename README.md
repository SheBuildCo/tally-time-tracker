# Tally

Automatic time tracking for client billables — built for consultant teams who
need accurate, low-effort billing without starting and stopping timers.

Tally pairs a proven open-source autonomous tracker
([**ActivityWatch**](https://activitywatch.net/), MPL-2.0) with a custom
desktop app that maps your captured app & website usage to **clients**, **projects**
and **billable rates**, then shows clean analytics, per-client views and daily
reports.

- **Autonomous capture** — ActivityWatch records the active desktop app *and* the
  active browser tab, with idle (AFK) time excluded. No manual timers.
- **Tab/title-level detail** — tracks the specific tab, chat or document (window
  title), so e.g. individual client chats inside Teams, or per-tab work in the
  **Comet** browser, are visible — not just "the app".
- **Works across web & desktop** — Outlook desktop, Microsoft Teams, plus web apps
  (client PM tools under their logins, Outlook on the web, Canva, …).
- **Maps usage → clients** — simple rules on app name, window **title** or web
  domain attribute time to the right client and mark it billable or internal.
- **Per-client views & daily reports** — a tab per client with their own breakdown,
  plus a Daily Totals table where each row opens that client's day ("what did you
  work on for us today?").
- **Local & persistent** — a local SQLite store keeps a per-day rollup of your
  tracked time, so history survives and is viewable even when the tracker isn't
  running. Data stays on your machine.
- **Always-on, nothing to launch** — runs as a lightweight local web server that
  auto-starts at Windows login; employees just open a bookmark, nothing to
  install or launch by hand.

> **Status:** single user, Windows, local-only. See [Roadmap](#roadmap) for what's
> deliberately deferred.

## How it fits together

```
 ActivityWatch (localhost:5600)        Tally (Next.js server, localhost:3000)
 ┌───────────────────────────┐  read   ┌──────────────────────────────────────┐
 │ aw-watcher-window  (apps) │ ──────▶ │ lib/ingest      snapshot → SQLite      │
 │ aw-watcher-afk     (idle) │         │ lib/categorize  map app/title/url→client│
 │ aw-watcher-web     (URLs) │         │ lib/analytics   aggregate (clients/days)│
 └───────────────────────────┘         │ UI (React)  ◀─ REST (app/api) ─ server  │
                                        └──────────────────────────────────────┘
```

Tally **only reads** from ActivityWatch — it never writes tracking data. Past days
are snapshotted into the local DB and the current day is recomputed live, so the
dashboard stays correct and keeps history.

## Two ways to run it

### A. Developers — local dev
```bash
npm install
npm run dev        # http://localhost:3000 (uses the REST API routes)
```
Pull the branch and run this — no build or executable step needed to test a change.

### B. Always-on employee deployment
Each employee machine runs a production build of the same app, auto-started at
Windows login and self-updating from git on every boot — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the one-time setup
(`scripts/setup-autostart.ps1`) and how it works.

## Configuration

Environment variables (all optional):

| Variable          | Default                       | Purpose                                   |
| ----------------- | ----------------------------- | ----------------------------------------- |
| `AW_BASE_URL`     | `http://localhost:5600`       | ActivityWatch server URL                  |
| `TALLY_DATA_DIR`  | `./data`                      | Where the local SQLite store lives        |
| `TALLY_DB_PATH`   | `<data>/tally.db`             | Explicit SQLite file path (overrides dir) |

In the always-on deployment (see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)),
`tally-start.ps1` sets `TALLY_DATA_DIR` to `%LOCALAPPDATA%\Tally`, so data
persists across git updates and independent of where the checkout lives.

## Scripts

| Command               | Description                                            |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Dashboard in the browser (REST API)                   |
| `npm run build`       | Production build (used by the always-on deployment)    |
| `npm start`           | Serve the production build                             |
| `npm test`            | Unit tests (categorize, analytics, persistence)       |

## Project layout

```
app/            Next.js App Router — pages (Overview, Clients, Daily, Activity,
                Settings) + REST API routes
lib/            activitywatch (AW reads), categorize (rules + title labels),
                analytics (aggregation), ingest (persistence), db (SQLite),
                report (orchestration), handlers (shared by the API routes),
                client (browser↔REST transport)
components/     dashboard UI (Tremor + Tailwind, pastel design system in ui.tsx)
scripts/        tally-start.ps1 (boot wrapper), setup-autostart.ps1 (one-time
                per-machine provisioning) — see docs/DEPLOYMENT.md
__tests__/      unit tests with AW event fixtures
docs/SETUP.md   ActivityWatch install + browser extension + Comet notes
docs/DEPLOYMENT.md  always-on employee deployment (Windows auto-start)
```

## Roadmap

Deferred for now, designed for but not yet built:

- Central team server + multi-user sync (the `lib/` logic can point at a central
  aggregator instead of `localhost:5600`).
- Authentication & roles.
- Invoice generation / PDF export of a client's day.
- macOS / Linux always-on deployment (Windows is the team target today).

## Licensing

This project consumes ActivityWatch's local API; ActivityWatch is MPL-2.0 and runs
as a separate process. App dependencies (Next.js, Tremor, Tailwind) are MIT.
