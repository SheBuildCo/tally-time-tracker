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
- **Native desktop app** — ships as a Windows installer (Electron); no dev setup or
  terminal needed for end users.

> **Status:** single user, Windows, local-only. See [Roadmap](#roadmap) for what's
> deliberately deferred.

## How it fits together

```
 ActivityWatch (localhost:5600)        Tally desktop app (Electron)
 ┌───────────────────────────┐  read   ┌──────────────────────────────────────┐
 │ aw-watcher-window  (apps) │ ──────▶ │ lib/ingest      snapshot → SQLite      │
 │ aw-watcher-afk     (idle) │         │ lib/categorize  map app/title/url→client│
 │ aw-watcher-web     (URLs) │         │ lib/analytics   aggregate (clients/days)│
 └───────────────────────────┘         │ UI (static export)  ◀─IPC─ main process │
                                        └──────────────────────────────────────┘
```

Tally **only reads** from ActivityWatch — it never writes tracking data. Past days
are snapshotted into the local DB and the current day is recomputed live, so the
dashboard stays correct and keeps history.

## Two ways to run it

### A. End users — the packaged app
Install **ActivityWatch** (see [`docs/SETUP.md`](docs/SETUP.md)), then run the
**Tally** installer. On first launch Tally checks for ActivityWatch and guides you
to install it if it's missing. Nothing else to set up.

### B. Developers — browser dev
```bash
npm install
npm run dev        # http://localhost:3000 (uses the REST API routes)
```

### Build the Windows installer

**Automatically (recommended) — GitHub Actions builds it in the cloud.**
Every push to the dev branch runs `.github/workflows/build-windows.yml` on a Windows
runner and uploads `Tally-Setup-*.exe` as a build **artifact**. To get the installer:

1. Open the repo on GitHub → **Actions** tab.
2. Click the latest **Build Windows installer** run.
3. Download the **Tally-Setup** artifact (a zip containing the `.exe`).

To cut a versioned download teammates can bookmark, push a tag — the same workflow
attaches the installer to a **GitHub Release**:
```bash
git tag v0.1.0
git push origin v0.1.0
```

**Manually — build on a Windows machine yourself:**
```bash
npm install
npm run dist       # static-exports the UI, bundles the Electron main, builds dist/Tally-Setup-*.exe
```
> Use **Node 22 LTS** (see `.nvmrc`). The installer must be built on Windows (or the
> Windows CI above). On macOS/Linux you can run `npm run export:next` and
> `npm run build:main` to verify the build, but not produce a Windows `.exe`.

### Run the desktop app in dev (Electron shell + live reload)
```bash
npm run electron:dev   # Next dev server + Electron window via IPC
```

## Configuration

Environment variables (all optional):

| Variable          | Default                       | Purpose                                   |
| ----------------- | ----------------------------- | ----------------------------------------- |
| `AW_BASE_URL`     | `http://localhost:5600`       | ActivityWatch server URL                  |
| `TALLY_DATA_DIR`  | `./data` (app userData in pkg)| Where the local SQLite store lives        |
| `TALLY_DB_PATH`   | `<data>/tally.db`             | Explicit SQLite file path (overrides dir) |

In the packaged app the database lives in the OS user-data folder (e.g.
`%APPDATA%/Tally`), so it persists across updates.

## Scripts

| Command               | Description                                            |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Dashboard in the browser (REST API)                   |
| `npm test`            | Unit tests (categorize, analytics, persistence)       |
| `npm run electron:dev`| Electron window against the dev server                |
| `npm run export:next` | Static-export the UI to `out/` (API routes excluded)  |
| `npm run build:main`  | Bundle the Electron main/preload to `dist-electron/`  |
| `npm run dist`        | Build the desktop installer (Windows → NSIS)          |

## Project layout

```
app/            Next.js App Router — pages (Overview, Clients, Daily, Activity,
                Settings) + REST API routes (browser dev only)
lib/            activitywatch (AW reads), categorize (rules + title labels),
                analytics (aggregation), ingest (persistence), db (SQLite),
                report (orchestration), handlers (shared by API + IPC), client
                (browser↔IPC transport)
components/     dashboard UI (Tremor + Tailwind, pastel design system in ui.tsx)
electron/       main.ts (IPC + window), preload.ts (window.tally bridge)
scripts/        build-main.cjs (esbuild), export-electron.cjs (static export)
__tests__/      unit tests with AW event fixtures
docs/SETUP.md   ActivityWatch install + browser extension + Comet notes
```

## Roadmap

Deferred for now, designed for but not yet built:

- Central team server + multi-user sync (the `lib/` logic can point at a central
  aggregator instead of `localhost:5600`).
- Authentication & roles.
- Invoice generation / PDF export of a client's day.
- macOS / Linux packaged builds (config is already present).

## Licensing

This project consumes ActivityWatch's local API; ActivityWatch is MPL-2.0 and runs
as a separate process. App dependencies (Next.js, Tremor, Tailwind, Electron) are MIT.
