// Ingestion: snapshot ActivityWatch usage into the local rollup tables so history
// persists and renders without AW running. The current (UTC) day is always
// recomputed live; past days are ingested once and marked finalized.
//
// "Days" here are UTC days (matching analytics' `timestamp.slice(0,10)` grouping),
// keeping persistence and aggregation consistent.

import {
  getUsageEvents,
  ActivityWatchError,
  type DateRange,
} from "./activitywatch";
import { activityLabel, appLabel, categorizeAll, cleanTitle, hostOf } from "./categorize";
import {
  getActivityRows,
  isFinalized,
  listRules,
  markFinalized,
  replaceDayActivity,
  type DailyActivityRow,
} from "./db";
import type { Categorized, UsageEvent } from "./types";

/** Today's UTC day string (YYYY-MM-DD). */
export function todayUTC(now: Date = nowDate()): string {
  return now.toISOString().slice(0, 10);
}

// Date.now()/new Date() with no args are unavailable in some sandboxes; this
// indirection keeps a single seam we can override in tests.
function nowDate(): Date {
  return new Date();
}

/** Inclusive list of UTC day strings ending today, going back `days` days. */
export function dayStrings(days: number, end: string = todayUTC()): string[] {
  const out: string[] = [];
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(endMs - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** The [start, end) UTC range covering a single day. */
function dayRange(day: string): DateRange {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

/** Roll up categorized events for one day into storage rows. */
export function rollup(categorized: Categorized[]): DailyActivityRow[] {
  const agg = new Map<string, DailyActivityRow>();
  for (const c of categorized) {
    const day = c.event.timestamp.slice(0, 10);
    const app = c.event.app;
    const activity = activityLabel(c.event);
    const host = hostOf(c.event.url);
    const profile = c.event.profile ?? "";
    const billable = c.billable;
    const unassigned = c.matchedRuleId === null;
    const clientId = c.clientId;
    const key = `${day}|${clientId ?? "n"}|${app}|${activity}|${host}|${profile}|${
      billable ? 1 : 0
    }|${unassigned ? 1 : 0}`;
    const row =
      agg.get(key) ??
      { day, clientId, app, activity, host, profile, billable, unassigned, seconds: 0 };
    row.seconds += c.event.duration;
    agg.set(key, row);
  }
  return [...agg.values()];
}

/**
 * Reconstruct categorized events from stored rollup rows so the existing
 * analytics functions (buildSummary/buildClientDetail/buildDailyTotals) work
 * unchanged on persisted history. One synthetic event per row.
 */
export function rowsToCategorized(rows: DailyActivityRow[]): Categorized[] {
  return rows.map((r) => {
    const event: UsageEvent = {
      app: r.app,
      title: r.activity,
      url: r.host || undefined,
      profile: r.profile || undefined,
      duration: r.seconds,
      timestamp: `${r.day}T12:00:00.000Z`,
    };
    return {
      event,
      clientId: r.clientId,
      project: null,
      billable: r.billable,
      matchedRuleId: r.unassigned ? null : 1,
    };
  });
}

/**
 * Ingest a single day from ActivityWatch: fetch, categorize with current rules,
 * roll up and store. Past days are marked finalized. Returns the stored rows.
 * Throws ActivityWatchError if AW can't be reached.
 */
export async function ingestDay(day: string): Promise<DailyActivityRow[]> {
  const events = await getUsageEvents(dayRange(day));
  const categorized = categorizeAll(events, listRules());
  const rows = rollup(categorized);
  replaceDayActivity(day, rows);
  if (day < todayUTC()) markFinalized(day, new Date().toISOString());
  return rows;
}

export interface RangeIngest {
  rows: DailyActivityRow[];
  trackerAvailable: boolean;
}

/**
 * Get categorized usage for the last `days` days, serving finalized past days
 * from storage and (re)ingesting the current day plus any not-yet-finalized
 * days live. If AW is unreachable, fall back to whatever is stored and report
 * `trackerAvailable: false` so the UI can still show history.
 */
export async function getRangeRows(days: number): Promise<RangeIngest> {
  const today = todayUTC();
  const wanted = dayStrings(days, today);
  let trackerAvailable = true;

  for (const day of wanted) {
    const isPast = day < today;
    if (isPast && isFinalized(day)) continue; // already persisted
    try {
      await ingestDay(day);
    } catch (err) {
      if (err instanceof ActivityWatchError) {
        trackerAvailable = false;
        break; // AW down — stop trying, use stored data
      }
      throw err;
    }
  }

  const rows = getActivityRows(wanted[0], wanted[wanted.length - 1]);
  return { rows, trackerAvailable };
}

/**
 * Ensure a single (possibly historical) day is available, ingesting it live
 * unless it's a finalized past day. Returns that day's stored rows.
 */
export async function ensureDayRows(day: string): Promise<RangeIngest> {
  const today = todayUTC();
  let trackerAvailable = true;
  if (!(day < today && isFinalized(day))) {
    try {
      await ingestDay(day);
    } catch (err) {
      if (err instanceof ActivityWatchError) trackerAvailable = false;
      else throw err;
    }
  }
  return { rows: getActivityRows(day, day), trackerAvailable };
}

/** Re-ingest a range applying the *current* rules (used after rules change). */
export async function resyncRange(days: number): Promise<RangeIngest> {
  const today = todayUTC();
  const wanted = dayStrings(days, today);
  let trackerAvailable = true;
  for (const day of wanted) {
    try {
      await ingestDay(day); // ingestDay always replaces the day's rows
    } catch (err) {
      if (err instanceof ActivityWatchError) {
        trackerAvailable = false;
        break;
      }
      throw err;
    }
  }
  const rows = getActivityRows(wanted[0], wanted[wanted.length - 1]);
  return { rows, trackerAvailable };
}

// Re-exported so callers (and tests) can build labels consistently.
export { appLabel, cleanTitle };
