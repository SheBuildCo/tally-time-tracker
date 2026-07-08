// Pure aggregation + the manual-timer override logic. No I/O here so this is
// easy to unit-test.

import type {
  Categorized,
  DailyActivityRow,
  TimerSession,
  SessionExclusion,
  Client,
  ClientSummary,
  DailyTotal,
  RangeSummary
} from '../shared/types'
import { activityLabel } from './categorize'

// ---- Session overrides ----
//
// The heart of the new Tally: any activity that happened inside a manual timer
// session is reassigned to that session's client, regardless of what the rules
// said — unless the user explicitly excluded that (app, host, activity) from
// the session. Operates at the event level (events carry timestamps; rolled-up
// rows do not), so this must run before rollup().

function eventInSession(cat: Categorized, session: TimerSession): boolean {
  const t = Date.parse(cat.event.timestamp)
  const mid = t + (cat.event.duration * 1000) / 2 // use slice midpoint
  const start = Date.parse(session.startTime)
  const end = session.endTime ? Date.parse(session.endTime) : Date.now()
  return mid >= start && mid <= end
}

export function applySessionOverrides(
  categorized: Categorized[],
  sessions: TimerSession[],
  exclusionsBySession: Map<number, SessionExclusion[]>
): Categorized[] {
  if (sessions.length === 0) return categorized

  return categorized.map((cat) => {
    // Latest-starting session that contains this event wins (handles the user
    // switching clients mid-stream).
    const containing = sessions
      .filter((s) => eventInSession(cat, s))
      .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0]

    if (!containing) return cat

    const label = activityLabel(cat.event)
    const excluded = (exclusionsBySession.get(containing.id) ?? []).some(
      (ex) =>
        ex.app === cat.event.app && ex.host === cat.event.host && ex.activity === label
    )
    if (excluded) return cat // falls back to rule-based categorization

    return {
      ...cat,
      clientId: containing.clientId,
      billable: true,
      matchedRuleId: null
    }
  })
}

// ---- Rollup ----

export function rollup(categorized: Categorized[], day: string): DailyActivityRow[] {
  const map = new Map<string, DailyActivityRow>()
  for (const c of categorized) {
    const activity = activityLabel(c.event)
    const host = c.event.host
    const key = `${c.clientId}|${c.event.app}|${activity}|${host}|${c.billable}`
    const existing = map.get(key)
    if (existing) {
      existing.seconds += c.event.duration
    } else {
      map.set(key, {
        day,
        clientId: c.clientId,
        app: c.event.app,
        activity,
        host,
        billable: c.billable,
        seconds: c.event.duration
      })
    }
  }
  return Array.from(map.values())
}

// ---- Summaries ----

export function buildRangeSummary(
  rows: DailyActivityRow[],
  clients: Client[],
  days: number
): RangeSummary {
  const clientById = new Map(clients.map((c) => [c.id, c]))

  // Per-client aggregation.
  const summaryMap = new Map<number | null, ClientSummary>()
  for (const row of rows) {
    const key = row.clientId
    let s = summaryMap.get(key)
    if (!s) {
      const client = key != null ? clientById.get(key) : undefined
      s = {
        clientId: key,
        clientName: client?.name ?? 'Unassigned',
        color: client?.color ?? '#94a3b8',
        seconds: 0,
        billableSeconds: 0,
        amount: 0
      }
      summaryMap.set(key, s)
    }
    s.seconds += row.seconds
    if (row.billable) s.billableSeconds += row.seconds
  }
  for (const s of summaryMap.values()) {
    const rate = s.clientId != null ? (clientById.get(s.clientId)?.billableRate ?? 0) : 0
    s.amount = (s.billableSeconds / 3600) * rate
  }

  // Per-day aggregation.
  const dayMap = new Map<string, DailyTotal>()
  for (const row of rows) {
    let d = dayMap.get(row.day)
    if (!d) {
      d = { day: row.day, seconds: 0, byClient: [] }
      dayMap.set(row.day, d)
    }
    d.seconds += row.seconds
    const existing = d.byClient.find((b) => b.clientId === row.clientId)
    if (existing) existing.seconds += row.seconds
    else d.byClient.push({ clientId: row.clientId, seconds: row.seconds })
  }

  const clientsSorted = Array.from(summaryMap.values()).sort((a, b) => b.seconds - a.seconds)
  const daily = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day))

  return {
    days,
    totalSeconds: rows.reduce((sum, r) => sum + r.seconds, 0),
    billableSeconds: rows.reduce((sum, r) => sum + (r.billable ? r.seconds : 0), 0),
    clients: clientsSorted,
    daily
  }
}
