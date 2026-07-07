# Setup — ActivityWatch on Windows

Tally reads autonomously-captured usage from **ActivityWatch** running locally.
This guide gets the tracker capturing both **desktop apps** and **browser
tabs/URLs** so Tally has data to work with.

## What you need (at a glance)

**Required**

1. The **ActivityWatch** app installed and running (its installer bundles the two
   watchers Tally needs — the window watcher and the idle watcher — automatically).
2. The **ActivityWatch web-watcher browser extension**, so web time is tracked per
   tab with real URLs (without it, browsers are tracked only by window title).

**Optional**

- An **Anthropic API key** (Settings → AI cleanup) to enable the AI title/site
  cleanup. Tally is fully functional without it; the feature just needs outbound
  internet to Anthropic when enabled.

Everything else — the local data store and a set of starter clients/rules — is
created automatically on first run. There's nothing else to configure.

## 1. Install ActivityWatch

1. Download the Windows installer from <https://activitywatch.net/downloads/>.
2. Run the installer and launch **ActivityWatch** (the tray app is `aw-qt`).
3. Confirm it's running: open <http://localhost:5600> — you should see the
   ActivityWatch web UI.

Out of the box this starts two watchers:

- **aw-watcher-window** — the active application and window title
  (e.g. `OUTLOOK.EXE`, `ms-teams.exe`, your browser).
- **aw-watcher-afk** — keyboard/mouse activity, so idle time is excluded.

> Tip: enable **"Start at login"** in the ActivityWatch tray menu so tracking is
> always on with no user action — this is what keeps input to a minimum.

## 2. Add the browser extension (required for web-app tracking)

Desktop apps are captured automatically, but to attribute **web** time (client PM
tools, Outlook on the web, Canva, …) ActivityWatch needs the browser extension,
which reports the active tab's **URL** and title.

**Chrome is recommended** — it gives the most accurate per-tab tracking. Install the
**ActivityWatch Web Watcher** for each browser the team uses:

- **Chrome (recommended)** — search "ActivityWatch Web Watcher" in the Chrome Web
  Store and add it.
- **Microsoft Edge / Comet** (also Chromium, the same Chrome extension works) —
  install it from the Chrome Web Store as above.
- **Firefox**: install from
  <https://addons.mozilla.org/firefox/addon/aw-watcher-web/>.

After installing, click the extension icon once — it should show "Connected" to
`localhost:5600`. A new bucket named `aw-watcher-web-<browser>` will appear at
<http://localhost:5600>.

> The web watcher only reports while the browser is the active window, and Tally
> further intersects it with non-idle time, so a URL is only billed when you were
> actually present in that tab.

### Comet

**Comet is Chromium**, so install the same **ActivityWatch Web Watcher** extension
in it (Chrome Web Store, as above). This is what makes per-tab tracking accurate:
the extension reports each tab's real **URL and title**, and Tally attributes time
**per tab** from that data. Without the extension, Comet falls back to the OS window
title, which is often stale or generic ("New Tab") and can collapse several tabs into
one entry — so confirm the extension shows **"Connected"** and that an
`aw-watcher-web-*` bucket is filling at <http://localhost:5600>.

### Browsers without an extension

If a browser has no ActivityWatch extension, Tally still captures it at
**window-title** granularity: the active tab's title shows up as an "activity" even
without a URL. Map these to clients with **title** rules in **Settings → Unassigned
usage** — a tab with no URL is suggested as a *tab/chat title* rule, and you can also
match a keyword in the title (e.g. the client's name).

## 3. Verify capture

1. Use Outlook desktop, Teams, and a client web app for a few minutes.
2. Open <http://localhost:5600> → **Activity** / **Timeline** and confirm events
   appear for the apps and the websites you visited.
3. Check the raw API: <http://localhost:5600/api/0/buckets/> should list
   `aw-watcher-window_<host>`, `aw-watcher-afk_<host>`, and one or more
   `aw-watcher-web-*` buckets.

## 4. Run Tally

**End users:** Tally auto-starts at login and runs quietly in the background —
see [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for one-time setup on a new machine.
Once it's set up, just open your bookmark to `http://localhost:3000`.

**Developers:** run it locally instead —
```bash
npm install
npm run dev    # http://localhost:3000
```

Either way, if ActivityWatch is reachable you'll see today's activity; if not, Tally
shows a clear "ActivityWatch isn't running" banner and falls back to saved history.

## 5. Map usage to clients

On first run Tally seeds a few starter clients (**Internal / Admin** and two example
clients) and maps common apps (Outlook, Teams, Canva) to **Internal / non-billable**,
so the dashboard has structure immediately. Add your own clients and assign your sites:

- **Add your clients & rates** — **Settings → Clients & rates**: enter each client's
  name and hourly rate, then **Add client**.
- **Assign a site to a client** — two equivalent ways, both create a rule for that
  **exact site** and immediately re-attribute that site's already-recorded time across
  the dates you're viewing:
  - **From the Activity tab** (easiest): in the **"By site"** view, expand a site and
    use the inline **Assign to → client → Assign** control.
  - **From Settings → Unassigned usage**: every unmapped site is listed (use the
    **Filter sites…** box to find one), pick a client (or **Internal / non-billable**)
    and click **Add rule**.
- **Two buttons in Settings**, for occasional housekeeping:
  - **Re-sync with current rules** — re-applies all your rules across the selected date
    range (use it after editing or deleting rules in bulk).
  - **Clean up titles & sites** — the optional AI pass (see step 6).

That's the only setup. From then on tracking is automatic and time flows into the
right client's billables.

## 6. (Optional) AI cleanup of tab titles & per-client sites

Some platforms give each client their own subdomain (e.g.
`maasgroup.looplogics.com`, `acme.looplogics.com`). Tally can use Claude to clean
up messy tab titles and split those per-client sites so each is billed to the
right client instead of being lumped under one `looplogics.com` rule.

- In **Settings → AI cleanup**, paste a shared Anthropic API key and click **Save
  key**. It's stored locally on that machine and never shown again.
- Click **Clean up titles & sites** (also runs automatically after a re-sync).
  Confident client matches are applied for you; anything uncertain is left in the
  **Unassigned usage** list with the suggested client pre-filled for a one-click
  confirm.

This feature is **optional and additive** — without a key, Tally works exactly as
before (titles just stay as the raw window title). When enabled it needs **outbound
internet** to Anthropic (`api.anthropic.com`), so allow that if your machine is behind
a strict firewall.

## Troubleshooting

| Symptom                              | Fix                                                                 |
| ------------------------------------ | ------------------------------------------------------------------- |
| Tally banner: "ActivityWatch isn't reachable" | Start `aw-qt`; confirm <http://localhost:5600> loads.      |
| Web time missing / no URLs           | Install the browser extension and click it to confirm "Connected".  |
| Comet tabs inaccurate / tabs missing | Install the Web Watcher extension **in Comet** and confirm "Connected"; per-tab accuracy needs it. |
| Browser shows "0s active"            | Expected when it was open but not the focused window — idle/background time is excluded. |
| Edge not tracked                     | Install the Chrome Web Store extension in Edge (it's Chromium).      |
| Wrong client on a site               | Edit/replace the mapping rule in **Settings → Mapping rules**.       |
| Site shows in Activity but I can't assign it | Assign it inline on the **Activity → By site** view, or find it in **Settings → Unassigned usage** (use the filter) — every site is listed now, however briefly visited. |
| Comet/other browser tab not mapped   | Map it by **title** in Settings → Unassigned usage (no URL needed).  |
| Changed rules in bulk, old time still wrong | Click **Re-sync with current rules** in Settings (assigning a single site already re-syncs on its own). |
| AW on a non-default port             | Set `AW_BASE_URL` before starting Tally.                             |

## Setting up a new employee machine

See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — run `scripts/setup-autostart.ps1`
once to clone the repo and register the auto-start task. Each teammate also
needs ActivityWatch installed (step 1) — Tally will show a banner if it's
missing.
