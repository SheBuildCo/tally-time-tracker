// Local per-user persistence (SQLite via better-sqlite3).
//
// Stores the things ActivityWatch doesn't know about: the firm's clients and
// billable rates, and the mapping rules that attribute usage to them. It also
// keeps a per-day *rollup* of categorized usage (`daily_activity`) so history
// survives, renders offline, and doesn't depend on ActivityWatch's own
// retention. Raw events still originate in ActivityWatch; we persist the
// aggregated result, recomputing the current day live (see lib/ingest.ts).

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Client, MappingRule, Person, RuleMatch } from "./types";

// Resolve the DB path lazily (at first connect, not module load) so that env
// vars set by the launching script or by tests take effect regardless of
// ES-module import hoisting.
function dbPath(): string {
  const dataDir =
    process.env.TALLY_DATA_DIR || path.join(process.cwd(), "data");
  return process.env.TALLY_DB_PATH || path.join(dataDir, "tally.db");
}

let _db: Database.Database | null = null;

function connect(): Database.Database {
  if (_db) return _db;
  const DB_PATH = dbPath();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  seedDefaultPerson(db);
  seedIfEmpty(db);
  _db = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    -- Team members whose machines push usage to this (shared) instance. Each
    -- person's push agent authenticates with its unique token. On a single-user
    -- local install there's just one seeded person (see seedDefaultPerson).
    CREATE TABLE IF NOT EXISTS people (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      token  TEXT NOT NULL UNIQUE,   -- bearer secret the machine's agent sends
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS clients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      billable_rate REAL NOT NULL DEFAULT 0,
      color         TEXT,
      chrome_profile_dir  TEXT,  -- Chrome --profile-directory Tally provisioned
      chrome_profile_name TEXT   -- the profile's display name (matched in titles)
    );
    CREATE TABLE IF NOT EXISTS rules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      match_app   TEXT,
      match_title TEXT,
      match_domain TEXT,
      match_profile TEXT,
      client_id   INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      project     TEXT,
      billable    INTEGER NOT NULL DEFAULT 1,
      priority    INTEGER NOT NULL DEFAULT 100
    );
    -- Per-day rollup of categorized usage, per person. person_id is the FIRST
    -- key component so two teammates' otherwise-identical days never collide
    -- (the whole reason a shared instance is possible). client_id uses -1 for
    -- "no client" (so the primary key works; SQLite treats NULLs as distinct).
    -- 'unassigned' distinguishes "no rule matched" from an explicit null-client
    -- rule. 'host' is part of the key because the rollup groups by it
    -- (lib/ingest.ts) — two tabs with the same title on different domains are
    -- distinct activities.
    CREATE TABLE IF NOT EXISTS daily_activity (
      person_id  INTEGER NOT NULL DEFAULT 1,
      day        TEXT NOT NULL,
      client_id  INTEGER NOT NULL,        -- -1 = no client
      app        TEXT NOT NULL,
      activity   TEXT NOT NULL,           -- cleaned window title (fine label)
      host       TEXT NOT NULL DEFAULT '',
      profile    TEXT NOT NULL DEFAULT '', -- Chrome profile name (client signal)
      billable   INTEGER NOT NULL DEFAULT 0,
      unassigned INTEGER NOT NULL DEFAULT 0,
      seconds    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, day, client_id, app, activity, host, profile, billable, unassigned)
    );
    -- Raw pushed usage events, per person per day, kept as the central "source"
    -- that replaces per-machine ActivityWatch: re-syncing rules or AI cleanup
    -- recomputes the rollup from these instead of re-reading anyone's local AW.
    CREATE TABLE IF NOT EXISTS pushed_events (
      person_id   INTEGER NOT NULL,
      day         TEXT NOT NULL,
      events_json TEXT NOT NULL,          -- JSON array of UsageEvent
      received_at TEXT NOT NULL,
      PRIMARY KEY (person_id, day)
    );
    -- Days whose rollup is complete (the day is over and was ingested).
    CREATE TABLE IF NOT EXISTS day_finalized (
      day          TEXT PRIMARY KEY,
      finalized_at TEXT NOT NULL
    );
    -- LLM cleanup cache: each distinct raw host/title is enriched at most once
    -- (per model), so views stay fast + deterministic and cost is bounded.
    CREATE TABLE IF NOT EXISTS cleanup_cache (
      raw                   TEXT PRIMARY KEY,  -- the raw host (sites) or cleaned title
      kind                  TEXT NOT NULL,     -- 'site' | 'title'
      cleaned_label         TEXT NOT NULL,
      is_per_client         INTEGER NOT NULL DEFAULT 0,
      suggested_domain      TEXT,
      suggested_client_name TEXT,              -- resolved to an id at read time
      confidence            REAL NOT NULL DEFAULT 0,
      model                 TEXT NOT NULL,     -- ENRICH_MODEL used (invalidates on model change)
      updated_at            TEXT NOT NULL
    );
    -- Simple key/value app settings (e.g. the shared Anthropic API key). Lives
    -- in the per-user data dir; the key is write-only from the renderer's view.
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Add columns to pre-existing tables (no-ops on fresh installs, which already
  // have them from the CREATE TABLE above). ALTER ADD COLUMN is cheap and safe.
  addColumnIfMissing(db, "clients", "chrome_profile_dir", "TEXT");
  addColumnIfMissing(db, "clients", "chrome_profile_name", "TEXT");
  addColumnIfMissing(db, "rules", "match_profile", "TEXT");
  migrateDailyActivityPk(db);
  migrateDailyActivityProfile(db);
  migrateDailyActivityPerson(db);
}

// daily_activity gained a leading `person_id` key column so a shared instance
// can hold multiple teammates' rows without collision. Rebuild the table with
// person_id first in the primary key, defaulting existing (single-user) rows to
// person 1 — the seeded default person. Same rename→create→copy pattern as the
// other daily_activity migrations.
function migrateDailyActivityPerson(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(daily_activity)").all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === "person_id")) return; // already migrated/fresh

  db.exec(`
    BEGIN;
    ALTER TABLE daily_activity RENAME TO daily_activity_legacy;
    CREATE TABLE daily_activity (
      person_id  INTEGER NOT NULL DEFAULT 1,
      day        TEXT NOT NULL,
      client_id  INTEGER NOT NULL,
      app        TEXT NOT NULL,
      activity   TEXT NOT NULL,
      host       TEXT NOT NULL DEFAULT '',
      profile    TEXT NOT NULL DEFAULT '',
      billable   INTEGER NOT NULL DEFAULT 0,
      unassigned INTEGER NOT NULL DEFAULT 0,
      seconds    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (person_id, day, client_id, app, activity, host, profile, billable, unassigned)
    );
    INSERT INTO daily_activity
      (person_id, day, client_id, app, activity, host, profile, billable, unassigned, seconds)
      SELECT 1, day, client_id, app, activity, host, profile, billable, unassigned, seconds
      FROM daily_activity_legacy;
    DROP TABLE daily_activity_legacy;
    COMMIT;
  `);
}

/** Add a column to an existing table if it isn't already present. */
function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// daily_activity gained a `profile` column (the Chrome profile name) that is part
// of the rollup key, so two otherwise-identical activities under different
// profiles stay distinct. Rebuild the table with profile in the primary key,
// defaulting existing rows to '' (a re-sync repopulates the recomputed range).
function migrateDailyActivityProfile(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(daily_activity)").all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === "profile")) return; // already migrated/fresh

  db.exec(`
    BEGIN;
    ALTER TABLE daily_activity RENAME TO daily_activity_legacy;
    CREATE TABLE daily_activity (
      day        TEXT NOT NULL,
      client_id  INTEGER NOT NULL,
      app        TEXT NOT NULL,
      activity   TEXT NOT NULL,
      host       TEXT NOT NULL DEFAULT '',
      profile    TEXT NOT NULL DEFAULT '',
      billable   INTEGER NOT NULL DEFAULT 0,
      unassigned INTEGER NOT NULL DEFAULT 0,
      seconds    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, client_id, app, activity, host, profile, billable, unassigned)
    );
    INSERT INTO daily_activity
      (day, client_id, app, activity, host, profile, billable, unassigned, seconds)
      SELECT day, client_id, app, activity, host, '', billable, unassigned, SUM(seconds)
      FROM daily_activity_legacy
      GROUP BY day, client_id, app, activity, host, billable, unassigned;
    DROP TABLE daily_activity_legacy;
    COMMIT;
  `);
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
  personId: number;
  day: string;
  clientId: number | null;
  app: string;
  activity: string;
  host: string;
  profile: string;
  billable: boolean;
  unassigned: boolean;
  seconds: number;
}

interface DailyActivityDbRow {
  person_id: number;
  day: string;
  client_id: number;
  app: string;
  activity: string;
  host: string;
  profile: string;
  billable: number;
  unassigned: number;
  seconds: number;
}

function toDailyRow(r: DailyActivityDbRow): DailyActivityRow {
  return {
    personId: r.person_id,
    day: r.day,
    clientId: r.client_id === NO_CLIENT ? null : r.client_id,
    app: r.app,
    activity: r.activity,
    host: r.host,
    profile: r.profile,
    billable: !!r.billable,
    unassigned: !!r.unassigned,
    seconds: r.seconds,
  };
}

/**
 * Replace one person's rollup for a single day atomically. The DELETE is scoped
 * to (person_id, day) — NOT day alone — so a teammate's sync never wipes the
 * rest of the team's rows for that day.
 */
export function replaceDayActivity(
  personId: number,
  day: string,
  rows: DailyActivityRow[],
): void {
  const db = connect();
  const del = db.prepare(
    "DELETE FROM daily_activity WHERE person_id = ? AND day = ?",
  );
  const ins = db.prepare(
    `INSERT INTO daily_activity
       (person_id, day, client_id, app, activity, host, profile, billable, unassigned, seconds)
     VALUES (@person_id, @day, @client_id, @app, @activity, @host, @profile, @billable, @unassigned, @seconds)`,
  );
  const tx = db.transaction((rs: DailyActivityRow[]) => {
    del.run(personId, day);
    for (const r of rs) {
      ins.run({
        person_id: personId,
        day,
        client_id: r.clientId ?? NO_CLIENT,
        app: r.app,
        activity: r.activity,
        host: r.host,
        profile: r.profile,
        billable: r.billable ? 1 : 0,
        unassigned: r.unassigned ? 1 : 0,
        seconds: Math.round(r.seconds),
      });
    }
  });
  tx(rows);
}

/**
 * Fetch stored rollup rows for an inclusive day range [startDay, endDay].
 * Omit `personId` for the whole team (the recap view); pass it to scope to one
 * person.
 */
export function getActivityRows(
  startDay: string,
  endDay: string,
  personId?: number,
): DailyActivityRow[] {
  const db = connect();
  const rows =
    personId === undefined
      ? db
          .prepare(
            "SELECT * FROM daily_activity WHERE day >= ? AND day <= ? ORDER BY day",
          )
          .all(startDay, endDay)
      : db
          .prepare(
            "SELECT * FROM daily_activity WHERE person_id = ? AND day >= ? AND day <= ? ORDER BY day",
          )
          .all(personId, startDay, endDay);
  return rows.map((r) => toDailyRow(r as DailyActivityDbRow));
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

// ---- cleanup cache (LLM enrichment) --------------------------------------

export interface CleanupRow {
  raw: string;
  kind: "site" | "title";
  cleanedLabel: string;
  isPerClient: boolean;
  suggestedDomain: string | null;
  suggestedClientName: string | null;
  confidence: number;
  model: string;
}

interface CleanupDbRow {
  raw: string;
  kind: string;
  cleaned_label: string;
  is_per_client: number;
  suggested_domain: string | null;
  suggested_client_name: string | null;
  confidence: number;
  model: string;
}

function toCleanupRow(r: CleanupDbRow): CleanupRow {
  return {
    raw: r.raw,
    kind: r.kind === "title" ? "title" : "site",
    cleanedLabel: r.cleaned_label,
    isPerClient: !!r.is_per_client,
    suggestedDomain: r.suggested_domain,
    suggestedClientName: r.suggested_client_name,
    confidence: r.confidence,
    model: r.model,
  };
}

/** All cached cleanups for the given model, keyed by raw host/title. */
export function getCleanupCache(model: string): Map<string, CleanupRow> {
  const rows = connect()
    .prepare("SELECT * FROM cleanup_cache WHERE model = ?")
    .all(model)
    .map((r) => toCleanupRow(r as CleanupDbRow));
  return new Map(rows.map((r) => [r.raw, r]));
}

/** Cached cleanups for a specific set of raw keys (for diffing before a run). */
export function getCleanupFor(
  raws: string[],
  model: string,
): Map<string, CleanupRow> {
  if (raws.length === 0) return new Map();
  const db = connect();
  const stmt = db.prepare(
    "SELECT * FROM cleanup_cache WHERE model = ? AND raw = ?",
  );
  const out = new Map<string, CleanupRow>();
  for (const raw of raws) {
    const row = stmt.get(model, raw) as CleanupDbRow | undefined;
    if (row) out.set(raw, toCleanupRow(row));
  }
  return out;
}

/** Insert or overwrite cleanup rows (re-cleaning replaces prior values). */
export function upsertCleanup(rows: CleanupRow[], updatedAt: string): void {
  const db = connect();
  const stmt = db.prepare(
    `INSERT INTO cleanup_cache
       (raw, kind, cleaned_label, is_per_client, suggested_domain,
        suggested_client_name, confidence, model, updated_at)
     VALUES (@raw, @kind, @cleaned_label, @is_per_client, @suggested_domain,
        @suggested_client_name, @confidence, @model, @updated_at)
     ON CONFLICT(raw) DO UPDATE SET
       kind = excluded.kind,
       cleaned_label = excluded.cleaned_label,
       is_per_client = excluded.is_per_client,
       suggested_domain = excluded.suggested_domain,
       suggested_client_name = excluded.suggested_client_name,
       confidence = excluded.confidence,
       model = excluded.model,
       updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((rs: CleanupRow[]) => {
    for (const r of rs) {
      stmt.run({
        raw: r.raw,
        kind: r.kind,
        cleaned_label: r.cleanedLabel,
        is_per_client: r.isPerClient ? 1 : 0,
        suggested_domain: r.suggestedDomain,
        suggested_client_name: r.suggestedClientName,
        confidence: r.confidence,
        model: r.model,
        updated_at: updatedAt,
      });
    }
  });
  tx(rows);
}

export function clearCleanupCache(): void {
  connect().prepare("DELETE FROM cleanup_cache").run();
}

// ---- app settings (key/value) --------------------------------------------

export function getSetting(key: string): string | null {
  const row = connect()
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as { value: string | null } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string | null): void {
  connect()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

// ---- people --------------------------------------------------------------

interface PersonRow {
  id: number;
  name: string;
  token: string;
  active: number;
}

function toPerson(r: PersonRow): Person {
  return { id: r.id, name: r.name, active: !!r.active };
}

/** Generate an opaque bearer token for a person's push agent. */
export function newPersonToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** All people (token omitted — never returned to the UI). */
export function listPeople(): Person[] {
  return connect()
    .prepare("SELECT * FROM people ORDER BY name")
    .all()
    .map((r) => toPerson(r as PersonRow));
}

export function getPerson(id: number): Person | undefined {
  const row = connect()
    .prepare("SELECT * FROM people WHERE id = ?")
    .get(id) as PersonRow | undefined;
  return row ? toPerson(row) : undefined;
}

/** Resolve a person from the bearer token an agent presents (active only). */
export function getPersonByToken(token: string): Person | undefined {
  if (!token) return undefined;
  const row = connect()
    .prepare("SELECT * FROM people WHERE token = ? AND active = 1")
    .get(token) as PersonRow | undefined;
  return row ? toPerson(row) : undefined;
}

/** Create a person, returning the row plus the freshly-issued token (shown once). */
export function createPerson(
  name: string,
  token: string = newPersonToken(),
): { person: Person; token: string } {
  const info = connect()
    .prepare("INSERT INTO people (name, token) VALUES (?, ?)")
    .run(name, token);
  return { person: getPerson(Number(info.lastInsertRowid))!, token };
}

export function deletePerson(id: number): void {
  connect().prepare("DELETE FROM people WHERE id = ?").run(id);
}

// ---- pushed events (central "source" for re-categorization) ---------------

export interface PushedDay {
  personId: number;
  day: string;
}

/** Store (replace) one person's raw pushed events for a day. */
export function storePushedEvents(
  personId: number,
  day: string,
  eventsJson: string,
  receivedAt: string,
): void {
  connect()
    .prepare(
      `INSERT INTO pushed_events (person_id, day, events_json, received_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(person_id, day) DO UPDATE SET
         events_json = excluded.events_json,
         received_at = excluded.received_at`,
    )
    .run(personId, day, eventsJson, receivedAt);
}

/** Read one person-day's raw pushed events JSON (undefined if none stored). */
export function getPushedEvents(
  personId: number,
  day: string,
): string | undefined {
  const row = connect()
    .prepare(
      "SELECT events_json FROM pushed_events WHERE person_id = ? AND day = ?",
    )
    .get(personId, day) as { events_json: string } | undefined;
  return row?.events_json;
}

/** All (person, day) pairs with stored events in [startDay, endDay] — drives re-sync. */
export function listPushedDays(startDay: string, endDay: string): PushedDay[] {
  return (
    connect()
      .prepare(
        "SELECT person_id, day FROM pushed_events WHERE day >= ? AND day <= ? ORDER BY person_id, day",
      )
      .all(startDay, endDay) as Array<{ person_id: number; day: string }>
  ).map((r) => ({ personId: r.person_id, day: r.day }));
}

// ---- row mapping ---------------------------------------------------------

interface ClientRow {
  id: number;
  name: string;
  billable_rate: number;
  color: string | null;
  chrome_profile_dir: string | null;
  chrome_profile_name: string | null;
}
interface RuleRow {
  id: number;
  match_app: string | null;
  match_title: string | null;
  match_domain: string | null;
  match_profile: string | null;
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
    chromeProfileDir: r.chrome_profile_dir ?? undefined,
    chromeProfileName: r.chrome_profile_name ?? undefined,
  };
}

function toRule(r: RuleRow): MappingRule {
  const match: RuleMatch = {};
  if (r.match_app) match.app = r.match_app;
  if (r.match_title) match.titleRegex = r.match_title;
  if (r.match_domain) match.urlDomain = r.match_domain;
  if (r.match_profile) match.profile = r.match_profile;
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

/** Record the Chrome profile (directory + display name) Tally provisioned for a client. */
export function setClientChromeProfile(
  id: number,
  dir: string,
  name: string,
): Client | undefined {
  connect()
    .prepare(
      "UPDATE clients SET chrome_profile_dir = ?, chrome_profile_name = ? WHERE id = ?",
    )
    .run(dir, name, id);
  return getClient(id);
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
      `INSERT INTO rules (match_app, match_title, match_domain, match_profile, client_id, project, billable, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.match.app ?? null,
      input.match.titleRegex ?? null,
      input.match.urlDomain ?? null,
      input.match.profile ?? null,
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
 * Ensure at least one person (id 1) exists, so single-user local dev works with
 * no admin step and legacy rows (migrated to person_id 1) have an owner. On a
 * shared instance the admin adds the real teammates; this just guarantees the
 * default is present. A dev machine can pin the default person's token via
 * TALLY_PERSON_TOKEN so its agent can push to a freshly-seeded DB.
 */
function seedDefaultPerson(db: Database.Database): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM people").get() as {
    n: number;
  };
  if (count.n > 0) return;
  const name = process.env.TALLY_PERSON_NAME || "Me";
  const token = process.env.TALLY_PERSON_TOKEN || newPersonToken();
  db.prepare("INSERT INTO people (name, token) VALUES (?, ?)").run(name, token);
}

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
