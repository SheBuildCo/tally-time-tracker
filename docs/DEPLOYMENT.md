# Deployment — shared team instance (Vercel + Supabase + machine agents)

Tally runs as **one app deployed on Vercel** that the whole team shares, backed
by **one Supabase Postgres database**, plus a **lightweight agent on each
employee machine** that reads that machine's local ActivityWatch and pushes the
day's usage to the app. The app categorizes everything against one shared set
of clients/rules and stores each person's time in Supabase so anyone can view
team-wide totals (and one person can produce the weekly/monthly client recap).

```
 Each employee machine                         Vercel (the app)      Supabase (the DB)
 ┌───────────────────────────┐  HTTPS POST     ┌──────────────────┐  ┌──────────────────┐
 │ ActivityWatch (localhost) │   /api/ingest   │ Next.js app       │  │ Postgres          │
 │ Tally agent (npm run agent)│ ─(token)──────▶ │  (serverless)    │─▶│  clients/rules/    │
 └───────────────────────────┘                 │  dashboard        │  │  people/rollups    │
     nothing else runs on the machine           └──────────────────┘  └──────────────────┘
```

Nothing is installed on employee machines except Node, Git, ActivityWatch, and
this repo's agent — no local database, build, or dashboard. Viewing is just a
URL; there's no VPS to provision, patch, or back up — Vercel runs the app and
Supabase runs the database.

## A. Stand up the shared Supabase project (once)

1. Create a project at [supabase.com](https://supabase.com) (the free tier is
   plenty for a small team's daily rollups).
2. Grab the Postgres connection string: **Project Settings → Database →
   Connection string**. Use the **connection pooling** (pgbouncer, port 6543)
   string for the Vercel deployment (serverless functions open/close
   connections frequently — pooling avoids exhausting Postgres' connection
   limit); either the pooled or direct string works fine for local dev.
3. The schema ([`lib/schema.sql`](../lib/schema.sql)) is applied automatically
   the first time the app connects — no manual SQL step needed for a fresh
   project. If you'd rather apply it explicitly up front: `psql "$DATABASE_URL"
   -f lib/schema.sql`, or paste it into the Supabase SQL editor.
4. **Migrating an existing local install?** Run
   `DATABASE_URL=<connection string> npm run migrate-to-supabase` once, from a
   checkout that still has the old `data/tally.db` — it copies people,
   clients, rules, and tracked history into Supabase. Safe to re-run.

## B. Deploy the app to Vercel (once)

1. Import the repo into Vercel (New Project → pick `tally-app`).
2. Set environment variables (Project Settings → Environment Variables):
   - `DATABASE_URL` — the Supabase connection string from step A.
   - `ANTHROPIC_API_KEY` — optional, for AI title/site cleanup (shared across
     the team; can alternatively be set once via the in-app Settings page).
3. Deploy. Vercel builds with `npm run build` and serves it — no process
   manager, systemd, or SSH access needed, and every push to the tracked
   branch redeploys automatically.
4. Put the deployment behind a login if the team dashboard shouldn't be public
   — e.g. Vercel's built-in [password protection / SSO](https://vercel.com/docs/deployment-protection)
   on Pro, or a Cloudflare Access application in front of the Vercel domain.
   Either way, **exempt `/api/ingest`** from the interactive login (it's
   already protected by each person's bearer token, and machine agents POST to
   it non-interactively).

## C. Add your team (once per person)

In the dashboard: **Settings → People → Add person**. Each add issues that
machine's **agent token**, shown exactly once. Copy it — you'll paste it into
that person's machine setup below. (Equivalently: `POST /api/people {name}`.)

Set up your clients and billable rates in **Settings → Clients & rates** as
before; these are now shared by the whole team.

## D. Set up each employee machine (once)

Prerequisites on the machine: **Node 22 LTS**, **Git for Windows**,
**ActivityWatch** running (see [SETUP.md](SETUP.md)), and git access to this
repo (a cached Git Credential Manager login or a repo-scoped deploy key, so the
agent's `git pull` runs non-interactively).

From a PowerShell prompt (no admin needed), with the person's token from step C:

```powershell
cd path\to\tally-app\scripts
.\setup-autostart.ps1 `
    -RepoUrl    "https://github.com/SheBuildCo/tally-app.git" `
    -CentralUrl "https://tally.example.com" `
    -Token      "<the person's agent token>"
```

`-CentralUrl` is the Vercel deployment's URL (or a custom domain pointed at
it). This clones the repo, writes the machine's config (central URL + token) to
`%LOCALAPPDATA%\Tally\agent.config.ps1` (outside the checkout — it holds a
secret), installs the boot wrapper, and registers the **"Tally Agent"** logon
task that runs `npm run agent`. The agent reads the machine's local
ActivityWatch and pushes each recent day to the app every few minutes, now
and on every future logon. It auto-updates via `git pull` on each logon.

## How updates work now

- **App / dashboard:** push to the tracked branch — Vercel builds and deploys
  automatically. Everyone sees the new version immediately, no reinstalls, no
  server to SSH into.
- **Database:** schema changes ship as edits to `lib/schema.sql` (applied
  automatically on next connect) — no separate migration step for additive
  changes.
- **Machine agents:** auto-update on each logon (the task's `git pull`). The
  agent is small and changes rarely.

## Notes and known limitations

- **Privacy.** Every person's full detail (per-client hours, sites, and
  tab/window titles) is centralized and visible to anyone who can open the
  dashboard. That's the chosen tradeoff for rich recaps; gate the dashboard
  accordingly (see step B.4).
- **Reporting ranges.** Views use trailing windows (Today / 7 / 30 / 90 days) —
  7 days covers the weekly recap and 30 the monthly one closely. True
  calendar-month selection (e.g. "July") is a deliberate follow-up: it needs an
  explicit start/end-date path threaded through the day-based aggregation, not
  built here.
- **Anthropic key.** Prefer the Vercel `ANTHROPIC_API_KEY` env var; the in-app
  Settings key still works (stored in Supabase) as a fallback/override.
- **Logs.** The agent appends to `%LOCALAPPDATA%\Tally\agent.log` on each
  machine — check it first if a machine's time stops appearing. For the app
  itself, use Vercel's deployment logs.
- **Local dev without a shared Supabase project yet:** create your own free
  Supabase project and point `DATABASE_URL` at it — the schema and a seeded
  default person/clients are created automatically on first run.
