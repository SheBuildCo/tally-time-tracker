// Orchestrates the AW → SQLite pipeline: fetch events, categorize by rules,
// apply manual-timer overrides, roll up, and persist. Past days are finalized
// once (cached); the current day is always re-fetched live.

import type {
  DailyActivityRow,
  SessionExclusion,
  SessionActivity,
  TimerSession
} from '../shared/types'
import * as db from './db'
import { fetchEvents } from './activitywatch'
import { categorizeAll, activityLabel } from './categorize'
import { applySessionOverrides, rollup } from './analytics'
import { localDayISO } from '../shared/format'

// Today's calendar day in the machine's LOCAL timezone. Days are bucketed
// locally (not UTC) so the dashboard's "today" and per-day rollups match the
// user's actual day — an evening-local session no longer files under tomorrow.
export function todayLocal(): string {
  return localDayISO()
}

// The earliest day we're allowed to ingest from ActivityWatch. Anything AW
// logged before the user started using Tally (or before their last "clear
// data" reset) is never pulled in, no matter how wide a range is requested.
function trackingStartDay(): string {
  const iso = db.getSetting('tracking_started_at')
  return localDayISO(iso ? new Date(iso) : new Date())
}

// Last N calendar days (local), oldest first, including today, clamped to the
// tracking-start floor.
export function dayStrings(days: number): string[] {
  const startFloor = trackingStartDay()
  const out: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    // Construct via local Y/M/D so month/day rollover is computed in local time.
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const day = localDayISO(d)
    if (day >= startFloor) out.push(day)
  }
  return out
}

// A local calendar day's [start, end) as UTC ISO instants, for the AW query.
// Local midnight → the next local midnight, expressed in UTC (AW stores UTC),
// so we fetch exactly the events the user experienced on that local day.
function dayBounds(day: string): [string, string] {
  const [y, m, d] = day.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return [start.toISOString(), end.toISOString()]
}

function exclusionMap(sessions: TimerSession[]): Map<number, SessionExclusion[]> {
  const map = new Map<number, SessionExclusion[]>()
  for (const s of sessions) map.set(s.id, db.listExclusions(s.id))
  return map
}

// Fetch + categorize + override + rollup a single day. Returns the rows and
// persists them. Does not finalize (caller decides).
async function computeDay(day: string): Promise<DailyActivityRow[]> {
  const [start, end] = dayBounds(day)
  const events = await fetchEvents(start, end)
  const rules = db.listRules()
  let categorized = categorizeAll(events, rules)

  const sessions = db.getSessionsInRange(start, end)
  if (sessions.length > 0) {
    categorized = applySessionOverrides(categorized, sessions, exclusionMap(sessions))
  }

  const rows = rollup(categorized, day)
  db.replaceDayActivity(day, rows)
  return rows
}

// Get rolled-up rows for a range of days. Finalized past days come straight
// from the cache; today (and any not-yet-finalized past day) is recomputed.
// Days before the tracking-start floor are never included.
export async function getRangeRows(days: number): Promise<DailyActivityRow[]> {
  const wanted = dayStrings(days)
  const today = todayLocal()
  const out: DailyActivityRow[] = []

  for (const day of wanted) {
    const isPast = day < today
    if (isPast && db.isDayFinalized(day)) {
      out.push(...db.getDayActivity(day))
      continue
    }
    try {
      const rows = await computeDay(day)
      out.push(...rows)
      // Finalize past days once we've successfully pulled them from AW.
      if (isPast && rows.length > 0) db.markDayFinalized(day)
    } catch {
      // AW offline or query failed — fall back to whatever we cached.
      out.push(...db.getDayActivity(day))
    }
  }
  return out
}

// Invalidate cached rollups for the day(s) a session touches, so the next
// analytics read recomputes with the latest session/exclusion state.
export function invalidateSession(session: TimerSession): void {
  const start = session.startTime.slice(0, 10)
  const end = (session.endTime ?? new Date().toISOString()).slice(0, 10)
  let cursor = new Date(`${start}T00:00:00.000Z`)
  const last = new Date(`${end}T00:00:00.000Z`)
  while (cursor <= last) {
    db.unfinalizeDay(cursor.toISOString().slice(0, 10))
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  }
}

// Live-query AW for [start, end) and group into per-(app, activity, host)
// totals. Shared by the live "still running" preview, the one-time snapshot
// capture at stop time, and the backfill fallback for older sessions.
async function fetchAndGroupActivities(
  start: string,
  end: string
): Promise<{ app: string; host: string; activity: string; seconds: number }[]> {
  const events = await fetchEvents(start, end)
  const map = new Map<string, { app: string; host: string; activity: string; seconds: number }>()
  for (const e of events) {
    const activity = activityLabel(e)
    const key = `${e.app}|${activity}|${e.host}`
    const existing = map.get(key)
    if (existing) {
      existing.seconds += e.duration
    } else {
      map.set(key, { app: e.app, host: e.host, activity, seconds: e.duration })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds)
}

function annotateWithExclusions(
  rows: { app: string; host: string; activity: string; seconds: number }[],
  exclusions: SessionExclusion[]
): SessionActivity[] {
  return rows.map((r) => {
    const ex = exclusions.find((x) => x.app === r.app && x.host === r.host && x.activity === r.activity)
    return { ...r, excluded: !!ex, exclusionId: ex?.id ?? null }
  })
}

// Captures the permanent, immutable record of what a session contained. Called
// once when the timer stops. If it fails (AW offline, transient error), the
// session simply has no snapshot yet and getSessionActivities() will fall back
// to a live query and backfill it opportunistically on next read.
export async function captureSessionSnapshot(session: TimerSession): Promise<void> {
  if (!session.endTime) return
  const rows = await fetchAndGroupActivities(session.startTime, session.endTime)
  if (rows.length > 0) db.saveSessionSnapshot(session.id, rows)
}

// Activities that fell inside a session's window, annotated with whether the
// user has excluded each one. Completed sessions read from the immutable
// snapshot captured at stop time; a still-running session gets a live preview.
export async function getSessionActivities(sessionId: number): Promise<SessionActivity[]> {
  const session = db.getSession(sessionId)
  if (!session) return []
  const exclusions = db.listExclusions(sessionId)

  if (session.endTime) {
    const snapshot = db.getSessionSnapshot(sessionId)
    if (snapshot.length > 0) {
      return annotateWithExclusions(snapshot, exclusions)
    }
    // No snapshot yet (older session from before this existed, or capture
    // failed) — query live once and backfill so future reads are stable.
    const rows = await fetchAndGroupActivities(session.startTime, session.endTime)
    if (rows.length > 0) db.saveSessionSnapshot(sessionId, rows)
    return annotateWithExclusions(rows, exclusions)
  }

  // Still running: live preview, recomputed every time.
  const rows = await fetchAndGroupActivities(session.startTime, new Date().toISOString())
  return annotateWithExclusions(rows, exclusions)
}
