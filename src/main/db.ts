// SQLite persistence layer. All access to tally.db goes through this module.
// Runs only in the Electron main process (better-sqlite3 is a native module and
// cannot be imported from the renderer).

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type {
  Client,
  MappingRule,
  RuleMatch,
  DailyActivityRow,
  TimerSession,
  SessionExclusion,
  ReportHistoryEntry
} from '../shared/types'
import { DEFAULT_SHORTCUTS } from '../shared/types'

let db: Database.Database

// Resolve the DB path. In dev/tests we allow an override via TALLY_DATA_DIR so
// we never touch the user's real data. In the packaged app it lives under the
// per-user app data dir (e.g. %APPDATA%/Tally).
// Exported so other main-process modules (e.g. reports.ts, writing files
// alongside the DB) resolve to the same directory instead of calling
// app.getPath('userData') directly and silently ignoring the override.
export function resolveDataDir(): string {
  if (process.env.TALLY_DATA_DIR) return process.env.TALLY_DATA_DIR
  // app may be undefined in a pure-node test context; fall back to cwd.
  try {
    return app.getPath('userData')
  } catch {
    return join(process.cwd(), 'data')
  }
}

export function initDb(): Database.Database {
  if (db) return db
  const dir = resolveDataDir()
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'tally.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate()
  seedIfEmpty()
  return db
}

// For unit tests: open an in-memory DB without touching Electron.
export function initMemoryDb(): Database.Database {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate()
  seedIfEmpty()
  return db
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      billable_rate  REAL NOT NULL DEFAULT 0,
      retainer_hours REAL NOT NULL DEFAULT 0,
      color          TEXT NOT NULL DEFAULT '#6366f1',
      -- When this client's details were last EDITED BY A PERSON (not synced).
      -- Drives last-edit-wins in sync.ts; the epoch default means a row nobody
      -- has touched never overwrites a teammate's real edit.
      updated_at     TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
    );

    CREATE TABLE IF NOT EXISTS rules (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      match_app         TEXT,
      match_title_regex TEXT,
      match_domain      TEXT,
      client_id         INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      billable          INTEGER NOT NULL DEFAULT 1,
      priority          INTEGER NOT NULL DEFAULT 100
    );

    CREATE TABLE IF NOT EXISTS daily_activity (
      day        TEXT NOT NULL,
      client_id  INTEGER,
      app        TEXT NOT NULL,
      activity   TEXT NOT NULL,
      host       TEXT NOT NULL DEFAULT '',
      billable   INTEGER NOT NULL DEFAULT 0,
      seconds    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, client_id, app, activity, host)
    );

    CREATE TABLE IF NOT EXISTS day_finalized (
      day TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timer_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      start_time TEXT NOT NULL,
      end_time   TEXT,
      notes      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_exclusions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES timer_sessions(id) ON DELETE CASCADE,
      app        TEXT NOT NULL,
      host       TEXT NOT NULL,
      activity   TEXT NOT NULL
    );

    -- Immutable record of what a session actually contained, captured once when
    -- the timer stops. This is the client-facing proof of work: it must not
    -- drift if ActivityWatch's live data changes shape after the fact (browser
    -- extension buffering, bucket rotation, etc).
    CREATE TABLE IF NOT EXISTS session_activity_snapshot (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES timer_sessions(id) ON DELETE CASCADE,
      app        TEXT NOT NULL,
      host       TEXT NOT NULL,
      activity   TEXT NOT NULL,
      seconds    INTEGER NOT NULL DEFAULT 0
    );

    -- A log of client work-summary reports generated on disk, so past PDFs/CSVs
    -- can be reopened without regenerating them.
    CREATE TABLE IF NOT EXISTS report_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      pdf_path    TEXT NOT NULL,
      csv_path    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_start ON timer_sessions(start_time);
    CREATE INDEX IF NOT EXISTS idx_exclusions_session ON session_exclusions(session_id);
    CREATE INDEX IF NOT EXISTS idx_snapshot_session ON session_activity_snapshot(session_id);
    CREATE INDEX IF NOT EXISTS idx_report_history_client ON report_history(client_id);
  `)

  // CREATE TABLE IF NOT EXISTS never touches an existing table, so every column
  // added after the first release has to be applied explicitly for machines that
  // already have a tally.db.
  addColumnIfMissing('clients', 'retainer_hours', 'retainer_hours REAL NOT NULL DEFAULT 0')
  // Existing rows land on the epoch deliberately: before this column existed
  // nobody's copy was authoritative, so no machine's untouched values should
  // win. The first real edit anywhere becomes the truth.
  addColumnIfMissing(
    'clients',
    'updated_at',
    `updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'`
  )

  // First run (or upgrading from a DB that predates this setting): anchor
  // ingestion to "now" so we never retroactively pull in AW history that
  // predates the user actually starting to use Tally.
  if (!getSetting('tracking_started_at')) {
    setSetting('tracking_started_at', new Date().toISOString())
  }
}

/** Idempotent additive migration for a single column. */
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

function seedIfEmpty(): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }
  if (count.n > 0) return

  const insertClient = db.prepare(
    'INSERT INTO clients (name, retainer_hours, color) VALUES (?, ?, ?)'
  )
  const internal = insertClient.run('Internal / Admin', 0, '#64748b').lastInsertRowid as number
  insertClient.run('Example Client A', 0, '#6366f1')
  insertClient.run('Example Client B', 0, '#10b981')

  // A couple of starter rules mapping common internal apps to Internal/Admin.
  const insertRule = db.prepare(
    `INSERT INTO rules (match_app, match_title_regex, match_domain, client_id, billable, priority)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  insertRule.run('ms-teams.exe', null, null, internal, 0, 10)
  insertRule.run('OUTLOOK.EXE', null, null, internal, 0, 10)
  insertRule.run(null, null, 'outlook.office.com', internal, 0, 10)
  insertRule.run(null, null, 'teams.microsoft.com', internal, 0, 10)

  // Default settings.
  setSetting('shortcut_toggle', DEFAULT_SHORTCUTS.toggle)
  setSetting('shortcut_picker', DEFAULT_SHORTCUTS.picker)
  setSetting('auto_launch', 'false')
}

// ---- Clients ----

// NB: the clients table still HAS a billable_rate column. It's legacy — rates
// moved onto people — and is deliberately left in place rather than dropped so
// the old values survive if we ever need them. Nothing reads or writes it.
function rowToClient(r: { id: number; name: string; retainer_hours: number; color: string }): Client {
  return {
    id: r.id,
    name: r.name,
    retainerHours: r.retainer_hours,
    color: r.color
  }
}

export function listClients(): Client[] {
  const rows = db.prepare('SELECT * FROM clients ORDER BY name').all() as any[]
  return rows.map(rowToClient)
}

export function getClient(id: number): Client | null {
  const r = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any
  return r ? rowToClient(r) : null
}

export function createClient(input: Omit<Client, 'id'>): Client {
  const info = db
    .prepare('INSERT INTO clients (name, retainer_hours, color, updated_at) VALUES (?, ?, ?, ?)')
    .run(input.name, input.retainerHours ?? 0, input.color, new Date().toISOString())
  return getClient(info.lastInsertRowid as number)!
}

export function updateClient(id: number, input: Partial<Omit<Client, 'id'>>): Client | null {
  const existing = getClient(id)
  if (!existing) return null
  const merged = { ...existing, ...input }
  // Stamping updated_at is what makes this edit beat every other machine's copy
  // on the next sync — see pushClients in sync.ts.
  db.prepare(
    'UPDATE clients SET name = ?, retainer_hours = ?, color = ?, updated_at = ? WHERE id = ?'
  ).run(merged.name, merged.retainerHours, merged.color, new Date().toISOString(), id)
  return getClient(id)
}

// ---- Client sync support ----
//
// updated_at is deliberately NOT part of the Client type: it's a sync
// implementation detail, and the renderer has no use for it. These two
// functions are the only way in or out.

export interface ClientSyncRow extends Client {
  updatedAt: string
}

export function listClientsForSync(): ClientSyncRow[] {
  const rows = db.prepare('SELECT * FROM clients ORDER BY name').all() as any[]
  return rows.map((r) => ({ ...rowToClient(r), updatedAt: r.updated_at }))
}

/**
 * Apply a client from the shared database, matched by name (ids are
 * per-machine). Creates it locally when it's new, and overwrites the local
 * details ONLY when the shared copy was edited more recently.
 *
 * The remote timestamp is stored verbatim rather than stamped as "now", so a
 * pulled row doesn't look like a fresh local edit and get pushed straight back —
 * that would make two machines ping-pong forever.
 */
export function upsertClientFromRemote(remote: {
  name: string
  retainerHours: number
  color: string
  updatedAt: string
}): 'created' | 'updated' | 'unchanged' {
  const existing = db.prepare('SELECT * FROM clients WHERE name = ?').get(remote.name) as any
  if (!existing) {
    db.prepare(
      'INSERT INTO clients (name, retainer_hours, color, updated_at) VALUES (?, ?, ?, ?)'
    ).run(remote.name, remote.retainerHours, remote.color, remote.updatedAt)
    return 'created'
  }
  if (remote.updatedAt <= existing.updated_at) return 'unchanged'
  db.prepare(
    'UPDATE clients SET retainer_hours = ?, color = ?, updated_at = ? WHERE id = ?'
  ).run(remote.retainerHours, remote.color, remote.updatedAt, existing.id)
  return 'updated'
}

export function deleteClient(id: number): void {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id)
}

// ---- Rules ----

function rowToRule(r: {
  id: number
  match_app: string | null
  match_title_regex: string | null
  match_domain: string | null
  client_id: number | null
  billable: number
  priority: number
}): MappingRule {
  const match: RuleMatch = {}
  if (r.match_app) match.app = r.match_app
  if (r.match_title_regex) match.titleRegex = r.match_title_regex
  if (r.match_domain) match.urlDomain = r.match_domain
  return {
    id: r.id,
    match,
    clientId: r.client_id,
    billable: !!r.billable,
    priority: r.priority
  }
}

export function listRules(): MappingRule[] {
  const rows = db.prepare('SELECT * FROM rules ORDER BY priority ASC, id ASC').all() as any[]
  return rows.map(rowToRule)
}

export function createRule(input: Omit<MappingRule, 'id'>): MappingRule {
  const info = db
    .prepare(
      `INSERT INTO rules (match_app, match_title_regex, match_domain, client_id, billable, priority)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.match.app ?? null,
      input.match.titleRegex ?? null,
      input.match.urlDomain ?? null,
      input.clientId,
      input.billable ? 1 : 0,
      input.priority
    )
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(info.lastInsertRowid) as any
  return rowToRule(r)
}

export function deleteRule(id: number): void {
  db.prepare('DELETE FROM rules WHERE id = ?').run(id)
}

// ---- Daily activity (rollup cache) ----

export function replaceDayActivity(day: string, rows: DailyActivityRow[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM daily_activity WHERE day = ?').run(day)
    const insert = db.prepare(
      `INSERT INTO daily_activity (day, client_id, app, activity, host, billable, seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      insert.run(
        row.day,
        row.clientId,
        row.app,
        row.activity,
        row.host,
        row.billable ? 1 : 0,
        Math.round(row.seconds)
      )
    }
  })
  tx()
}

export function getDayActivity(day: string): DailyActivityRow[] {
  const rows = db.prepare('SELECT * FROM daily_activity WHERE day = ?').all(day) as any[]
  return rows.map(rowToDailyActivity)
}

export function getRangeActivity(days: string[]): DailyActivityRow[] {
  if (days.length === 0) return []
  const placeholders = days.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT * FROM daily_activity WHERE day IN (${placeholders})`)
    .all(...days) as any[]
  return rows.map(rowToDailyActivity)
}

function rowToDailyActivity(r: any): DailyActivityRow {
  return {
    day: r.day,
    clientId: r.client_id,
    app: r.app,
    activity: r.activity,
    host: r.host,
    billable: !!r.billable,
    seconds: r.seconds
  }
}

export function isDayFinalized(day: string): boolean {
  return !!db.prepare('SELECT day FROM day_finalized WHERE day = ?').get(day)
}

export function markDayFinalized(day: string): void {
  db.prepare('INSERT OR IGNORE INTO day_finalized (day) VALUES (?)').run(day)
}

export function unfinalizeDay(day: string): void {
  db.prepare('DELETE FROM day_finalized WHERE day = ?').run(day)
}

// ---- Settings ----

export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return r?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

// ---- Timer sessions ----

function rowToSession(r: any): TimerSession {
  return {
    id: r.id,
    clientId: r.client_id,
    startTime: r.start_time,
    endTime: r.end_time,
    notes: r.notes,
    createdAt: r.created_at,
    // Present only when the query selected it (listSessions); left undefined
    // otherwise so callers that don't need it pay nothing.
    activeSeconds: r.active_seconds != null ? r.active_seconds : undefined
  }
}

export function createSession(clientId: number, startTime: string): TimerSession {
  const info = db
    .prepare('INSERT INTO timer_sessions (client_id, start_time) VALUES (?, ?)')
    .run(clientId, startTime)
  return getSession(info.lastInsertRowid as number)!
}

export function endSession(id: number, endTime: string): TimerSession | null {
  db.prepare('UPDATE timer_sessions SET end_time = ? WHERE id = ?').run(endTime, id)
  return getSession(id)
}

// Permanently delete a session. Its snapshot and exclusions go with it via
// ON DELETE CASCADE (foreign_keys pragma is on). Used to drop a session that
// isn't worth billing so it never appears in a report.
export function deleteSession(id: number): void {
  db.prepare('DELETE FROM timer_sessions WHERE id = ?').run(id)
}

export function getSession(id: number): TimerSession | null {
  const r = db.prepare('SELECT * FROM timer_sessions WHERE id = ?').get(id) as any
  return r ? rowToSession(r) : null
}

export function listSessions(limit = 100): TimerSession[] {
  // active_seconds = the session's real worked time (sum of its snapshot), so
  // the list shows active time rather than wall-clock end−start (which balloons
  // for a forgotten timer). Completed sessions have a snapshot; a running one
  // has none yet (COALESCE → 0), and the UI shows its live elapsed instead.
  const rows = db
    .prepare(
      `SELECT ts.*,
              COALESCE(
                (SELECT SUM(seconds) FROM session_activity_snapshot WHERE session_id = ts.id),
                0
              ) AS active_seconds
       FROM timer_sessions ts
       ORDER BY start_time DESC
       LIMIT ?`
    )
    .all(limit) as any[]
  return rows.map(rowToSession)
}

// Any session that overlaps [startISO, endISO]. A running session (end_time
// NULL) is treated as ongoing up to endISO.
export function getSessionsInRange(startISO: string, endISO: string): TimerSession[] {
  const rows = db
    .prepare(
      `SELECT * FROM timer_sessions
       WHERE start_time <= ?
         AND (end_time IS NULL OR end_time >= ?)
       ORDER BY start_time ASC`
    )
    .all(endISO, startISO) as any[]
  return rows.map(rowToSession)
}

// Completed sessions for one client overlapping [startISO, endISO], oldest
// first. This — not daily_activity — is the source of truth for client
// reports: only time the user explicitly tracked for this client via the
// manual timer, never passively-categorized activity.
export function getSessionsForClientInRange(
  clientId: number,
  startISO: string,
  endISO: string
): TimerSession[] {
  const rows = db
    .prepare(
      `SELECT * FROM timer_sessions
       WHERE client_id = ?
         AND end_time IS NOT NULL
         AND start_time <= ?
         AND end_time >= ?
       ORDER BY start_time ASC`
    )
    .all(clientId, endISO, startISO) as any[]
  return rows.map(rowToSession)
}

// Total active seconds this machine has tracked for a client over
// [startISO, endISO] — snapshot total minus anything excluded, matching
// sessionActiveSeconds. Sessions are picked by start_time (not overlap) so the
// figure reconciles with the team-wide query in sync.ts, which does the same.
// Used as the offline fallback for the retainer readout.
export function getClientActiveSecondsInRange(
  clientId: number,
  startISO: string,
  endISO: string
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
                COALESCE(snap.total, 0) - COALESCE(exc.total, 0)
              ), 0) AS active_seconds
       FROM timer_sessions ts
       LEFT JOIN (
         SELECT session_id, SUM(seconds) AS total
         FROM session_activity_snapshot GROUP BY session_id
       ) snap ON snap.session_id = ts.id
       LEFT JOIN (
         SELECT sas.session_id, SUM(sas.seconds) AS total
         FROM session_activity_snapshot sas
         JOIN session_exclusions se
           ON se.session_id = sas.session_id AND se.app = sas.app
          AND se.host = sas.host AND se.activity = sas.activity
         GROUP BY sas.session_id
       ) exc ON exc.session_id = ts.id
       WHERE ts.client_id = ?
         AND ts.end_time IS NOT NULL
         AND ts.start_time >= ? AND ts.start_time <= ?`
    )
    .get(clientId, startISO, endISO) as { active_seconds: number }
  return Math.max(0, row.active_seconds)
}

// Same figure as getClientActiveSecondsInRange, for every client at once, keyed
// by client NAME to match the shared-database version (ids are per-machine, see
// the header of sync.ts). One query rather than one per client, because the
// dashboard needs the whole list at once.
export function getAllClientsActiveSecondsInRange(
  startISO: string,
  endISO: string
): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT c.name AS name,
              COALESCE(SUM(
                COALESCE(snap.total, 0) - COALESCE(exc.total, 0)
              ), 0) AS active_seconds
       FROM timer_sessions ts
       JOIN clients c ON c.id = ts.client_id
       LEFT JOIN (
         SELECT session_id, SUM(seconds) AS total
         FROM session_activity_snapshot GROUP BY session_id
       ) snap ON snap.session_id = ts.id
       LEFT JOIN (
         SELECT sas.session_id, SUM(sas.seconds) AS total
         FROM session_activity_snapshot sas
         JOIN session_exclusions se
           ON se.session_id = sas.session_id AND se.app = sas.app
          AND se.host = sas.host AND se.activity = sas.activity
         GROUP BY sas.session_id
       ) exc ON exc.session_id = ts.id
       WHERE ts.end_time IS NOT NULL
         AND ts.start_time >= ? AND ts.start_time <= ?
       GROUP BY c.name`
    )
    .all(startISO, endISO) as { name: string; active_seconds: number }[]
  return new Map(rows.map((r) => [r.name, Math.max(0, r.active_seconds)]))
}

export function getRunningSession(): TimerSession | null {
  const r = db
    .prepare('SELECT * FROM timer_sessions WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1')
    .get() as any
  return r ? rowToSession(r) : null
}

// ---- Session exclusions ----

function rowToExclusion(r: any): SessionExclusion {
  return { id: r.id, sessionId: r.session_id, app: r.app, host: r.host, activity: r.activity }
}

export function listExclusions(sessionId: number): SessionExclusion[] {
  const rows = db
    .prepare('SELECT * FROM session_exclusions WHERE session_id = ?')
    .all(sessionId) as any[]
  return rows.map(rowToExclusion)
}

export function addExclusion(
  sessionId: number,
  app: string,
  host: string,
  activity: string
): SessionExclusion {
  const info = db
    .prepare(
      'INSERT INTO session_exclusions (session_id, app, host, activity) VALUES (?, ?, ?, ?)'
    )
    .run(sessionId, app, host, activity)
  const r = db.prepare('SELECT * FROM session_exclusions WHERE id = ?').get(info.lastInsertRowid)
  return rowToExclusion(r)
}

export function removeExclusion(id: number): void {
  db.prepare('DELETE FROM session_exclusions WHERE id = ?').run(id)
}

// ---- Session activity snapshots (immutable, captured at stop time) ----

export interface SnapshotRow {
  app: string
  host: string
  activity: string
  seconds: number
}

export function saveSessionSnapshot(sessionId: number, rows: SnapshotRow[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_activity_snapshot WHERE session_id = ?').run(sessionId)
    const insert = db.prepare(
      `INSERT INTO session_activity_snapshot (session_id, app, host, activity, seconds)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      insert.run(sessionId, row.app, row.host, row.activity, Math.round(row.seconds))
    }
  })
  tx()
}

export function getSessionSnapshot(sessionId: number): SnapshotRow[] {
  return db
    .prepare('SELECT app, host, activity, seconds FROM session_activity_snapshot WHERE session_id = ?')
    .all(sessionId) as SnapshotRow[]
}

// ---- Data reset ----

// Wipes the rollup cache only (daily_activity / day_finalized) and moves the
// tracking-start anchor to now, so no pre-reset ActivityWatch history is ever
// pulled in again. Clients, rules, and recorded timer sessions are untouched.
export function clearActivityData(): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM daily_activity').run()
    db.prepare('DELETE FROM day_finalized').run()
  })
  tx()
  setSetting('tracking_started_at', new Date().toISOString())
}

// ---- Report history ----

function rowToReportHistoryEntry(r: any): ReportHistoryEntry {
  return {
    id: r.id,
    clientId: r.client_id,
    startDate: r.start_date,
    endDate: r.end_date,
    csvPath: r.csv_path,
    createdAt: r.created_at
  }
}

export function createReportHistoryEntry(input: {
  clientId: number
  startDate: string
  endDate: string
  csvPath: string
}): ReportHistoryEntry {
  // pdf_path is a legacy NOT NULL column (PDF output was removed). SQLite has no
  // ALTER-drop migration here, so we keep the column and write an empty string.
  const info = db
    .prepare(
      `INSERT INTO report_history (client_id, start_date, end_date, pdf_path, csv_path)
       VALUES (?, ?, ?, '', ?)`
    )
    .run(input.clientId, input.startDate, input.endDate, input.csvPath)
  return getReportHistoryEntry(info.lastInsertRowid as number)!
}

export function getReportHistoryEntry(id: number): ReportHistoryEntry | null {
  const r = db.prepare('SELECT * FROM report_history WHERE id = ?').get(id) as any
  return r ? rowToReportHistoryEntry(r) : null
}

export function listReportHistory(clientId?: number, limit = 100): ReportHistoryEntry[] {
  const rows = clientId
    ? (db
        .prepare(
          'SELECT * FROM report_history WHERE client_id = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(clientId, limit) as any[])
    : (db
        .prepare('SELECT * FROM report_history ORDER BY created_at DESC LIMIT ?')
        .all(limit) as any[])
  return rows.map(rowToReportHistoryEntry)
}
