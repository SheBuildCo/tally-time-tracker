// Local per-user persistence (SQLite via better-sqlite3).
//
// Stores the things ActivityWatch doesn't know about: the firm's clients and
// billable rates, and the mapping rules that attribute usage to them. It also
// keeps a per-day *rollup* of categorized usage (`daily_activity`) so history
// survives, renders offline, and doesn't depend on ActivityWatch's own
// retention. Raw events still originate in ActivityWatch; we persist the
// aggregated result, recomputing the current day live (see lib/ingest.ts).

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Client, MappingRule, RuleMatch } from "./types";

const DATA_DIR = process.env.TALLY_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.TALLY_DB_PATH || path.join(DATA_DIR, "tally.db");

let _db: Database.Database | null = null;

function connect(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  seedIfEmpty(db);
  _db = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      billable_rate REAL NOT NULL DEFAULT 0,
      color         TEXT
    );
    CREATE TABLE IF NOT EXISTS rules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      match_app   TEXT,
      match_title TEXT,
      match_domain TEXT,
      client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      project     TEXT,
      billable    INTEGER NOT NULL DEFAULT 1,
      priority    INTEGER NOT NULL DEFAULT 100
    );
    -- Per-day rollup of categorized usage. client_id uses -1 for "no client"
    -- (so the primary key works; SQLite treats NULLs as distinct). 'unassigned'
    -- distinguishes "no rule matched" from an explicit null-client rule. 'host'
    -- is part of the key because the rollup groups by it (lib/ingest.ts) — two
    -- tabs with the same title on different domains are distinct activities.
    CREATE TABLE IF NOT EXISTS daily_activity (
      day        TEXT NOT NULL,
      client_id  INTEGER NOT NULL,        -- -1 = no client
      app        TEXT NOT NULL,
      activity   TEXT NOT NULL,           -- cleaned window title (fine label)
      host       TEXT NOT NULL DEFAULT '',
      billable   INTEGER NOT NULL DEFAULT 0,
      unassigned INTEGER NOT NULL DEFAULT 0,
      seconds    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, client_id, app, activity, host, billable, unassigned)
    );
    -- Days whose rollup is complete (the day is over and was ingested).
    CREATE TABLE IF NOT EXISTS day_finalized (
      day          TEXT PRIMARY KEY,
      finalized_at TEXT NOT NULL
    );
  `);
  migrateDailyActivityPk(db);
}

// Early builds created daily_activity with a primary key that omitted `host`,
// while the ingest rollup groups by host — so two activities differing only by
// host collided on INSERT ("UNIQUE constraint failed"). Rebuild the table with
// host in the key. The rollup is a regenerable cache, but we copy existing rows
// (summing seconds defensively) so no history is lost on upgrade.
function migrateDailyActivityPk(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(daily_activity)").all() as Array<{
    name: string;
    pk: number;
  }>;
  const hostInPk = cols.some((c) => c.name === "host" && c.pk > 0);
  if (hostInPk) return; // already on the new schema (or fresh install)

  db.exec(`
    BEGIN;
    ALTER TABLE daily_activity RENAME TO daily_activity_legacy;
    CREATE TABLE daily_activity (
      day        TEXT NOT NULL,
      client_id  INTEGER NOT NULL,
      app        TEXT NOT NULL,
      activity   TEXT NOT NULL,
      host       TEXT NOT NULL DEFAULT '',
      billable   INTEGER NOT NULL DEFAULT 0,
      unassigned INTEGER NOT NULL DEFAULT 0,
      seconds    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, client_id, app, activity, host, billable, unassigned)
    );
    INSERT INTO daily_activity
      (day, client_id, app, activity, host, billable, unassigned, seconds)
      SELECT day, client_id, app, activity, host, billable, unassigned, SUM(seconds)
      FROM daily_activity_legacy
      GROUP BY day, client_id, app, activity, host, billable, unassigned;
    DROP TABLE daily_activity_legacy;
    COMMIT;
  `);
}

/** The -1 sentinel used in daily_activity for "no client". */
const NO_CLIENT = -1;

export interface DailyActivityRow {
  day: string;
  clientId: number | null;
  app: string;
  activity: string;
  host: string;
  billable: boolean;
  unassigned: boolean;
  seconds: number;
}

interface DailyActivityDbRow {
  day: string;
  client_id: number;
  app: string;
  activity: string;
  host: string;
  billable: number;
  unassigned: number;
  seconds: number;
}

function toDailyRow(r: DailyActivityDbRow): DailyActivityRow {
  return {
    day: r.day,
    clientId: r.client_id === NO_CLIENT ? null : r.client_id,
    app: r.app,
    activity: r.activity,
    host: r.host,
    billable: !!r.billable,
    unassigned: !!r.unassigned,
    seconds: r.seconds,
  };
}

/** Replace a single day's rollup atomically (ingest recomputes the whole day). */
export function replaceDayActivity(
  day: string,
  rows: DailyActivityRow[],
): void {
  const db = connect();
  const del = db.prepare("DELETE FROM daily_activity WHERE day = ?");
  const ins = db.prepare(
    `INSERT INTO daily_activity
       (day, client_id, app, activity, host, billable, unassigned, seconds)
     VALUES (@day, @client_id, @app, @activity, @host, @billable, @unassigned, @seconds)`,
  );
  const tx = db.transaction((rs: DailyActivityRow[]) => {
    del.run(day);
    for (const r of rs) {
      ins.run({
        day,
        client_id: r.clientId ?? NO_CLIENT,
        app: r.app,
        activity: r.activity,
        host: r.host,
        billable: r.billable ? 1 : 0,
        unassigned: r.unassigned ? 1 : 0,
        seconds: Math.round(r.seconds),
      });
    }
  });
  tx(rows);
}

/** Fetch stored rollup rows for an inclusive day range [startDay, endDay]. */
export function getActivityRows(
  startDay: string,
  endDay: string,
): DailyActivityRow[] {
  return connect()
    .prepare(
      "SELECT * FROM daily_activity WHERE day >= ? AND day <= ? ORDER BY day",
    )
    .all(startDay, endDay)
    .map((r) => toDailyRow(r as DailyActivityDbRow));
}

export function markFinalized(day: string, finalizedAt: string): void {
  connect()
    .prepare(
      `INSERT INTO day_finalized (day, finalized_at) VALUES (?, ?)
       ON CONFLICT(day) DO UPDATE SET finalized_at = excluded.finalized_at`,
    )
    .run(day, finalizedAt);
}

export function isFinalized(day: string): boolean {
  return !!connect()
    .prepare("SELECT 1 FROM day_finalized WHERE day = ?")
    .get(day);
}

export function clearDayFinalized(day: string): void {
  connect().prepare("DELETE FROM day_finalized WHERE day = ?").run(day);
}

// ---- row mapping ---------------------------------------------------------

interface ClientRow {
  id: number;
  name: string;
  billable_rate: number;
  color: string | null;
}
interface RuleRow {
  id: number;
  match_app: string | null;
  match_title: string | null;
  match_domain: string | null;
  client_id: number | null;
  project: string | null;
  billable: number;
  priority: number;
}

function toClient(r: ClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    billableRate: r.billable_rate,
    color: r.color ?? undefined,
  };
}

function toRule(r: RuleRow): MappingRule {
  const match: RuleMatch = {};
  if (r.match_app) match.app = r.match_app;
  if (r.match_title) match.titleRegex = r.match_title;
  if (r.match_domain) match.urlDomain = r.match_domain;
  return {
    id: r.id,
    match,
    clientId: r.client_id,
    project: r.project,
    billable: !!r.billable,
    priority: r.priority,
  };
}

// ---- clients -------------------------------------------------------------

export function listClients(): Client[] {
  return connect()
    .prepare("SELECT * FROM clients ORDER BY name")
    .all()
    .map((r) => toClient(r as ClientRow));
}

export function createClient(
  name: string,
  billableRate: number,
  color?: string,
): Client {
  const info = connect()
    .prepare(
      "INSERT INTO clients (name, billable_rate, color) VALUES (?, ?, ?)",
    )
    .run(name, billableRate, color ?? null);
  return getClient(Number(info.lastInsertRowid))!;
}

export function getClient(id: number): Client | undefined {
  const row = connect()
    .prepare("SELECT * FROM clients WHERE id = ?")
    .get(id) as ClientRow | undefined;
  return row ? toClient(row) : undefined;
}

export function updateClient(
  id: number,
  fields: Partial<Pick<Client, "name" | "billableRate" | "color">>,
): Client | undefined {
  const existing = getClient(id);
  if (!existing) return undefined;
  const next = { ...existing, ...fields };
  connect()
    .prepare(
      "UPDATE clients SET name = ?, billable_rate = ?, color = ? WHERE id = ?",
    )
    .run(next.name, next.billableRate, next.color ?? null, id);
  return getClient(id);
}

export function deleteClient(id: number): void {
  connect().prepare("DELETE FROM clients WHERE id = ?").run(id);
}

// ---- rules ---------------------------------------------------------------

export function listRules(): MappingRule[] {
  return connect()
    .prepare("SELECT * FROM rules ORDER BY priority, id")
    .all()
    .map((r) => toRule(r as RuleRow));
}

export interface RuleInput {
  match: RuleMatch;
  clientId: number | null;
  project?: string | null;
  billable?: boolean;
  priority?: number;
}

export function createRule(input: RuleInput): MappingRule {
  const info = connect()
    .prepare(
      `INSERT INTO rules (match_app, match_title, match_domain, client_id, project, billable, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.match.app ?? null,
      input.match.titleRegex ?? null,
      input.match.urlDomain ?? null,
      input.clientId,
      input.project ?? null,
      input.billable === false ? 0 : 1,
      input.priority ?? 100,
    );
  return toRule(
    connect()
      .prepare("SELECT * FROM rules WHERE id = ?")
      .get(Number(info.lastInsertRowid)) as RuleRow,
  );
}

export function deleteRule(id: number): void {
  connect().prepare("DELETE FROM rules WHERE id = ?").run(id);
}

// ---- seed ----------------------------------------------------------------

/**
 * On first run, seed the apps the firm uses so the dashboard shows meaningful
 * structure immediately. Client-specific PM-tool domains are added by the user
 * (or via suggested rules) since they vary per engagement.
 *
 * "Internal / Admin" (id assigned at seed time) collects firm-internal,
 * non-billable time like Teams and Outlook unless a more specific client rule
 * matches first (lower priority number).
 */
function seedIfEmpty(db: Database.Database): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM clients").get() as {
    n: number;
  };
  if (count.n > 0) return;

  const insertClient = db.prepare(
    "INSERT INTO clients (name, billable_rate, color) VALUES (?, ?, ?)",
  );
  const internalId = Number(
    insertClient.run("Internal / Admin", 0, "gray").lastInsertRowid,
  );
  // A couple of example billable clients so charts aren't empty pre-config.
  insertClient.run("Example Client A", 150, "blue");
  insertClient.run("Example Client B", 120, "emerald");

  const insertRule = db.prepare(
    `INSERT INTO rules (match_app, match_title, match_domain, client_id, project, billable, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // Known firm apps -> Internal/Admin, non-billable, low-priority (evaluated
  // after any client-specific rules the user adds at priority < 100).
  const internalApps: [string | null, string | null][] = [
    ["ms-teams.exe", null],
    ["Teams.exe", null],
    ["OUTLOOK.EXE", null],
  ];
  for (const [app] of internalApps) {
    insertRule.run(app, null, null, internalId, "Admin", 0, 100);
  }
  // Outlook on the web + Teams web -> Internal/Admin.
  insertRule.run(null, null, "outlook.office.com", internalId, "Admin", 0, 100);
  insertRule.run(null, null, "teams.microsoft.com", internalId, "Admin", 0, 100);
  // Canva -> Internal by default (often client work; user can re-point it).
  insertRule.run(null, null, "canva.com", internalId, "Design", 0, 100);
}

/** Test helper: reset the in-memory connection (used by unit tests). */
export function _resetConnectionForTests(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
