// Use a throwaway DB before importing anything that opens it.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `tally-cleanup-${process.pid}.db`);
process.env.TALLY_DB_PATH = TMP_DB;

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Categorized } from "@/lib/types";
import type { EnrichedItem } from "@/lib/enrich";

// Mock the network + re-ingest seams; the real SQLite DB drives rules/cache.
const { mockEnrich, mockGetRangeRows, mockRowsToCategorized } = vi.hoisted(
  () => ({
    mockEnrich: vi.fn(),
    mockGetRangeRows: vi.fn(async () => ({ rows: [], trackerAvailable: true })),
    mockRowsToCategorized: vi.fn(),
  }),
);

vi.mock("@/lib/enrich", () => ({
  ENRICH_MODEL: "claude-sonnet-4-6",
  enrichDistinct: mockEnrich,
}));
vi.mock("@/lib/ingest", () => ({
  getRangeRows: mockGetRangeRows,
  rowsToCategorized: mockRowsToCategorized,
}));
vi.mock("@/lib/report", () => ({
  buildReport: vi.fn(async () => ({ suggestions: [] })),
}));

import { runCleanup } from "@/lib/cleanup";
import {
  clearCleanupCache,
  createClient,
  listRules,
  listClients,
} from "@/lib/db";

function unlinkDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TMP_DB + ext);
    } catch {
      /* ignore */
    }
  }
}

function site(url: string, duration: number): Categorized {
  return {
    event: { app: "comet.exe", title: "Dashboard", url, duration, timestamp: "2026-06-25T09:00:00.000Z" },
    clientId: null,
    project: null,
    billable: false,
    matchedRuleId: null, // unassigned
  };
}

const CATEGORIZED: Categorized[] = [
  site("maasgroup.looplogics.com", 1200),
  site("acme.looplogics.com", 900),
];

const ENRICHED: EnrichedItem[] = [
  {
    raw: "maasgroup.looplogics.com",
    kind: "site",
    cleanedLabel: "MaasGroup — LoopLogics",
    isPerClientSubdomain: true,
    suggestedUrlDomain: "maasgroup.looplogics.com",
    suggestedClientName: "MaasGroup",
    confidence: 0.95, // auto-apply
  },
  {
    raw: "acme.looplogics.com",
    kind: "site",
    cleanedLabel: "Acme — LoopLogics",
    isPerClientSubdomain: true,
    suggestedUrlDomain: "acme.looplogics.com",
    suggestedClientName: "Acme",
    confidence: 0.6, // below threshold — no rule
  },
];

beforeAll(() => {
  unlinkDb();
  createClient("MaasGroup", 150);
  createClient("Acme", 120);
});
afterAll(unlinkDb);

beforeEach(() => {
  vi.clearAllMocks();
  clearCleanupCache();
  mockGetRangeRows.mockResolvedValue({ rows: [], trackerAvailable: true });
  mockRowsToCategorized.mockReturnValue(CATEGORIZED);
  mockEnrich.mockResolvedValue(ENRICHED);
});

describe("runCleanup", () => {
  it("auto-applies only high-confidence attributions and caches all", async () => {
    const result = await runCleanup(7);

    // both distinct sites were sent to the model (nothing cached yet)
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockEnrich.mock.calls[0][0]).toHaveLength(2);

    expect(result.cleaned).toBe(2);
    expect(result.rulesCreated).toBe(1);

    const maasId = listClients().find((c) => c.name === "MaasGroup")!.id;
    const rules = listRules();
    const maasRule = rules.find(
      (r) => r.match.urlDomain === "maasgroup.looplogics.com",
    );
    expect(maasRule?.clientId).toBe(maasId);
    expect(maasRule?.billable).toBe(true);
    // low-confidence acme NOT auto-applied
    expect(
      rules.some((r) => r.match.urlDomain === "acme.looplogics.com"),
    ).toBe(false);
  });

  it("does not re-send cached strings and creates no duplicate rule", async () => {
    await runCleanup(7); // populate cache + create maas rule
    vi.clearAllMocks();
    mockGetRangeRows.mockResolvedValue({ rows: [], trackerAvailable: true });
    mockRowsToCategorized.mockReturnValue(CATEGORIZED);
    mockEnrich.mockResolvedValue(ENRICHED);

    const result = await runCleanup(7); // everything already cached

    expect(mockEnrich).not.toHaveBeenCalled(); // nothing new to clean
    expect(result.rulesCreated).toBe(0);
    const maasRules = listRules().filter(
      (r) => r.match.urlDomain === "maasgroup.looplogics.com",
    );
    expect(maasRules.length).toBe(1); // no duplicate
  });

  it("force re-cleans even when cached", async () => {
    await runCleanup(7);
    vi.clearAllMocks();
    mockGetRangeRows.mockResolvedValue({ rows: [], trackerAvailable: true });
    mockRowsToCategorized.mockReturnValue(CATEGORIZED);
    mockEnrich.mockResolvedValue(ENRICHED);

    await runCleanup(7, { force: true });
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockEnrich.mock.calls[0][0]).toHaveLength(2);
  });
});
