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
- **Shared team view** — a central server collects everyone's time so you can
  see team-wide totals per client and produce a weekly/monthly client recap.
  Each machine runs only a tiny agent; viewing is just a URL, nothing to install.

> **Status:** shared team instance (central server + per-machine agents),
> Windows machines. See [Roadmap](#roadmap) for what's deferred.

## How it fits together

```
 Each employee machine                         One central server
 ┌───────────────────────────┐  HTTPS POST     ┌──────────────────────────────────┐
 │ ActivityWatch (localhost) │   /api/ingest   │ lib/categorize  map → client      │
 │ Tally agent (npm run agent)│ ─(token)──────▶ │ lib/ingest      rollup per person │
 │  reads local AW, pushes    │                 │ lib/analytics   aggregate (team)  │
 └───────────────────────────┘                 │ UI (React) ◀─ REST ─ SQLite       │
                                                └──────────────────────────────────┘
```

Tally **only reads** from ActivityWatch — never writes tracking data. Each
machine's agent pushes its raw events to the server, which stores them per
person, categorizes against the shared rules, and rolls up per-person totals.
See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full shape and setup.

## Two ways to run it

### A. Developers — local dev
```bash
npm install
npm run dev        # http://localhost:3000
# in another terminal, push your own machine's ActivityWatch to it:
TALLY_CENTRAL_URL=http://localhost:3000 TALLY_PERSON_TOKEN=<token> npm run agent
```
Grab a token from **Settings → People → Add person** (or set `TALLY_PERSON_TOKEN`
before first run to pin the seeded person's token). No build/executable step to
test a change — pull the branch and run.

### B. Shared team deployment
One central server behind a login, plus a `setup-autostart.ps1` per machine that
registers a logon task running `npm run agent` — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Configuration

Environment variables (all optional):

**Server** (the central instance):

| Variable            | Default                 | Purpose                                   |
| ------------------- | ----------------------- | ----------------------------------------- |
| `TALLY_DATA_DIR`    | `./data`                | Where the SQLite store lives              |
| `TALLY_DB_PATH`     | `<data>/tally.db`       | Explicit SQLite file path (overrides dir) |
| `ANTHROPIC_API_KEY` | — (optional)            | Shared key for AI title/site cleanup      |
| `TALLY_PERSON_TOKEN`| — (optional)            | Pin the seeded default person's token (dev)|

**Agent** (each machine):

| Variable               | Default                 | Purpose                                |
| ---------------------- | ----------------------- | -------------------------------------- |
| `TALLY_CENTRAL_URL`    | — (required)            | Base URL of the central server         |
| `TALLY_PERSON_TOKEN`   | — (required)            | This machine's person token            |
| `AW_BASE_URL`          | `http://localhost:5600` | Local ActivityWatch URL                |
| `TALLY_SYNC_DAYS`      | `2`                     | Trailing days to push each cycle       |
| `TALLY_SYNC_INTERVAL_SEC` | `300`                | Seconds between pushes                  |

## Scripts

| Command               | Description                                            |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Dashboard in the browser (server)                     |
| `npm run build`       | Production build (for the central server)             |
| `npm start`           | Serve the production build                             |
| `npm run agent`       | Push this machine's ActivityWatch to the server       |
| `npm test`            | Unit tests (categorize, analytics, persistence)       |

## Project layout

```
app/            Next.js App Router — pages (Overview, Clients, Daily, Activity,
                Settings) + REST API routes (incl. /api/ingest, /api/people)
lib/            activitywatch (AW reads), categorize (rules + title labels),
                analytics (aggregation), ingest (rollup + push source), db
                (SQLite: people, clients, rules, per-person rollups, raw events),
                report (orchestration), handlers (API business logic),
                client (browser↔REST transport)
components/     dashboard UI (Tremor + Tailwind, pastel design system in ui.tsx)
scripts/        agent.ts (per-machine push agent), tally-start.ps1 (agent boot
                wrapper), setup-autostart.ps1 (one-time provisioning) — see
                docs/DEPLOYMENT.md
__tests__/      unit tests with AW event fixtures
docs/SETUP.md   ActivityWatch install + browser extension + Comet notes
docs/DEPLOYMENT.md  shared team deployment (central server + machine agents)
```

## Roadmap

Deferred for now, designed for but not yet built:

- Calendar-month range selection (e.g. "July") for the monthly recap — views are
  trailing-window today (7/30/90 days).
- In-app auth / roles (today access is gated at the edge, e.g. Cloudflare Access).
- Invoice generation / PDF export of a client's month.
- macOS / Linux machine agents (Windows is the team target today).

## Licensing

This project consumes ActivityWatch's local API; ActivityWatch is MPL-2.0 and runs
as a separate process. App dependencies (Next.js, Tremor, Tailwind) are MIT.
