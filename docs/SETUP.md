# Setup — ActivityWatch on Windows

Tally reads autonomously-captured usage from **ActivityWatch** running locally.
This guide gets the tracker capturing both **desktop apps** and **browser
tabs/URLs** so Tally has data to work with.

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

Install the **ActivityWatch Web Watcher** for each browser the team uses:

- **Chrome / Microsoft Edge** (Edge is Chromium, the Chrome extension works):
  search "ActivityWatch Web Watcher" in the Chrome Web Store and add it.
- **Firefox**: install from
  <https://addons.mozilla.org/firefox/addon/aw-watcher-web/>.

After installing, click the extension icon once — it should show "Connected" to
`localhost:5600`. A new bucket named `aw-watcher-web-<browser>` will appear at
<http://localhost:5600>.

> The web watcher only reports while the browser is the active window, and Tally
> further intersects it with non-idle time, so a URL is only billed when you were
> actually present in that tab.

## 3. Verify capture

1. Use Outlook desktop, Teams, and a client web app for a few minutes.
2. Open <http://localhost:5600> → **Activity** / **Timeline** and confirm events
   appear for the apps and the websites you visited.
3. Check the raw API: <http://localhost:5600/api/0/buckets/> should list
   `aw-watcher-window_<host>`, `aw-watcher-afk_<host>`, and one or more
   `aw-watcher-web-*` buckets.

## 4. Run Tally

```bash
npm install
npm run dev    # http://localhost:3000
```

Open the dashboard. If ActivityWatch is reachable you'll see your activity; if not,
Tally shows a clear "ActivityWatch isn't reachable" banner instead of failing.

## 5. Map usage to clients

Go to **Settings**:

- Tally pre-seeds your firm's common apps (Outlook, Teams, Canva) as
  **Internal / non-billable**.
- The **Unassigned usage** list shows apps/sites with no rule yet — pick a client
  (or "Internal") and click **Add rule**. Client web apps are matched by domain,
  so a PM tool used under a client's login maps cleanly to that client.
- Add your real **clients** and their **billable rates** in the Clients section.

That's the only setup. From then on tracking is automatic and time flows into the
right client's billables.

## Troubleshooting

| Symptom                              | Fix                                                                 |
| ------------------------------------ | ------------------------------------------------------------------- |
| Tally banner: "ActivityWatch isn't reachable" | Start `aw-qt`; confirm <http://localhost:5600> loads.      |
| Web time missing / no URLs           | Install the browser extension and click it to confirm "Connected".  |
| Edge not tracked                     | Install the Chrome Web Store extension in Edge (it's Chromium).      |
| Wrong client on a site               | Edit/replace the mapping rule in **Settings → Mapping rules**.       |
| AW on a non-default port             | Set `AW_BASE_URL` before starting Tally.                             |
