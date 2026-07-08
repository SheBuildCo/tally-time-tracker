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

## Stack

- **Electron + electron-vite** — desktop shell with instant HMR in dev
- **React 19 + TypeScript + Tailwind** — renderer UI
- **better-sqlite3** — local SQLite storage (no server, no cloud)
- **Zustand** — renderer state
- **Vitest** — unit tests for the analytics/attribution logic

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
    timer.ts          in-memory timer state machine
    shortcuts.ts      global keyboard shortcuts
    tray.ts           system tray
    windows.ts        main window + client-picker popup
    handlers.ts       IPC registry
  preload/      contextBridge → window.tally
  renderer/     React app (dashboard, sessions, clients, settings) + picker popup
  shared/       types shared across main and renderer
```

The manual timer is the heart of it: `applySessionOverrides` in `analytics.ts`
reassigns every activity inside a timer window to the session's client, unless
the user has excluded it — overriding whatever the passive rules would have said.

## Requirements

- Windows (primary target; macOS/Linux build configs included)
- [ActivityWatch](https://activitywatch.net) desktop app running, with the
  browser extension installed for per-URL accuracy
