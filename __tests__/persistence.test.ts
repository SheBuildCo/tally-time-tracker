// These suites exercise the real persistence layer, so they need a Postgres
// database. Point TEST_DATABASE_URL at a THROWAWAY Supabase project (or any
// scratch Postgres) — never the shared team database: the tests write and
// delete rows. Without it, the db-backed suites skip and the pure ones (rollup
// / analytics round-trip) still run.
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (TEST_DB_URL) process.env.DATABASE_URL = TEST_DB_URL;

import { afterAll, describe, expect, it } from "vitest";
import { categorizeAll } from "@/lib/categorize";
import { buildSummary } from "@/lib/analytics";
import { rollup, rowsToCategorized } from "@/lib/ingest";
import {
  clearCleanupCache,
  clearDayFinalized,
  getActivityRows,
  getCleanupCache,
  getCleanupFor,
  getSetting,
  replaceDayActivity,
  isFinalized,
  markFinalized,
  setSetting,
  upsertCleanup,
  _resetConnectionForTests,
  type CleanupRow,
} from "@/lib/db";
import { clients, rules, usage } from "./fixtures";

// Skip the db-backed suites (rather than fail) when no test database is
// configured, so `npm test` is still useful on a fresh checkout.
const dbDescribe = TEST_DB_URL ? describe : describe.skip;

afterAll(async () => {
  if (TEST_DB_URL) await _resetConnectionForTests();
});

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
    const rows = rollup(1, categorized);
    const reconstructed = rowsToCategorized(rows);

    const a = buildSummary(categorized, clients);
    const b = buildSummary(reconstructed, clients);

    expect(b.totalHours).toBe(a.totalHours);
    expect(b.billableHours).toBe(a.billableHours);
    expect(b.unassignedHours).toBe(a.unassignedHours);
    expect(b.billableAmount).toBe(a.billableAmount);
  });
});

dbDescribe("daily_activity persistence round-trip", () => {
  it("stores and returns a day's rollup", async () => {
    const day = "2026-06-23";
    const rows = rollup(1, categorized);
    await replaceDayActivity(1, day, rows);

    const back = await getActivityRows(day, day);
    const totalSeconds = back.reduce((s, r) => s + r.seconds, 0);
    expect(totalSeconds).toBe(3600 + 1800 + 900);

    // unassigned flag preserved for the Hacker News row
    const hn = back.find((r) => r.activity === "Hacker News");
    expect(hn?.unassigned).toBe(true);

    // replacing the day doesn't duplicate rows
    await replaceDayActivity(1, day, rows);
    expect((await getActivityRows(day, day)).length).toBe(back.length);
  });

  it("finalization flag works", async () => {
    await clearDayFinalized("2026-06-23"); // deterministic regardless of prior state
    expect(await isFinalized("2026-06-23")).toBe(false);
    await markFinalized("2026-06-23", "2026-06-24T00:00:00.000Z");
    expect(await isFinalized("2026-06-23")).toBe(true);
  });

  // Regression: the rollup groups by host, so two activities with the same
  // cleaned title on different domains are distinct rows. host must be part of
  // the storage key or the second INSERT hits a UNIQUE-constraint collision.
  it("persists same-title activities on different hosts without collision", async () => {
    const day = "2026-06-22";
    const sameTitle = [
      usage({
        url: "https://app.foo.com/x",
        title: "Dashboard",
        duration: 600,
        timestamp: `${day}T09:00:00.000Z`,
      }),
      usage({
        url: "https://app.bar.com/y",
        title: "Dashboard",
        duration: 1200,
        timestamp: `${day}T10:00:00.000Z`,
      }),
    ];
    const rows = rollup(1, categorizeAll(sameTitle, rules));
    expect(rows.length).toBe(2); // distinct by host

    await expect(replaceDayActivity(1, day, rows)).resolves.not.toThrow();
    const back = await getActivityRows(day, day);
    expect(back.length).toBe(2);
    expect(new Set(back.map((r) => r.host)).size).toBe(2);
    expect(back.reduce((s, r) => s + r.seconds, 0)).toBe(1800);
  });

  // The Chrome profile is part of the rollup key, so the same activity under two
  // different profiles stays distinct (and round-trips through storage).
  it("keeps same activity under different profiles distinct, preserving profile", async () => {
    const day = "2026-06-21";
    const sameSite = [
      usage({
        url: "https://www.primeeco.tech/x",
        title: "Prime",
        profile: "Acme Corp",
        duration: 600,
        timestamp: `${day}T09:00:00.000Z`,
      }),
      usage({
        url: "https://www.primeeco.tech/x",
        title: "Prime",
        profile: "Globex",
        duration: 1200,
        timestamp: `${day}T10:00:00.000Z`,
      }),
    ];
    const rows = rollup(1, categorizeAll(sameSite, rules));
    expect(rows.length).toBe(2); // distinct by profile

    await replaceDayActivity(1, day, rows);
    const back = await getActivityRows(day, day);
    expect(back.length).toBe(2);
    expect(new Set(back.map((r) => r.profile))).toEqual(
      new Set(["Acme Corp", "Globex"]),
    );

    // rowsToCategorized restores the profile onto the synthetic event.
    expect(new Set(rowsToCategorized(back).map((c) => c.event.profile))).toEqual(
      new Set(["Acme Corp", "Globex"]),
    );
  });
});

// The whole point of the shared-instance model: two teammates' identical days
// must NOT collide, and one person's sync must NOT wipe another's rows.
dbDescribe("multi-person: no collision, no cross-user wipe", () => {
  it("keeps two people's identical day separate and sums for the team", async () => {
    const day = "2026-05-10";
    // Byte-identical activity for two different people — same client, app, title.
    const sameActivity = () =>
      rollup(
        0, // personId overwritten per person below
        categorizeAll(
          [
            usage({
              app: "OUTLOOK.EXE",
              title: "Inbox",
              duration: 1800,
              timestamp: `${day}T09:00:00.000Z`,
            }),
          ],
          rules,
        ),
      );

    // Person 1 syncs first, then person 2 syncs the SAME day.
    await replaceDayActivity(1, day, rollup(1, categorizeAll([
      usage({ app: "OUTLOOK.EXE", title: "Inbox", duration: 1800, timestamp: `${day}T09:00:00.000Z` }),
    ], rules)));
    await replaceDayActivity(2, day, rollup(2, categorizeAll([
      usage({ app: "OUTLOOK.EXE", title: "Inbox", duration: 3600, timestamp: `${day}T09:00:00.000Z` }),
    ], rules)));

    // Person 1's row survived person 2's sync (no cross-user DELETE-by-day wipe).
    const p1 = await getActivityRows(day, day, 1);
    const p2 = await getActivityRows(day, day, 2);
    expect(p1.reduce((s, r) => s + r.seconds, 0)).toBe(1800);
    expect(p2.reduce((s, r) => s + r.seconds, 0)).toBe(3600);

    // Team view (no personId) sums both, and analytics agrees.
    const team = await getActivityRows(day, day);
    expect(team.reduce((s, r) => s + r.seconds, 0)).toBe(1800 + 3600);
    const summary = buildSummary(rowsToCategorized(team), clients);
    expect(summary.totalHours).toBe((1800 + 3600) / 3600);

    // Re-syncing person 1 replaces only their rows, leaving person 2 intact.
    await replaceDayActivity(1, day, sameActivity().map((r) => ({ ...r, personId: 1 })));
    expect((await getActivityRows(day, day, 2)).reduce((s, r) => s + r.seconds, 0)).toBe(3600);
  });
});

dbDescribe("cleanup_cache persistence", () => {
  const MODEL = "claude-sonnet-4-6";
  const row = (over: Partial<CleanupRow> = {}): CleanupRow => ({
    raw: "maasgroup.looplogics.com",
    kind: "site",
    cleanedLabel: "MaasGroup — LoopLogics",
    isPerClient: true,
    suggestedDomain: "maasgroup.looplogics.com",
    suggestedClientName: "MaasGroup",
    confidence: 0.95,
    model: MODEL,
    ...over,
  });

  it("round-trips and overwrites on conflict", async () => {
    await clearCleanupCache();
    await upsertCleanup([row()], "2026-06-25T00:00:00.000Z");
    let cache = await getCleanupCache(MODEL);
    expect(cache.get("maasgroup.looplogics.com")?.confidence).toBe(0.95);

    // ON CONFLICT overwrite
    await upsertCleanup(
      [row({ confidence: 0.4, cleanedLabel: "changed" })],
      "2026-06-25T01:00:00.000Z",
    );
    cache = await getCleanupCache(MODEL);
    expect(cache.size).toBe(1);
    expect(cache.get("maasgroup.looplogics.com")?.confidence).toBe(0.4);
    expect(cache.get("maasgroup.looplogics.com")?.cleanedLabel).toBe("changed");
  });

  it("filters by model and supports getCleanupFor + clear", async () => {
    await clearCleanupCache();
    await upsertCleanup(
      [row(), row({ raw: "old.host", model: "claude-haiku-4-5" })],
      "2026-06-25T00:00:00.000Z",
    );
    expect((await getCleanupCache(MODEL)).size).toBe(1); // other-model row excluded

    const subset = await getCleanupFor(
      ["maasgroup.looplogics.com", "missing"],
      MODEL,
    );
    expect(subset.has("maasgroup.looplogics.com")).toBe(true);
    expect(subset.has("missing")).toBe(false);

    await clearCleanupCache();
    expect((await getCleanupCache(MODEL)).size).toBe(0);
  });
});

dbDescribe("app_settings key/value", () => {
  it("stores, overwrites and clears a setting", async () => {
    expect(await getSetting("anthropic_api_key")).toBeNull();
    await setSetting("anthropic_api_key", "sk-ant-1");
    expect(await getSetting("anthropic_api_key")).toBe("sk-ant-1");
    await setSetting("anthropic_api_key", "sk-ant-2");
    expect(await getSetting("anthropic_api_key")).toBe("sk-ant-2");
    await setSetting("anthropic_api_key", null);
    expect(await getSetting("anthropic_api_key")).toBeNull();
  });
});
