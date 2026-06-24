// Set a throwaway DB path BEFORE importing the db module (it reads the path at
// load time), so this test never touches the real data dir.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `tally-test-${process.pid}.db`);
process.env.TALLY_DB_PATH = TMP_DB;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { categorizeAll } from "@/lib/categorize";
import { buildSummary } from "@/lib/analytics";
import { rollup, rowsToCategorized } from "@/lib/ingest";
import {
  clearDayFinalized,
  getActivityRows,
  replaceDayActivity,
  isFinalized,
  markFinalized,
} from "@/lib/db";
import { clients, rules, usage } from "./fixtures";

function unlinkDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TMP_DB + ext);
    } catch {
      /* ignore */
    }
  }
}

// Guard against a stale temp DB from a previous run (pids can be reused).
beforeAll(unlinkDb);
afterAll(unlinkDb);

const events = [
  usage({
    url: "https://acme.atlassian.net/browse/ABC-1",
    title: "ABC-1 - Comet",
    duration: 3600,
    timestamp: "2026-06-23T09:00:00.000Z",
  }),
  usage({
    app: "OUTLOOK.EXE",
    title: "Inbox",
    duration: 1800,
    timestamp: "2026-06-23T10:00:00.000Z",
  }),
  usage({
    url: "https://news.ycombinator.com",
    title: "Hacker News",
    duration: 900,
    timestamp: "2026-06-23T11:00:00.000Z",
  }),
];
const categorized = categorizeAll(events, rules);

describe("rollup + reconstruct preserves analytics", () => {
  it("buildSummary on reconstructed rows matches the original", () => {
    const rows = rollup(categorized);
    const reconstructed = rowsToCategorized(rows);

    const a = buildSummary(categorized, clients);
    const b = buildSummary(reconstructed, clients);

    expect(b.totalHours).toBe(a.totalHours);
    expect(b.billableHours).toBe(a.billableHours);
    expect(b.unassignedHours).toBe(a.unassignedHours);
    expect(b.billableAmount).toBe(a.billableAmount);
  });
});

describe("daily_activity persistence round-trip", () => {
  it("stores and returns a day's rollup", () => {
    const day = "2026-06-23";
    const rows = rollup(categorized);
    replaceDayActivity(day, rows);

    const back = getActivityRows(day, day);
    const totalSeconds = back.reduce((s, r) => s + r.seconds, 0);
    expect(totalSeconds).toBe(3600 + 1800 + 900);

    // unassigned flag preserved for the Hacker News row
    const hn = back.find((r) => r.activity === "Hacker News");
    expect(hn?.unassigned).toBe(true);

    // replacing the day doesn't duplicate rows
    replaceDayActivity(day, rows);
    expect(getActivityRows(day, day).length).toBe(back.length);
  });

  it("finalization flag works", () => {
    clearDayFinalized("2026-06-23"); // deterministic regardless of prior state
    expect(isFinalized("2026-06-23")).toBe(false);
    markFinalized("2026-06-23", "2026-06-24T00:00:00.000Z");
    expect(isFinalized("2026-06-23")).toBe(true);
  });
});
