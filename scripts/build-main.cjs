// Bundle the Electron main + preload (TypeScript, importing our lib/*) into
// plain CommonJS that Electron can run. better-sqlite3 (native) and electron are
// kept external — they're resolved from node_modules / unpacked at runtime.

const esbuild = require("esbuild");

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["electron", "better-sqlite3"],
  logLevel: "info",
};

Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.js",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.js",
  }),
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
