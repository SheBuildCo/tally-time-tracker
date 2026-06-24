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

### Comet and browsers without an extension

Tally also tracks at **window-title** granularity, so browsers that don't have an
ActivityWatch extension — like **Comet** — are still captured in detail: the active
tab's title (e.g. a specific client chat in Teams, or a document name) shows up as
an "activity" even without a URL. For these browsers:

- You don't need the web extension — the window watcher already reports tab titles.
- Map them to clients with **title** rules: in **Settings → Unassigned usage**, a
  browser tab with no URL is suggested as a *tab/chat title* rule you can assign to
  a client. You can also map by a keyword that appears in the title (e.g. the
  client's name).

## 3. Verify capture

1. Use Outlook desktop, Teams, and a client web app for a few minutes.
2. Open <http://localhost:5600> → **Activity** / **Timeline** and confirm events
   appear for the apps and the websites you visited.
3. Check the raw API: <http://localhost:5600/api/0/buckets/> should list
   `aw-watcher-window_<host>`, `aw-watcher-afk_<host>`, and one or more
   `aw-watcher-web-*` buckets.

## 4. Run Tally

**End users (recommended):** install the **Tally** desktop app (the
`Tally-Setup-*.exe` installer). On first launch it checks for ActivityWatch and, if
it isn't running, offers to take you to the download page. Once AW is running, your
activity appears automatically; otherwise Tally still shows your saved history.

**Developers:** run it in the browser instead —
```bash
npm install
npm run dev    # http://localhost:3000
```

Either way, if ActivityWatch is reachable you'll see today's activity; if not, Tally
shows a clear "ActivityWatch isn't running" banner and falls back to saved history.

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
| Comet/other browser tab not mapped   | Map it by **title** in Settings → Unassigned usage (no URL needed).  |
| Changed rules, old time still wrong  | Click **Re-sync with current rules** in Settings.                   |
| AW on a non-default port             | Set `AW_BASE_URL` before starting Tally.                             |

## Building the installer (for whoever distributes Tally)

On a **Windows** machine:

```bash
npm install
npm run dist     # produces dist/Tally-Setup-<version>.exe
```

Share that `.exe` with the team. Each teammate also needs ActivityWatch installed
(step 1) — Tally will prompt them if it's missing.
