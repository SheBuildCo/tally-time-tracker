// Thin read-only client over the local ActivityWatch REST API.
//
// ActivityWatch runs a local server (default http://localhost:5600) and exposes
// a query engine (AQL) over POST /api/0/query/. We never write to it — Tally is
// purely a consumer of the autonomously-captured data.

import type { AWBucket, AWEvent, UsageEvent } from "./types";

const AW_BASE_URL =
  process.env.AW_BASE_URL?.replace(/\/$/, "") || "http://localhost:5600";

export class ActivityWatchError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ActivityWatchError";
  }
}

async function awFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AW_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      // Always read fresh data from the local tracker.
      cache: "no-store",
    });
  } catch (err) {
    throw new ActivityWatchError(
      `Could not reach ActivityWatch at ${AW_BASE_URL}. Is it running?`,
      err,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ActivityWatchError(
      `ActivityWatch returned ${res.status} for ${path}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** True if the local ActivityWatch server is reachable. */
export async function isAvailable(): Promise<boolean> {
  try {
    await awFetch("/api/0/info");
    return true;
  } catch {
    return false;
  }
}

/** List all buckets keyed by bucket id. */
export async function getBuckets(): Promise<Record<string, AWBucket>> {
  return awFetch<Record<string, AWBucket>>("/api/0/buckets/");
}

/** Find the first bucket id whose id starts with `prefix` (e.g. per-host buckets). */
function findBucketId(
  buckets: Record<string, AWBucket>,
  prefix: string,
): string | undefined {
  return Object.keys(buckets).find((id) => id.startsWith(prefix));
}

/** Format a Date as the local YYYY-MM-DD used to build AW timeperiods. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DateRange {
  /** inclusive start (local day boundary applied by AW) */
  start: Date;
  /** exclusive end */
  end: Date;
}

/** Build the AW timeperiod string "start/end" from a range. */
function timeperiod(range: DateRange): string {
  return `${range.start.toISOString()}/${range.end.toISOString()}`;
}

/**
 * Run an AQL query for a single timeperiod and return the `RETURN` value.
 * The query is an array of statement strings (AW joins them with newlines).
 */
async function query<T>(statements: string[], range: DateRange): Promise<T> {
  const result = await awFetch<T[]>("/api/0/query/", {
    method: "POST",
    body: JSON.stringify({
      timeperiods: [timeperiod(range)],
      query: [statements.join("\n")],
    }),
  });
  // One timeperiod in => one result out.
  return result[0];
}

/**
 * Fetch normalised *active* usage for a date range.
 *
 * Strategy (mirrors the ActivityWatch default "Activity" view):
 *  1. Take window-watcher events and intersect them with non-AFK periods so
 *     idle time is excluded.
 *  2. Separately take browser-watcher events (active tab URL+title) and
 *     intersect them with the *active browser window* periods, so a URL is only
 *     counted while that browser was actually focused and the user present.
 *  3. Return both streams; we stitch the URL onto browser window slices in JS
 *     to keep the query simple and robust across AW versions.
 */
export async function getUsageEvents(range: DateRange): Promise<UsageEvent[]> {
  const buckets = await getBuckets();
  const windowBucket = findBucketId(buckets, "aw-watcher-window_");
  const afkBucket = findBucketId(buckets, "aw-watcher-afk_");

  if (!windowBucket) {
    throw new ActivityWatchError(
      "No window watcher bucket found. Is aw-watcher-window running?",
    );
  }

  // Browser buckets are named aw-watcher-web-<browser> (chrome/edge/firefox...).
  const browserBuckets = Object.keys(buckets).filter((id) =>
    id.startsWith("aw-watcher-web"),
  );

  // 1. Active window events (window ∩ not-afk), merged per (app, title).
  const windowStatements: string[] = [
    `window = flood(query_bucket("${windowBucket}"));`,
  ];
  if (afkBucket) {
    windowStatements.push(
      `afk = flood(query_bucket("${afkBucket}"));`,
      `afk = filter_keyvals(afk, "status", ["not-afk"]);`,
      `window = filter_period_intersect(window, afk);`,
    );
  }
  windowStatements.push(
    `window = merge_events_by_keys(window, ["app", "title"]);`,
    `RETURN = sort_by_timestamp(window);`,
  );
  const windowEvents = await query<AWEvent[]>(windowStatements, range);

  // 2. Browser events (active tab) intersected with active-browser windows.
  const browserEvents: AWEvent[] = [];
  for (const bb of browserBuckets) {
    const statements: string[] = [
      `events = flood(query_bucket("${bb}"));`,
    ];
    if (afkBucket) {
      statements.push(
        `afk = flood(query_bucket("${afkBucket}"));`,
        `afk = filter_keyvals(afk, "status", ["not-afk"]);`,
        `events = filter_period_intersect(events, afk);`,
      );
    }
    statements.push(
      `events = merge_events_by_keys(events, ["url", "title"]);`,
      `RETURN = sort_by_timestamp(events);`,
    );
    try {
      const evs = await query<AWEvent[]>(statements, range);
      browserEvents.push(...evs);
    } catch {
      // A browser bucket may be empty/unsupported; skip it gracefully.
    }
  }

  return stitchUsage(windowEvents, browserEvents, knownBrowserApps(buckets));
}

/** App/exe names that correspond to tracked browsers, derived from bucket ids. */
function knownBrowserApps(buckets: Record<string, AWBucket>): Set<string> {
  // Map common browser keys to their Windows executable names.
  const map: Record<string, string[]> = {
    chrome: ["chrome.exe", "google chrome"],
    edge: ["msedge.exe", "microsoft edge"],
    firefox: ["firefox.exe", "firefox"],
    brave: ["brave.exe", "brave"],
    opera: ["opera.exe", "opera"],
    vivaldi: ["vivaldi.exe", "vivaldi"],
    comet: ["comet.exe", "comet"],
    arc: ["arc.exe", "arc"],
  };
  const apps = new Set<string>();
  for (const id of Object.keys(buckets)) {
    for (const [key, names] of Object.entries(map)) {
      if (id.includes(key)) names.forEach((n) => apps.add(n.toLowerCase()));
    }
  }
  // Always include the obvious ones so URL stitching works even if the bucket
  // id doesn't embed the browser name.
  ["chrome.exe", "msedge.exe", "firefox.exe"].forEach((n) => apps.add(n));
  return apps;
}

/**
 * Convert AW events into UsageEvent[], attaching the most likely browser URL to
 * each browser window slice. Browser slices are matched to web events by time
 * overlap; non-browser slices pass through unchanged.
 */
export function stitchUsage(
  windowEvents: AWEvent[],
  browserEvents: AWEvent[],
  browserApps: Set<string>,
): UsageEvent[] {
  const webByStart = browserEvents
    .map((e) => ({
      start: Date.parse(e.timestamp),
      end: Date.parse(e.timestamp) + e.duration * 1000,
      url: String(e.data.url ?? ""),
      title: String(e.data.title ?? ""),
    }))
    .sort((a, b) => a.start - b.start);

  return windowEvents.map((e) => {
    const app = String(e.data.app ?? "unknown");
    const title = String(e.data.title ?? "");
    const out: UsageEvent = {
      app,
      title,
      duration: e.duration,
      timestamp: e.timestamp,
    };
    if (browserApps.has(app.toLowerCase())) {
      const start = Date.parse(e.timestamp);
      const end = start + e.duration * 1000;
      const match = bestOverlap(webByStart, start, end);
      if (match) out.url = match.url;
    }
    return out;
  });
}

/** Pick the web event with the greatest temporal overlap with [start,end). */
function bestOverlap(
  web: { start: number; end: number; url: string; title: string }[],
  start: number,
  end: number,
): { url: string; title: string } | undefined {
  let best: { url: string; title: string } | undefined;
  let bestOverlapMs = 0;
  for (const w of web) {
    if (w.end <= start) continue;
    if (w.start >= end) break; // sorted by start; nothing later can overlap less
    const overlap = Math.min(end, w.end) - Math.max(start, w.start);
    if (overlap > bestOverlapMs) {
      bestOverlapMs = overlap;
      best = { url: w.url, title: w.title };
    }
  }
  return best;
}

/** Convenience: a range covering the last `days` days up to now. */
export function lastNDays(days: number): DateRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export { AW_BASE_URL, isoDay };
