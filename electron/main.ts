// Electron main process. Hosts the data layer (better-sqlite3 + ActivityWatch
// reads + analytics) and exposes it to the static-exported UI over IPC, so the
// packaged app needs no running web server. The same lib/handlers functions back
// both this and the browser-dev REST API.

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";

const DEV = !app.isPackaged || process.env.ELECTRON_DEV === "1";
const AW_DOWNLOAD_URL = "https://activitywatch.net/downloads/";

// Loaded lazily AFTER we set the data dir, so the DB opens in the right place.
type Handlers = typeof import("../lib/handlers");
let handlers: Handlers | null = null;

async function getHandlers(): Promise<Handlers> {
  if (handlers) return handlers;
  // Persist the local SQLite DB in the per-user data dir (survives app updates).
  process.env.TALLY_DATA_DIR = app.getPath("userData");
  handlers = await import("../lib/handlers");
  return handlers;
}

function registerIpc(h: Handlers): void {
  const map: Record<string, (...args: any[]) => unknown> = {
    getAnalytics: (days: number) => h.getAnalytics(days),
    getClientReport: (id: number, days: number) => h.getClientReport(id, days),
    getClientDay: (id: number, date: string) => h.getClientDay(id, date),
    getDaily: (days: number) => h.getDaily(days),
    health: () => h.health(),
    resync: (days: number) => h.resync(days),
    listClients: () => h.getClients(),
    createClient: (input: any) => h.addClient(input),
    updateClient: (id: number, fields: any) => h.patchClient(id, fields),
    deleteClient: (id: number) => h.removeClient(id),
    listRules: () => h.getRules(),
    createRule: (body: any) => h.addRule(body),
    deleteRule: (id: number) => h.removeRule(id),
  };
  for (const [name, fn] of Object.entries(map)) {
    ipcMain.handle(`tally:${name}`, (_event, ...args) => fn(...args));
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#eef1f6",
    title: "Tally",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV) {
    win.loadURL("http://localhost:3000");
  } else {
    win.loadFile(path.join(__dirname, "..", "out", "index.html"));
  }
  return win;
}

/** Detect-&-guide: if ActivityWatch isn't running, point the user to install it. */
async function guideTrackerSetup(): Promise<void> {
  try {
    const h = await getHandlers();
    const status = await h.health();
    if (status.available) return;
    const choice = dialog.showMessageBoxSync({
      type: "info",
      title: "Start ActivityWatch",
      message: "Tally needs ActivityWatch running to track your time.",
      detail:
        "ActivityWatch is a free open-source tracker that runs quietly in the " +
        "background. Install and start it, then Tally will pick up your activity " +
        "automatically. Your saved history is still shown in the meantime.",
      buttons: ["Get ActivityWatch", "Continue"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) await shell.openExternal(AW_DOWNLOAD_URL);
  } catch {
    // Never block app start on the guide.
  }
}

app.whenReady().then(async () => {
  const h = await getHandlers();
  registerIpc(h);
  createWindow();
  await guideTrackerSetup();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
