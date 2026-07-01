// Chrome profile provisioning (Windows). Node-only — reached exclusively from
// lib/handlers.ts in the main process / dev API routes, never the renderer.
//
// Tally runs one Chrome profile per client. The actual attribution signal is
// Chrome's "Name window" feature (right-click the tab strip → Name window),
// which writes into the OS window title ("Page Title - Acme Corp - Google
// Chrome") that aw-watcher-window captures — that's what lib/activitywatch's
// extractProfile reads back to attribute browser time to the right client.
// Chrome does NOT write a profile's *display name* into the window title (only
// into the profile picker avatar/label), and there is no public API/flag/file
// to set a window name programmatically — it's a one-time manual step the user
// performs after Tally creates and launches the profile. So this module (a)
// creates a dedicated profile per client, (b) best-effort cosmetically names it
// via `Local State` so Chrome's own profile picker looks right, and (c)
// launches Chrome into it.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "./types";

/** Locate chrome.exe: explicit override → common install paths → bare name. */
export function findChromeExe(): string | null {
  const override = process.env.TALLY_CHROME_PATH;
  if (override && fs.existsSync(override)) return override;

  const candidates = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
    process.env["LOCALAPPDATA"],
  ]
    .filter((base): base is string => !!base)
    .map((base) => path.join(base, "Google", "Chrome", "Application", "chrome.exe"));

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Last resort: rely on PATH at spawn time (low confidence, but lets a custom
  // install still work). Returns null only when we have nothing to try.
  return process.platform === "win32" ? "chrome.exe" : null;
}

/** Chrome's user-data dir (where `Local State` and profile dirs live). */
export function chromeUserDataDir(): string {
  const override = process.env.TALLY_CHROME_USER_DATA_DIR;
  if (override) return override;
  const localAppData =
    process.env["LOCALAPPDATA"] || path.join(process.env["USERPROFILE"] || "", "AppData", "Local");
  return path.join(localAppData, "Google", "Chrome", "User Data");
}

function localStatePath(): string {
  return path.join(chromeUserDataDir(), "Local State");
}

/** Deterministic, filesystem-safe --profile-directory for a client (stable across renames). */
export function profileDirForClient(client: Pick<Client, "id">): string {
  return `Tally-Client-${client.id}`;
}

/**
 * Sanitise a display name so it survives `extractProfile`'s parsing: strip the
 * separator characters titles are split on (- — |) and collapse whitespace, so
 * the profile is always a single clean trailing segment.
 */
export function sanitizeProfileName(name: string): string {
  return name.replace(/[-—|]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Best-effort cosmetic: set a profile's display name by editing Chrome's
 * `Local State` JSON, so Chrome's own profile picker shows the client's name
 * and avatar instead of "Person N". This is NOT the attribution mechanism —
 * Chrome never writes this name into the OS window title, so it's invisible
 * to aw-watcher-window/extractProfile. The real signal is the user naming the
 * Chrome window (see module doc comment); this function's failure is harmless.
 * Chrome must be CLOSED — a running Chrome owns this file in memory and
 * overwrites our edit on exit. We mark `is_using_default_name:false` so Chrome
 * keeps the name rather than regenerating "Person N". Every access is guarded
 * so an unexpected shape degrades to "skip naming, still launch" rather than
 * throwing.
 */
export function setProfileDisplayName(profileDir: string, displayName: string): void {
  const statePath = localStatePath();
  let state: Record<string, unknown> = {};
  try {
    if (fs.existsSync(statePath)) {
      state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
    }
  } catch {
    state = {}; // unreadable/corrupt — start fresh rather than fail provisioning
  }

  const profile = (state.profile && typeof state.profile === "object"
    ? (state.profile as Record<string, unknown>)
    : (state.profile = {} as Record<string, unknown>)) as Record<string, unknown>;

  const infoCache = (profile.info_cache && typeof profile.info_cache === "object"
    ? (profile.info_cache as Record<string, unknown>)
    : (profile.info_cache = {} as Record<string, unknown>)) as Record<string, unknown>;

  const entry = (infoCache[profileDir] && typeof infoCache[profileDir] === "object"
    ? (infoCache[profileDir] as Record<string, unknown>)
    : (infoCache[profileDir] = {} as Record<string, unknown>)) as Record<string, unknown>;

  entry.name = displayName;
  entry.shortcut_name = displayName;
  entry.is_using_default_name = false;

  profile.last_used = profileDir;
  const order = Array.isArray(profile.profiles_order)
    ? (profile.profiles_order as string[])
    : (profile.profiles_order = [] as string[]);
  if (!order.includes(profileDir)) order.push(profileDir);

  // Write atomically (temp file in the same dir → rename) so a crash mid-write
  // can't leave Chrome with a truncated Local State.
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tally-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, statePath);
}

/** Launch Chrome into a profile (detached so it outlives this process). */
export function launchChromeProfile(profileDir: string, url?: string): void {
  const exe = findChromeExe();
  if (!exe) throw new Error("Chrome not found");
  const args = [`--profile-directory=${profileDir}`];
  if (url) args.push(url);
  const child = spawn(exe, args, { detached: true, stdio: "ignore" });
  child.unref();
}
