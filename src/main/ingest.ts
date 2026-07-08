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

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

// Last N calendar days (UTC), oldest first, including today.
export function dayStrings(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function dayBounds(day: string): [string, string] {
  const start = `${day}T00:00:00.000Z`
  const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString()
  return [start, end]
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
export async function getRangeRows(days: number): Promise<DailyActivityRow[]> {
  const wanted = dayStrings(days)
  const today = todayUTC()
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

// Activities that fell inside a session's window, grouped and annotated with
// whether the user has excluded each one. Read live from AW so the detail view
// reflects the true window even for days that were finalized under old rules.
export async function getSessionActivities(sessionId: number): Promise<SessionActivity[]> {
  const session = db.getSession(sessionId)
  if (!session) return []
  const start = session.startTime
  const end = session.endTime ?? new Date().toISOString()

  const events = await fetchEvents(start, end)
  const exclusions = db.listExclusions(sessionId)

  const map = new Map<string, SessionActivity>()
  for (const e of events) {
    const activity = activityLabel(e)
    const key = `${e.app}|${activity}|${e.host}`
    const ex = exclusions.find(
      (x) => x.app === e.app && x.host === e.host && x.activity === activity
    )
    const existing = map.get(key)
    if (existing) {
      existing.seconds += e.duration
    } else {
      map.set(key, {
        app: e.app,
        host: e.host,
        activity,
        seconds: e.duration,
        excluded: !!ex,
        exclusionId: ex?.id ?? null
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds)
}
