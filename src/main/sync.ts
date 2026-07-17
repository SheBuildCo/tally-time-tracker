// Push this machine's tracked time to the shared team database, and read the
// team-wide view back.
//
// Design: local SQLite stays the source of truth for THIS person's time. Sync is
// one-way for activity (local -> shared) and additive for clients (each machine
// contributes its client list by name). Nothing here is on the critical path of
// tracking: if the network or the database is down, sync fails, logs, and the
// app keeps recording locally. The next successful sync catches up, because
// every write is an upsert keyed on stable values rather than an append.
//
// WHY CLIENTS ARE MATCHED BY NAME: client ids are per-machine autoincrement
// (Oli's "MAAS Constructions" is 6 locally but 1 in the shared database), so
// local ids are meaningless to the team. Names are the only stable identity, so
// every push translates local id -> shared id via name. This keeps each
// machine's local database completely untouched by syncing.

import * as db from './db'
import { connect, ensurePersonId, friendlyError, getPersonName, isConfigured } from './supabase'
import type { ClientSummary, DailyTotal, TeamMemberSummary, TeamSummary } from '../shared/types'
import type postgres from 'postgres'

/** The shared schema's sentinel for "no client" (Postgres PKs reject NULL). */
const NO_CLIENT = -1

/** Trailing days pushed on each sync. Recent days are the ones that change. */
const SYNC_DAYS = 7

export interface SyncResult {
  ok: boolean
  message: string
  pushedDays?: number
  pushedRows?: number
  pushedSessions?: number
  at: string
}

let syncing = false
let lastResult: SyncResult | null = null

export function getLastSyncResult(): SyncResult | null {
  return lastResult
}

/** Inclusive list of UTC day strings ending today. Mirrors ingest.ts's shape. */
function recentDays(days: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Push local clients into the shared database and return a local id -> shared id
 * map. Clients are additive: we never delete a shared client, because another
 * teammate may still be booking time against it.
 */
async function pushClients(sql: postgres.Sql): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  for (const c of db.listClients()) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO clients (name, billable_rate, color)
      VALUES (${c.name}, ${c.billableRate}, ${c.color})
      ON CONFLICT (name) DO UPDATE SET
        billable_rate = excluded.billable_rate, color = excluded.color
      RETURNING id
    `
    map.set(c.id, row.id)
  }
  return map
}

/** Rows per INSERT. Big enough to be fast, small enough to stay under limits. */
const BATCH = 500

interface ActivityInsert {
  person_id: number
  day: string
  client_id: number
  app: string
  activity: string
  host: string
  billable: boolean
  seconds: number
}

/**
 * Translate one local day's rows into shared-schema rows.
 *
 * Two things happen here that a naive mapping gets wrong:
 *  - local NULL client_id becomes the -1 sentinel; and
 *  - rows are re-keyed and SUMMED afterwards, because SQLite treats NULLs in a
 *    primary key as distinct while Postgres does not. Two local rows that
 *    differ only by a NULL client would collide on insert; summing them
 *    preserves the time instead of dropping half of it.
 */
export function toSharedRows(
  personId: number,
  day: string,
  local: { clientId: number | null; app: string; activity: string; host: string; billable: boolean; seconds: number }[],
  clientMap: Map<number, number>
): ActivityInsert[] {
  const merged = new Map<string, ActivityInsert>()
  for (const r of local) {
    const client_id = r.clientId == null ? NO_CLIENT : (clientMap.get(r.clientId) ?? NO_CLIENT)
    const key = `${client_id}|${r.app}|${r.activity}|${r.host}`
    const existing = merged.get(key)
    if (existing) {
      existing.seconds += Math.round(r.seconds)
      existing.billable = existing.billable || r.billable
    } else {
      merged.set(key, {
        person_id: personId,
        day,
        client_id,
        app: r.app,
        activity: r.activity,
        host: r.host,
        billable: r.billable,
        seconds: Math.round(r.seconds)
      })
    }
  }
  return [...merged.values()]
}

/**
 * Replace this person's rollup for each day in the window. Scoped to
 * (person_id, day) so one teammate's sync never touches another's rows.
 *
 * Inserts are batched: a day can hold hundreds of rows, and one round-trip per
 * row made a sync take minutes and get cut short on quit, leaving the shared
 * copy half-written.
 */
async function pushActivity(
  sql: postgres.Sql,
  personId: number,
  clientMap: Map<number, number>,
  days: string[]
): Promise<number> {
  let count = 0
  for (const day of days) {
    const rows = toSharedRows(personId, day, db.getDayActivity(day), clientMap)
    await sql.begin(async (tx) => {
      await tx`DELETE FROM daily_activity WHERE person_id = ${personId} AND day = ${day}`
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        await tx`INSERT INTO daily_activity ${tx(
          chunk,
          'person_id',
          'day',
          'client_id',
          'app',
          'activity',
          'host',
          'billable',
          'seconds'
        )}`
        count += chunk.length
      }
    })
  }
  return count
}

/**
 * Push timer sessions that start within the window, plus their snapshots and
 * exclusions. A session is identified team-side by (person, start_time): local
 * ids can't be reused because the shared table has its own sequence.
 */
async function pushSessions(
  sql: postgres.Sql,
  personId: number,
  clientMap: Map<number, number>,
  days: string[]
): Promise<number> {
  const startISO = `${days[0]}T00:00:00.000Z`
  const endISO = `${days[days.length - 1]}T23:59:59.999Z`
  const sessions = db.getSessionsInRange(startISO, endISO)

  let pushed = 0
  for (const s of sessions) {
    const sharedClient = clientMap.get(s.clientId)
    if (!sharedClient) continue // client vanished locally; skip rather than guess

    const existing = await sql<{ id: number }[]>`
      SELECT id FROM timer_sessions WHERE person_id = ${personId} AND start_time = ${s.startTime}
    `
    let sid: number
    if (existing.length > 0) {
      sid = existing[0].id
      await sql`
        UPDATE timer_sessions
        SET client_id = ${sharedClient}, end_time = ${s.endTime}, notes = ${s.notes ?? null}
        WHERE id = ${sid}
      `
    } else {
      const [ins] = await sql<{ id: number }[]>`
        INSERT INTO timer_sessions (person_id, client_id, start_time, end_time, notes)
        VALUES (${personId}, ${sharedClient}, ${s.startTime}, ${s.endTime}, ${s.notes ?? null})
        RETURNING id
      `
      sid = ins.id
    }

    // Children are small and immutable-ish; replacing beats diffing. Batched
    // for the same reason as the activity rows above.
    await sql`DELETE FROM session_activity_snapshot WHERE session_id = ${sid}`
    const snaps = db.getSessionSnapshot(s.id).map((row) => ({
      session_id: sid,
      app: row.app,
      host: row.host,
      activity: row.activity,
      seconds: Math.round(row.seconds)
    }))
    for (let i = 0; i < snaps.length; i += BATCH) {
      await sql`INSERT INTO session_activity_snapshot ${sql(
        snaps.slice(i, i + BATCH),
        'session_id',
        'app',
        'host',
        'activity',
        'seconds'
      )}`
    }

    await sql`DELETE FROM session_exclusions WHERE session_id = ${sid}`
    const exclusions = db.listExclusions(s.id).map((ex) => ({
      session_id: sid,
      app: ex.app,
      host: ex.host,
      activity: ex.activity
    }))
    if (exclusions.length > 0) {
      await sql`INSERT INTO session_exclusions ${sql(exclusions, 'session_id', 'app', 'host', 'activity')}`
    }
    pushed++
  }
  return pushed
}

/**
 * Push the recent window to the shared database. Safe to call often: it's a
 * no-op when unconfigured, and never throws — tracking must not depend on it.
 */
export async function syncNow(days = SYNC_DAYS): Promise<SyncResult> {
  const at = new Date().toISOString()
  if (!isConfigured()) {
    return (lastResult = { ok: false, message: 'Team sync is not set up yet.', at })
  }
  if (syncing) {
    return lastResult ?? { ok: false, message: 'A sync is already running.', at }
  }

  syncing = true
  try {
    const sql = connect()
    const person = getPersonName()
    if (!sql || !person) {
      return (lastResult = { ok: false, message: 'Team sync is not set up yet.', at })
    }

    const personId = await ensurePersonId(sql, person)
    const clientMap = await pushClients(sql)
    const window = recentDays(days)
    const pushedRows = await pushActivity(sql, personId, clientMap, window)
    const pushedSessions = await pushSessions(sql, personId, clientMap, window)

    return (lastResult = {
      ok: true,
      message: `Synced ${pushedRows} activities and ${pushedSessions} sessions across ${window.length} days.`,
      pushedDays: window.length,
      pushedRows,
      pushedSessions,
      at: new Date().toISOString()
    })
  } catch (err) {
    console.error('[sync] push failed:', err)
    return (lastResult = { ok: false, message: friendlyError(err), at: new Date().toISOString() })
  } finally {
    syncing = false
  }
}

// ---- Team view ----

/**
 * Team-wide summary for the last `days` days, mirroring the shape the local
 * dashboard already renders (RangeSummary) plus a per-person breakdown.
 * Aggregation happens in Postgres — the team's rows are not worth shipping over
 * the wire just to sum them here.
 */
export async function fetchTeamSummary(days: number): Promise<TeamSummary> {
  const sql = connect()
  if (!sql) throw new Error('Team sync is not set up yet.')

  const window = recentDays(days)
  const start = window[0]
  const end = window[window.length - 1]

  const rows = await sql<
    {
      person: string
      client_id: number
      client_name: string | null
      color: string | null
      billable_rate: number | null
      day: string
      seconds: number
      billable_seconds: number
    }[]
  >`
    SELECT p.name AS person,
           d.client_id,
           c.name  AS client_name,
           c.color AS color,
           c.billable_rate,
           d.day,
           SUM(d.seconds)::int AS seconds,
           SUM(CASE WHEN d.billable THEN d.seconds ELSE 0 END)::int AS billable_seconds
    FROM daily_activity d
    JOIN people p ON p.id = d.person_id
    LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.day >= ${start} AND d.day <= ${end}
    GROUP BY p.name, d.client_id, c.name, c.color, c.billable_rate, d.day
  `

  return aggregateTeam(rows, days)
}

type TeamRow = {
  person: string
  client_id: number
  client_name: string | null
  color: string | null
  billable_rate: number | null
  day: string
  seconds: number
  billable_seconds: number
}

/** Pure aggregation, split out so it can be unit-tested without a database. */
export function aggregateTeam(rows: TeamRow[], days: number): TeamSummary {
  const key = (id: number): number | null => (id === NO_CLIENT ? null : id)

  const blankClient = (r: TeamRow): ClientSummary => ({
    clientId: key(r.client_id),
    clientName: r.client_name ?? 'Unassigned',
    color: r.color ?? '#94a3b8',
    seconds: 0,
    billableSeconds: 0,
    amount: 0
  })

  const people = new Map<string, TeamMemberSummary>()
  const clients = new Map<number | null, ClientSummary>()
  const daily = new Map<string, DailyTotal>()
  let totalSeconds = 0
  let billableSeconds = 0

  for (const r of rows) {
    const rate = r.billable_rate ?? 0
    const amount = (r.billable_seconds / 3600) * rate

    // Per person, and per client within that person.
    let m = people.get(r.person)
    if (!m) {
      m = { person: r.person, seconds: 0, billableSeconds: 0, amount: 0, clients: [] }
      people.set(r.person, m)
    }
    m.seconds += r.seconds
    m.billableSeconds += r.billable_seconds
    m.amount += amount
    let mc = m.clients.find((c) => c.clientId === key(r.client_id))
    if (!mc) {
      mc = blankClient(r)
      m.clients.push(mc)
    }
    mc.seconds += r.seconds
    mc.billableSeconds += r.billable_seconds
    mc.amount += amount

    // Team-wide per client.
    let c = clients.get(key(r.client_id))
    if (!c) {
      c = blankClient(r)
      clients.set(key(r.client_id), c)
    }
    c.seconds += r.seconds
    c.billableSeconds += r.billable_seconds
    c.amount += amount

    // Team-wide per day.
    let d = daily.get(r.day)
    if (!d) {
      d = { day: r.day, seconds: 0, byClient: [] }
      daily.set(r.day, d)
    }
    d.seconds += r.seconds
    const existing = d.byClient.find((b) => b.clientId === key(r.client_id))
    if (existing) existing.seconds += r.seconds
    else d.byClient.push({ clientId: key(r.client_id), seconds: r.seconds })

    totalSeconds += r.seconds
    billableSeconds += r.billable_seconds
  }

  const bySeconds = (a: { seconds: number }, b: { seconds: number }): number => b.seconds - a.seconds
  for (const m of people.values()) m.clients.sort(bySeconds)

  return {
    days,
    totalSeconds,
    billableSeconds,
    people: Array.from(people.values()).sort(bySeconds),
    clients: Array.from(clients.values()).sort(bySeconds),
    daily: Array.from(daily.values()).sort((a, b) => a.day.localeCompare(b.day))
  }
}
