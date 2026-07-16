// Ingestion & rollup for the shared/central model.
//
// Each employee's machine runs a push agent that reads its OWN local
// ActivityWatch and POSTs the raw events here (see app/api/ingest). The server
// stores those raw events per (person, day) as the source of truth and derives
// the per-person `daily_activity` rollup from them — so the dashboard reads,
// and "re-sync with current rules", never depend on reaching anyone's local AW.
//
// "Days" here are UTC days (matching analytics' `timestamp.slice(0,10)`
// grouping), keeping persistence and aggregation consistent.

import { activityLabel, appLabel, categorizeAll, cleanTitle, hostOf } from "./categorize";
import {
  getActivityRows,
  getPushedEvents,
  listPushedDays,
  listRules,
  replaceDayActivity,
  storePushedEvents,
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

/** Roll up one person's categorized events for a day into storage rows. */
export function rollup(
  personId: number,
  categorized: Categorized[],
): DailyActivityRow[] {
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
      { personId, day, clientId, app, activity, host, profile, billable, unassigned, seconds: 0 };
    row.seconds += c.event.duration;
    agg.set(key, row);
  }
  return [...agg.values()];
}

/**
 * Reconstruct categorized events from stored rollup rows so the existing
 * analytics functions (buildSummary/buildClientDetail/buildDailyTotals) work
 * unchanged on persisted history. One synthetic event per row. Person scoping
 * happens at the DB query (getActivityRows), so analytics stays person-agnostic
 * and simply sums whatever rows it's given (the whole team, or one person).
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
 * Ingest a push: persist a person's raw events for a day (the source), then
 * categorize with the shared rules, roll up and store. Returns the stored rows.
 */
export function ingestPushedEvents(
  personId: number,
  day: string,
  events: UsageEvent[],
): DailyActivityRow[] {
  storePushedEvents(personId, day, JSON.stringify(events), new Date().toISOString());
  const categorized = categorizeAll(events, listRules());
  const rows = rollup(personId, categorized);
  replaceDayActivity(personId, day, rows);
  return rows;
}

export interface RangeIngest {
  rows: DailyActivityRow[];
  trackerAvailable: boolean;
}

/**
 * Stored rollup rows for the last `days` days. Omit `personId` for the whole
 * team (the recap view); pass it to scope to one person. `trackerAvailable` is
 * always true here — the central server has no local AW of its own; capture
 * freshness is a per-machine concern surfaced elsewhere.
 */
export function getRangeRows(days: number, personId?: number): RangeIngest {
  const wanted = dayStrings(days);
  const rows = getActivityRows(wanted[0], wanted[wanted.length - 1], personId);
  return { rows, trackerAvailable: true };
}

/** Stored rows for a single (possibly historical) day, optionally one person. */
export function ensureDayRows(day: string, personId?: number): RangeIngest {
  return { rows: getActivityRows(day, day, personId), trackerAvailable: true };
}

/**
 * Re-apply the *current* rules across everyone's stored raw events in the range
 * (the recap person's "Re-sync with current rules"). Recomputes each affected
 * (person, day) rollup from the persisted source — no local AW needed.
 */
export function resyncRange(days: number): RangeIngest {
  const wanted = dayStrings(days);
  const start = wanted[0];
  const end = wanted[wanted.length - 1];
  const rules = listRules();
  for (const { personId, day } of listPushedDays(start, end)) {
    const json = getPushedEvents(personId, day);
    if (!json) continue;
    const events = JSON.parse(json) as UsageEvent[];
    const categorized = categorizeAll(events, rules);
    replaceDayActivity(personId, day, rollup(personId, categorized));
  }
  return { rows: getActivityRows(start, end), trackerAvailable: true };
}

// Re-exported so callers (and tests) can build labels consistently.
export { appLabel, cleanTitle };
