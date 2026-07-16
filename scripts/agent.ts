// Tally push agent — runs on each employee machine (not the central server).
//
// Reads the machine's OWN local ActivityWatch and POSTs each recent day's
// events to the central Tally server, which categorizes + rolls them up against
// the shared rules. This is the only thing an employee machine runs; there's no
// local database, build, or dashboard. Run via `npm run agent`.
//
// Config (env, or a per-machine file the launcher sources):
//   TALLY_CENTRAL_URL     required, e.g. https://tally.example.com
//   TALLY_PERSON_TOKEN    required, this machine's person token (from an admin)
//   AW_BASE_URL           optional, default http://localhost:5600
//   TALLY_SYNC_DAYS       optional, how many trailing days to push (default 2 —
//                         today plus yesterday, to catch a day that rolled over)
//   TALLY_SYNC_INTERVAL_SEC optional, seconds between syncs (default 300)
//
// Reuses lib/activitywatch (AQL query + AFK/idle stitching) so capture behaves
// exactly as it did in the local app. Imports nothing that touches the DB.

import { getUsageEvents, ActivityWatchError, type DateRange } from "../lib/activitywatch";

const CENTRAL_URL = (process.env.TALLY_CENTRAL_URL || "").replace(/\/$/, "");
const TOKEN = process.env.TALLY_PERSON_TOKEN || "";
const SYNC_DAYS = Math.max(1, Number(process.env.TALLY_SYNC_DAYS) || 2);
const INTERVAL_MS =
  Math.max(30, Number(process.env.TALLY_SYNC_INTERVAL_SEC) || 300) * 1000;

function log(msg: string): void {
  // Timestamped so the launcher's log file is readable.
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Trailing UTC day strings (YYYY-MM-DD), oldest first, ending today. */
function recentDays(count: number): string[] {
  const todayMs = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(todayMs - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** The [start, end) UTC range covering a single day. */
function dayRange(day: string): DateRange {
  const start = new Date(`${day}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

async function pushDay(day: string): Promise<void> {
  const events = await getUsageEvents(dayRange(day)); // throws if AW unreachable
  const res = await fetch(`${CENTRAL_URL}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, day, events }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ingest ${res.status}: ${body.slice(0, 200)}`);
  }
  const result = (await res.json().catch(() => ({}))) as { rows?: number };
  log(`pushed ${day}: ${events.length} events -> ${result.rows ?? "?"} rows`);
}

async function syncOnce(): Promise<void> {
  for (const day of recentDays(SYNC_DAYS)) {
    try {
      await pushDay(day);
    } catch (err) {
      if (err instanceof ActivityWatchError) {
        log(`ActivityWatch not reachable — will retry next cycle (${err.message})`);
        return; // AW down: stop this cycle, keep the loop alive
      }
      log(`push failed for ${day}: ${(err as Error).message}`);
      // keep going to the next day
    }
  }
}

async function main(): Promise<void> {
  if (!CENTRAL_URL || !TOKEN) {
    log("ERROR: TALLY_CENTRAL_URL and TALLY_PERSON_TOKEN must be set. Exiting.");
    process.exit(1);
  }
  log(`Tally agent starting → ${CENTRAL_URL} (every ${INTERVAL_MS / 1000}s, ${SYNC_DAYS}d)`);
  await syncOnce();
  setInterval(() => {
    void syncOnce();
  }, INTERVAL_MS);
}

void main();
