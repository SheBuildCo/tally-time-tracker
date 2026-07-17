// One-time import: copy a machine's local Tally SQLite store into the shared
// Supabase database, tagged with the person it belongs to.
//
// Usage:
//   DATABASE_URL=postgres://...  TALLY_PERSON_NAME="Oli"  \
//     npx tsx scripts/import-to-supabase.ts [path-to-tally.db]
//
// Defaults to %APPDATA%/tally/tally.db (the Electron app's data dir). Pass a
// backup file instead to import from a snapshot (recommended — the live file is
// being written to while the app runs).
//
// Idempotent: every insert upserts, so re-running reconciles rather than
// duplicating. Clients are matched BY NAME (not local id), because ids are
// per-machine autoincrement and only names are stable across the team.

import Database from "better-sqlite3";
import path from "node:path";
import postgres from "postgres";

const SRC =
  process.argv[2] ||
  path.join(process.env.APPDATA || "", "tally", "tally.db");
const PERSON = process.env.TALLY_PERSON_NAME;

/** Local uses NULL for "no client"; the shared schema uses -1 (PKs reject NULL). */
const NO_CLIENT = -1;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!PERSON) throw new Error("TALLY_PERSON_NAME is not set (whose data is this?)");

  console.log(`source : ${SRC}`);
  console.log(`person : ${PERSON}`);

  const lite = new Database(SRC, { readonly: true });
  const sql = postgres(url, { ssl: "require" });

  try {
    // 1. The person.
    const [person] = await sql<{ id: number }[]>`
      INSERT INTO people (name) VALUES (${PERSON})
      ON CONFLICT (name) DO UPDATE SET name = excluded.name
      RETURNING id
    `;
    const personId = person.id;
    console.log(`\nperson_id = ${personId}`);

    // 2. Clients, matched by name. Build local id -> shared id map.
    const localClients = lite
      .prepare("SELECT id, name, billable_rate, color FROM clients")
      .all() as Array<{ id: number; name: string; billable_rate: number; color: string }>;

    const clientIdMap = new Map<number, number>();
    for (const c of localClients) {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO clients (name, billable_rate, color)
        VALUES (${c.name}, ${c.billable_rate}, ${c.color})
        ON CONFLICT (name) DO UPDATE SET
          billable_rate = excluded.billable_rate, color = excluded.color
        RETURNING id
      `;
      clientIdMap.set(c.id, row.id);
    }
    console.log(`clients: ${localClients.length}`);

    /** Map a local client_id (possibly NULL) to the shared id / sentinel. */
    const mapClient = (id: number | null): number =>
      id === null ? NO_CLIENT : clientIdMap.get(id) ?? NO_CLIENT;

    // 3. Rules (local schema may have none).
    const localRules = lite
      .prepare("SELECT * FROM rules")
      .all() as Array<Record<string, unknown>>;
    for (const r of localRules) {
      await sql`
        INSERT INTO rules (match_app, match_title_regex, match_domain, client_id, billable, priority)
        VALUES (${r.match_app as string | null}, ${r.match_title_regex as string | null},
                ${r.match_domain as string | null},
                ${r.client_id === null ? null : clientIdMap.get(r.client_id as number) ?? null},
                ${!!r.billable}, ${r.priority as number})
      `;
    }
    console.log(`rules: ${localRules.length}`);

    // 4. Daily activity rollup.
    const activity = lite.prepare("SELECT * FROM daily_activity").all() as Array<{
      day: string;
      client_id: number | null;
      app: string;
      activity: string;
      host: string;
      billable: number;
      seconds: number;
    }>;
    for (const a of activity) {
      await sql`
        INSERT INTO daily_activity (person_id, day, client_id, app, activity, host, billable, seconds)
        VALUES (${personId}, ${a.day}, ${mapClient(a.client_id)}, ${a.app}, ${a.activity},
                ${a.host}, ${!!a.billable}, ${a.seconds})
        ON CONFLICT (person_id, day, client_id, app, activity, host)
        DO UPDATE SET seconds = excluded.seconds, billable = excluded.billable
      `;
    }
    console.log(`daily_activity: ${activity.length}`);

    // 5. Timer sessions (+ their exclusions and snapshots, which hang off the
    //    session's NEW id — local ids aren't reused).
    const sessions = lite.prepare("SELECT * FROM timer_sessions").all() as Array<{
      id: number;
      client_id: number;
      start_time: string;
      end_time: string | null;
      notes: string | null;
      created_at: string;
    }>;

    let exCount = 0;
    let snapCount = 0;
    for (const s of sessions) {
      const sharedClient = clientIdMap.get(s.client_id);
      if (!sharedClient) {
        console.warn(`  ! session ${s.id}: unknown client ${s.client_id}, skipped`);
        continue;
      }
      // Identify a session by (person, start_time) — stable across re-imports.
      const existing = await sql<{ id: number }[]>`
        SELECT id FROM timer_sessions WHERE person_id = ${personId} AND start_time = ${s.start_time}
      `;
      let sid: number;
      if (existing.length > 0) {
        sid = existing[0].id;
        await sql`
          UPDATE timer_sessions
          SET client_id = ${sharedClient}, end_time = ${s.end_time}, notes = ${s.notes}
          WHERE id = ${sid}
        `;
      } else {
        const [ins] = await sql<{ id: number }[]>`
          INSERT INTO timer_sessions (person_id, client_id, start_time, end_time, notes, created_at)
          VALUES (${personId}, ${sharedClient}, ${s.start_time}, ${s.end_time}, ${s.notes}, ${s.created_at})
          RETURNING id
        `;
        sid = ins.id;
      }

      // Replace children wholesale — simpler than diffing, and they're small.
      await sql`DELETE FROM session_exclusions WHERE session_id = ${sid}`;
      const exclusions = lite
        .prepare("SELECT app, host, activity FROM session_exclusions WHERE session_id = ?")
        .all(s.id) as Array<{ app: string; host: string; activity: string }>;
      for (const e of exclusions) {
        await sql`
          INSERT INTO session_exclusions (session_id, app, host, activity)
          VALUES (${sid}, ${e.app}, ${e.host}, ${e.activity})
        `;
        exCount++;
      }

      await sql`DELETE FROM session_activity_snapshot WHERE session_id = ${sid}`;
      const snaps = lite
        .prepare("SELECT app, host, activity, seconds FROM session_activity_snapshot WHERE session_id = ?")
        .all(s.id) as Array<{ app: string; host: string; activity: string; seconds: number }>;
      for (const sn of snaps) {
        await sql`
          INSERT INTO session_activity_snapshot (session_id, app, host, activity, seconds)
          VALUES (${sid}, ${sn.app}, ${sn.host}, ${sn.activity}, ${sn.seconds})
        `;
        snapCount++;
      }
    }
    console.log(`timer_sessions: ${sessions.length} (exclusions: ${exCount}, snapshots: ${snapCount})`);

    // 6. Finalized days.
    const days = lite.prepare("SELECT day FROM day_finalized").all() as Array<{ day: string }>;
    for (const d of days) {
      await sql`
        INSERT INTO day_finalized (person_id, day) VALUES (${personId}, ${d.day})
        ON CONFLICT (person_id, day) DO NOTHING
      `;
    }
    console.log(`day_finalized: ${days.length}`);

    console.log("\nImport complete.");
  } finally {
    lite.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nImport failed:", err.message);
  process.exit(1);
});
