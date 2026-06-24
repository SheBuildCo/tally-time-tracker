// Produce the static-exported UI (out/) for the Electron build.
//
// The Next API routes are dynamic (they read the DB / ActivityWatch at request
// time) and so can't be part of a static export — and the packaged app doesn't
// need them, since it talks to the main process over IPC. We therefore move
// app/api aside for the duration of the export build and restore it afterwards,
// even on failure. The routes remain available for `next dev` (browser mode).

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const apiDir = path.join(root, "app", "api");
const stash = path.join(root, "app", "_api_disabled");

function restore() {
  if (fs.existsSync(stash)) {
    if (fs.existsSync(apiDir)) fs.rmSync(apiDir, { recursive: true, force: true });
    fs.renameSync(stash, apiDir);
  }
}

process.on("exit", restore);
process.on("SIGINT", () => process.exit(1));

try {
  if (fs.existsSync(apiDir)) fs.renameSync(apiDir, stash);
  execSync("next build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_EXPORT: "1" },
  });
} catch (err) {
  console.error("Static export failed:", err.message);
  restore();
  process.exit(1);
} finally {
  restore();
}
