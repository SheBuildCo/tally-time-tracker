# Deployment — always-on local instance (employee machines)

Tally no longer ships as a packaged installer. Instead, each employee's machine
runs a normal Next.js production server that starts itself automatically at
login and updates itself from git on every boot — nothing to download, nothing
to launch by hand.

## How it works

1. A Windows **Scheduled Task** ("Tally Auto-Start") fires at logon and runs
   [`scripts/tally-start.ps1`](../scripts/tally-start.ps1).
2. That script does, on every firing: `git pull` the deploy branch → `npm
   install` → `npm run build` → `npm start` (bound to `127.0.0.1:3000`). Each
   step is best-effort — a failed pull or install just falls through to
   whatever's already on disk, and a failed build restores the previous
   working build, so a bad push never takes down an already-running instance.
3. The task's `IgnoreNew` policy means firing it again while it's already
   running (e.g. a second logon) is a no-op — no port-conflict or
   double-instance handling needed beyond that.
4. Local data (the SQLite store, mapping rules, clients) lives in
   `%LOCALAPPDATA%\Tally`, set via the `TALLY_DATA_DIR` environment variable by
   the wrapper script — independent of wherever the git checkout lives, so it
   survives re-clones and checkout moves.
5. Employees reach the dashboard at `http://localhost:3000` via a bookmark or
   pinned tab they set up once. The boot task does not open a browser for
   them.

## One-time setup on a new employee machine

Prerequisites (not automated by this repo — confirm before rollout):

- **Node.js 22 LTS** and **Git for Windows** installed and on `PATH`.
- **Git access to this private repo** configured for that machine/account —
  either a cached Git Credential Manager login for the employee's own GitHub
  account, or a repo-scoped deploy key/PAT provisioned by IT. Pick one
  approach across the team; `git pull` in `tally-start.ps1` runs
  unattended and needs it to already work non-interactively.

Then, from an elevated-not-required PowerShell prompt:

```powershell
cd path\to\tally-app\scripts
.\setup-autostart.ps1 -RepoUrl "https://github.com/SheBuildCo/tally-app.git"
```

This clones the repo (if not already present), installs the boot wrapper to
`%LOCALAPPDATA%\Tally\scripts\`, registers the scheduled task, and fires it
once immediately so you can confirm the app comes up before the first real
reboot.

## Notes and known limitations

- **Deploy branch stability.** Whatever is on the `main` branch (the default
  `-Branch` for both scripts) ships to every employee machine on their next
  login — there's no staging gate in this flow. Keep a CI check (`npm ci &&
  npm test`) gating merges to that branch.
- **Firewall.** The server binds `127.0.0.1` only (not `0.0.0.0`), which
  should avoid the Windows Defender Firewall's inbound-connection prompt for a
  loopback-only server. Confirm on a real machine/image — some endpoint
  security tools hook regardless of bind address.
- **Hidden console window.** The task runs with `-WindowStyle Hidden` and the
  task's own "Hidden" setting. If a console window still flashes briefly on
  some machine images, wrap the PowerShell invocation in a `.vbs` shim
  (`WScript.Shell.Run(cmd, 0, False)`) instead.
- **Logs.** Each run appends to `%LOCALAPPDATA%\Tally\autostart.log` — check
  this first when the app doesn't come up after a reboot.
