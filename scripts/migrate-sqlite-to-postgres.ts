// One-time data migration: copy an existing local SQLite store (data/tally.db,
// or TALLY_DB_PATH) into a Supabase/Postgres database (DATABASE_URL). Run this
// once when moving an existing local install onto the shared Supabase project
// so tracked history isn't lost.
//
// Usage:
//   DATABASE_URL=postgres://... npm run migrate-to-supabase
//   # or, for a non-default SQLite source:
//   TALLY_DB_PATH=./data/tally.db DATABASE_URL=postgres://... npm run migrate-to-supabase
//
// Safe to re-run: every insert is an upsert (ON CONFLICT DO UPDATE / DO
// NOTHING as appropriate), so running it twice against the same Postgres
// database won't duplicate rows. It does NOT touch or delete the SQLite file.

import Database from "better-sqlite3";
import path from "node:path";
import postgres from "postgres";

const SQLITE_PATH =
  process.env.TALLY_DB_PATH ||
  path.join(process.env.TALLY_DATA_DIR || path.join(process.cwd(), "data"), "tally.db");

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    console.error("Set DATABASE_URL to your Supabase Postgres connection string first.");
    process.exit(1);
  }

  console.log(`Reading SQLite store at ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const sql = postgres(databaseUrl, { ssl: "require" });

  try {
    // Ensure the schema exists (mirrors lib/db.ts's migrate()).
    await sql.file(path.join(__dirname, "..", "lib", "schema.sql"));

    const people = sqlite.prepare("SELECT * FROM people").all() as Array<{
      id: number;
      name: string;
      token: string;
      active: number;
    }>;
    for (const p of people) {
      await sql`
        INSERT INTO people (id, name, token, active) VALUES (${p.id}, ${p.name}, ${p.token}, ${!!p.active})
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, token = excluded.token, active = excluded.active
      `;
    }
    console.log(`people: ${people.length}`);

    const clients = sqlite.prepare("SELECT * FROM clients").all() as Array<{
      id: number;
      name: string;
      billable_rate: number;
      color: string | null;
      chrome_profile_dir: string | null;
      chrome_profile_name: string | null;
    }>;
    for (const c of clients) {
      await sql`
        INSERT INTO clients (id, name, billable_rate, color, chrome_profile_dir, chrome_profile_name)
        VALUES (${c.id}, ${c.name}, ${c.billable_rate}, ${c.color}, ${c.chrome_profile_dir}, ${c.chrome_profile_name})
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name, billable_rate = excluded.billable_rate, color = excluded.color,
          chrome_profile_dir = excluded.chrome_profile_dir, chrome_profile_name = excluded.chrome_profile_name
      `;
    }
    console.log(`clients: ${clients.length}`);

    const rules = sqlite.prepare("SELECT * FROM rules").all() as Array<{
      id: number;
      match_app: string | null;
      match_title: string | null;
      match_domain: string | null;
      match_profile: string | null;
      client_id: number | null;
      project: string | null;
      billable: number;
      priority: number;
    }>;
    for (const r of rules) {
      await sql`
        INSERT INTO rules (id, match_app, match_title, match_domain, match_profile, client_id, project, billable, priority)
        VALUES (${r.id}, ${r.match_app}, ${r.match_title}, ${r.match_domain}, ${r.match_profile},
                ${r.client_id}, ${r.project}, ${!!r.billable}, ${r.priority})
        ON CONFLICT (id) DO UPDATE SET
          match_app = excluded.match_app, match_title = excluded.match_title,
          match_domain = excluded.match_domain, match_profile = excluded.match_profile,
          client_id = excluded.client_id, project = excluded.project,
          billable = excluded.billable, priority = excluded.priority
      `;
    }
    console.log(`rules: ${rules.length}`);

    const activity = sqlite.prepare("SELECT * FROM daily_activity").all() as Array<{
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
    }>;
    for (const a of activity) {
      await sql`
        INSERT INTO daily_activity
          (person_id, day, client_id, app, activity, host, profile, billable, unassigned, seconds)
        VALUES (${a.person_id}, ${a.day}, ${a.client_id}, ${a.app}, ${a.activity}, ${a.host},
                ${a.profile}, ${!!a.billable}, ${!!a.unassigned}, ${a.seconds})
        ON CONFLICT (person_id, day, client_id, app, activity, host, profile, billable, unassigned)
        DO UPDATE SET seconds = excluded.seconds
      `;
    }
    console.log(`daily_activity: ${activity.length}`);

    const pushed = sqlite.prepare("SELECT * FROM pushed_events").all() as Array<{
      person_id: number;
      day: string;
      events_json: string;
      received_at: string;
    }>;
    for (const p of pushed) {
      await sql`
        INSERT INTO pushed_events (person_id, day, events_json, received_at)
        VALUES (${p.person_id}, ${p.day}, ${sql.json(JSON.parse(p.events_json))}, ${p.received_at})
        ON CONFLICT (person_id, day) DO UPDATE SET
          events_json = excluded.events_json, received_at = excluded.received_at
      `;
    }
    console.log(`pushed_events: ${pushed.length}`);

    const finalized = sqlite.prepare("SELECT * FROM day_finalized").all() as Array<{
      day: string;
      finalized_at: string;
    }>;
    for (const f of finalized) {
      await sql`
        INSERT INTO day_finalized (day, finalized_at) VALUES (${f.day}, ${f.finalized_at})
        ON CONFLICT (day) DO UPDATE SET finalized_at = excluded.finalized_at
      `;
    }
    console.log(`day_finalized: ${finalized.length}`);

    const cleanup = sqlite.prepare("SELECT * FROM cleanup_cache").all() as Array<{
      raw: string;
      kind: string;
      cleaned_label: string;
      is_per_client: number;
      suggested_domain: string | null;
      suggested_client_name: string | null;
      confidence: number;
      model: string;
      updated_at: string;
    }>;
    for (const c of cleanup) {
      await sql`
        INSERT INTO cleanup_cache
          (raw, kind, cleaned_label, is_per_client, suggested_domain, suggested_client_name, confidence, model, updated_at)
        VALUES (${c.raw}, ${c.kind}, ${c.cleaned_label}, ${!!c.is_per_client}, ${c.suggested_domain},
                ${c.suggested_client_name}, ${c.confidence}, ${c.model}, ${c.updated_at})
        ON CONFLICT (raw) DO UPDATE SET
          kind = excluded.kind, cleaned_label = excluded.cleaned_label, is_per_client = excluded.is_per_client,
          suggested_domain = excluded.suggested_domain, suggested_client_name = excluded.suggested_client_name,
          confidence = excluded.confidence, model = excluded.model, updated_at = excluded.updated_at
      `;
    }
    console.log(`cleanup_cache: ${cleanup.length}`);

    const settings = sqlite.prepare("SELECT * FROM app_settings").all() as Array<{
      key: string;
      value: string | null;
    }>;
    for (const s of settings) {
      await sql`
        INSERT INTO app_settings (key, value) VALUES (${s.key}, ${s.value})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `;
    }
    console.log(`app_settings: ${settings.length}`);

    // Bump the identity sequences past the migrated ids so future INSERTs
    // (which don't specify id) don't collide with the ids we just copied.
    for (const table of ["people", "clients", "rules"]) {
      await sql.unsafe(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
      );
    }

    console.log("Migration complete.");
  } finally {
    sqlite.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
