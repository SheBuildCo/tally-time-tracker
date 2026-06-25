// Electron main process. Hosts the data layer (better-sqlite3 + ActivityWatch
// reads + analytics) and exposes it to the static-exported UI over IPC, so the
// packaged app needs no running web server. The same lib/handlers functions back
// both this and the browser-dev REST API.

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// DEV loads the live Next dev server; otherwise we serve the static export. The
// TALLY_FORCE_PROD escape hatch exercises the exact packaged load path (app://)
// from an unpacked checkout, so the production renderer can be verified without
// building a full installer.
const DEV =
  (!app.isPackaged || process.env.ELECTRON_DEV === "1") &&
  process.env.TALLY_FORCE_PROD !== "1";
const AW_DOWNLOAD_URL = "https://activitywatch.net/downloads/";

// Custom scheme used to serve the static export. A *standard* scheme gives the
// renderer a real origin, so the export's absolute asset paths (/_next/...) and
// the Next App-Router client routes resolve correctly — unlike file://, where an
// absolute path points at the filesystem root and every asset/route 404s.
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
};

// Resolve an app:// request to a file inside the static export (out/). Directory
// and extensionless paths get index.html (Next emits trailingSlash routes as
// <route>/index.html); anything outside out/ or missing falls back to the root
// index.html so client-side routing can still boot.
function registerAppProtocol(): void {
  const outDir = path.join(__dirname, "..", "out");
  const indexFile = path.join(outDir, "index.html");

  protocol.handle(APP_SCHEME, (request) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      pathname = "/";
    }

    let filePath = path.normalize(path.join(outDir, pathname));
    // Path-traversal guard: never serve outside the export directory.
    if (filePath !== outDir && !filePath.startsWith(outDir + path.sep)) {
      filePath = indexFile;
    } else if (pathname.endsWith("/") || path.extname(filePath) === "") {
      filePath = path.join(filePath, "index.html");
    }
    if (!fs.existsSync(filePath)) filePath = indexFile;

    const mime = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    try {
      const body = fs.readFileSync(filePath);
      return new Response(body, { headers: { "content-type": mime } });
    } catch {
      // Last resort: let Electron serve the file directly (also asar-aware).
      return net.fetch(pathToFileURL(indexFile).toString());
    }
  });
}

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
    cleanup: (days: number, opts: any) => h.cleanup(days, opts),
    setApiKey: (value: string) => h.setApiKey(value),
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
    win.loadURL(`${APP_ORIGIN}/index.html`);
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
  if (!DEV) registerAppProtocol();
  createWindow();
  await guideTrackerSetup();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
