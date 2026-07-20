// Connection to the shared team database (Supabase / Postgres).
//
// This is DELIBERATELY not the app's primary store. Tally keeps writing to its
// local SQLite (see db.ts) so tracking works offline and every query stays
// instant; this module is the optional shared copy that the team view reads and
// that sync.ts pushes to. If it's unconfigured or unreachable, the app must
// carry on working exactly as before — every function here fails soft.
//
// The connection string lives in app_settings (entered in Settings), not baked
// into the build, so it can be rotated without shipping a new installer.

import postgres from 'postgres'
import { getSetting } from './db'

export const SUPABASE_URL_KEY = 'supabase_url'
export const PERSON_NAME_KEY = 'person_name'

let sql: postgres.Sql | null = null
let cachedUrl: string | null = null

/** The shared-database connection string, or null when not set up yet. */
export function getSupabaseUrl(): string | null {
  const v = getSetting(SUPABASE_URL_KEY)
  return v && v.trim() ? v.trim() : null
}

/** Who this machine reports as. Team rows are attributed to this name. */
export function getPersonName(): string | null {
  const v = getSetting(PERSON_NAME_KEY)
  return v && v.trim() ? v.trim() : null
}

/** True when both the connection string and the person's name are configured. */
export function isConfigured(): boolean {
  return !!getSupabaseUrl() && !!getPersonName()
}

/**
 * Shared connection, opened lazily and reused. Returns null when unconfigured.
 * Reopens if the URL changed (the user pasted a new one in Settings).
 */
export function connect(): postgres.Sql | null {
  const url = getSupabaseUrl()
  if (!url) return null
  if (sql && cachedUrl === url) return sql
  if (sql) void sql.end({ timeout: 5 }).catch(() => {})
  cachedUrl = url
  sql = postgres(url, {
    ssl: 'require',
    // Keep the footprint small: this is a background sync, not a hot path, and
    // Supabase's free tier has a modest connection ceiling shared by the team.
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    // Disable prepared statements so the connection-POOLER string works in
    // either mode. Teammates must use the pooler (IPv4) string, not the direct
    // db.<ref>.supabase.co one, which is IPv6-only and unreachable on most
    // networks; the transaction pooler additionally rejects prepared statements.
    prepare: false,
    onnotice: () => {}
  })
  return sql
}

/** Close the pool (app shutdown, or before reconnecting with a new URL). */
export async function disconnect(): Promise<void> {
  if (!sql) return
  const s = sql
  sql = null
  cachedUrl = null
  await s.end({ timeout: 5 }).catch(() => {})
}

export interface ConnectionCheck {
  ok: boolean
  message: string
}

/**
 * Verify the stored connection string actually works, for the "Test connection"
 * button in Settings — a bad password should say so plainly, not fail silently
 * during a background sync.
 */
export async function testConnection(url?: string): Promise<ConnectionCheck> {
  const target = url?.trim() || getSupabaseUrl()
  if (!target) return { ok: false, message: 'No connection string set.' }

  let probe: postgres.Sql | null = null
  try {
    probe = postgres(target, {
      ssl: 'require',
      max: 1,
      connect_timeout: 15,
      prepare: false,
      onnotice: () => {}
    })
    const [row] = await probe`SELECT COUNT(*)::int AS n FROM people`
    return { ok: true, message: `Connected. ${row.n} ${row.n === 1 ? 'person' : 'people'} in the shared database.` }
  } catch (err) {
    return { ok: false, message: friendlyError(err) }
  } finally {
    if (probe) await probe.end({ timeout: 5 }).catch(() => {})
  }
}

/** Turn postgres.js/network errors into something a non-DBA can act on. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string }
  switch (e.code) {
    case '28P01':
      return 'Wrong database password. Check Supabase → Project Settings → Database.'
    case '3D000':
      return 'That database does not exist — check the connection string.'
    case '42P01':
      return 'Connected, but the tables are missing. Apply supabase/schema.sql first.'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ECONNREFUSED':
    case 'CONNECT_TIMEOUT':
    case 'ETIMEDOUT':
      return (
        'Cannot reach the database. Use the connection POOLER string ' +
        '(Supabase → Connect → “Session pooler”: postgres.<ref>@…pooler.supabase.com:5432), ' +
        'not the direct db.<ref>.supabase.co one — the direct host is IPv6-only and unreachable ' +
        'on most networks. Also check your internet connection.'
      )
    default:
      // Supavisor returns XX000 "Tenant or user not found" when the pooler
      // region in the string is wrong — surface the raw message so it's visible.
      return e.message ?? String(err)
  }
}

/**
 * Resolve this machine's person row, creating it on first sync. Names are the
 * team-wide identity (ids are per-database), so the same name from two machines
 * is the same person.
 */
export async function ensurePersonId(sql: postgres.Sql, name: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO people (name) VALUES (${name})
    ON CONFLICT (name) DO UPDATE SET name = excluded.name
    RETURNING id
  `
  return row.id
}
