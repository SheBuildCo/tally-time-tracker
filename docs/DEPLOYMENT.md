# Deployment — shared team instance (central server + machine agents)

Tally runs as **one central server** that the whole team shares, plus a
**lightweight agent on each employee machine** that reads that machine's local
ActivityWatch and pushes the day's usage to the server. The server categorizes
everything against one shared set of clients/rules and stores each person's time
so anyone can view team-wide totals (and one person can produce the weekly /
monthly client recap).

```
 Each employee machine                         One central server (~$5/mo VPS)
 ┌───────────────────────────┐  HTTPS POST     ┌──────────────────────────────────┐
 │ ActivityWatch (localhost) │   /api/ingest   │ Next.js app + one SQLite file     │
 │ Tally agent (npm run agent)│ ─(token)──────▶ │  shared clients/rules, all people │
 └───────────────────────────┘                 │  dashboard (team + per person)    │
                                                └──────────────────────────────────┘
     nothing else runs on the machine              ▲ Cloudflare Tunnel + Access (login)
                                                    │ team views in a browser — no install
```

Nothing is installed on employee machines except Node, Git, ActivityWatch, and
this repo's agent — no local database, build, or dashboard. Viewing is just a
URL behind a login; the server is updated once, centrally.

## A. Stand up the central server (once)

Any always-on Linux host works; a ~$4-6/mo VPS (Hetzner, DigitalOcean, Vultr)
is plenty for a small team pushing daily rollups.

1. **Provision** a small VPS, install **Node 22 LTS** and **git**.
2. **Clone & build:**
   ```bash
   git clone https://github.com/SheBuildCo/tally-app.git
   cd tally-app
   npm ci
   npm run build
   ```
   `better-sqlite3` compiles/downloads a prebuilt binary for the host during
   `npm ci` — no extra toolchain needed on Node 22 x64.
3. **Run** with a stable data directory and the shared Anthropic key (optional,
   for AI cleanup) as a host env var, bound to loopback (Cloudflare fronts it):
   ```bash
   TALLY_DATA_DIR=/var/lib/tally \
   ANTHROPIC_API_KEY=sk-ant-...   \
   npm start -- -H 127.0.0.1 -p 3000
   ```
   Run it under a process manager (systemd, pm2) so it restarts on reboot. The
   SQLite database lives at `$TALLY_DATA_DIR/tally.db`.
4. **Back it up:** a nightly copy of `tally.db` (e.g. `sqlite3 tally.db ".backup
   /backups/tally-$(date +%F).db"` via cron) is enough — the data is small.

### Put it behind a login (Cloudflare Tunnel + Access — free)

1. Add a **Cloudflare Tunnel** pointing at `http://127.0.0.1:3000` (via
   `cloudflared`) — this gives HTTPS with no open inbound ports.
2. Add a **Cloudflare Access** application over the tunnel hostname with an
   email allowlist (or your Google/Microsoft IdP) so only teammates can reach
   the dashboard. Access is free for small teams.
3. **Exempt the agent path:** add an Access policy that **bypasses**
   `/api/ingest` (or attach a service token), so machine agents can POST
   non-interactively. The endpoint is still protected — it requires a valid
   per-person token — so bypassing the interactive login there is safe.

## B. Add your team (once per person)

In the dashboard: **Settings → People → Add person**. Each add issues that
machine's **agent token**, shown exactly once. Copy it — you'll paste it into
that person's machine setup below. (Equivalently: `POST /api/people {name}`.)

Set up your clients and billable rates in **Settings → Clients & rates** as
before; these are now shared by the whole team.

## C. Set up each employee machine (once)

Prerequisites on the machine: **Node 22 LTS**, **Git for Windows**,
**ActivityWatch** running (see [SETUP.md](SETUP.md)), and git access to this
repo (a cached Git Credential Manager login or a repo-scoped deploy key, so the
agent's `git pull` runs non-interactively).

From a PowerShell prompt (no admin needed), with the person's token from step B:

```powershell
cd path\to\tally-app\scripts
.\setup-autostart.ps1 `
    -RepoUrl    "https://github.com/SheBuildCo/tally-app.git" `
    -CentralUrl "https://tally.example.com" `
    -Token      "<the person's agent token>"
```

This clones the repo, writes the machine's config (central URL + token) to
`%LOCALAPPDATA%\Tally\agent.config.ps1` (outside the checkout — it holds a
secret), installs the boot wrapper, and registers the **"Tally Agent"** logon
task that runs `npm run agent`. The agent reads the machine's local
ActivityWatch and pushes each recent day to the server every few minutes, now
and on every future logon. It auto-updates via `git pull` on each logon.

## How updates work now

- **Server / dashboard:** update once on the VPS (`git pull && npm ci && npm run
  build`, restart). Everyone sees the new version immediately — no reinstalls.
- **Machine agents:** auto-update on each logon (the task's `git pull`). The
  agent is small and changes rarely.

## Notes and known limitations

- **Privacy.** Every person's full detail (per-client hours, sites, and
  tab/window titles) is centralized and visible to anyone who can open the
  dashboard. That's the chosen tradeoff for rich recaps; gate the dashboard with
  Access accordingly.
- **Reporting ranges.** Views use trailing windows (Today / 7 / 30 / 90 days) —
  7 days covers the weekly recap and 30 the monthly one closely. True
  calendar-month selection (e.g. "July") is a deliberate follow-up: it needs an
  explicit start/end-date path threaded through the day-based aggregation, not
  built here.
- **Firewall / hosting.** The server binds `127.0.0.1`; Cloudflare Tunnel
  handles inbound, so no ports are exposed.
- **Anthropic key.** Prefer the host `ANTHROPIC_API_KEY` env var on the server;
  the in-app Settings key still works (stored in the shared DB, behind Access).
- **Logs.** The agent appends to `%LOCALAPPDATA%\Tally\agent.log` on each
  machine — check it first if a machine's time stops appearing.
- **Local `better-sqlite3` ABI error** (`NODE_MODULE_VERSION 130 vs 127`) on a
  developer checkout that predates the de-Electron migration: a stale native
  binary. Fix with `npm rebuild better-sqlite3` (or delete `node_modules` and
  reinstall).
