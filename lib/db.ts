// Local per-user persistence (SQLite via better-sqlite3).
//
// Stores the things ActivityWatch doesn't know about: the firm's clients and
// billable rates, and the mapping rules that attribute usage to them. Usage
// events themselves are NOT stored here — they live in ActivityWatch and are
// queried on demand — so this DB stays tiny and the source of truth for tracked
// time remains the tracker.

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
  `);
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
