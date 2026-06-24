import { describe, expect, it } from "vitest";
import { categorizeAll } from "@/lib/categorize";
import {
  buildClientDetail,
  buildDailyTotals,
  buildSummary,
} from "@/lib/analytics";
import { clients, rules, usage } from "./fixtures";

const events = [
  // Acme: two distinct Comet tabs (no URL) -> two activities, same client via title? No —
  // these are unassigned by title here; map via the Jira site instead:
  usage({
    url: "https://acme.atlassian.net/browse/ABC-1",
    title: "ABC-1 — Acme - Comet",
    duration: 3600,
    timestamp: "2026-06-23T09:00:00.000Z",
  }),
  usage({
    url: "https://acme.atlassian.net/browse/ABC-2",
    title: "ABC-2 — Acme - Comet",
    duration: 1800,
    timestamp: "2026-06-23T10:00:00.000Z",
  }),
  // Internal Outlook
  usage({
    app: "OUTLOOK.EXE",
    title: "Inbox",
    duration: 1800,
    timestamp: "2026-06-24T09:00:00.000Z",
  }),
];

const categorized = categorizeAll(events, rules);

describe("activities breakdown", () => {
  const summary = buildSummary(categorized, clients);

  it("groups by fine activity (cleaned title), keeping tabs distinct", () => {
    const labels = summary.activities.map((a) => a.label);
    expect(labels).toContain("ABC-1 — Acme");
    expect(labels).toContain("ABC-2 — Acme");
  });

  it("still rolls coarse apps by host", () => {
    const jira = summary.apps.find((a) => a.label === "acme.atlassian.net");
    expect(jira?.hours).toBe(1.5); // 3600 + 1800 = 5400s
  });
});

describe("buildClientDetail", () => {
  it("scopes the same breakdown to one client", () => {
    const acme = clients.find((c) => c.id === 2)!;
    const detail = buildClientDetail(categorized, acme);
    expect(detail.clientId).toBe(2);
    expect(detail.totalHours).toBe(1.5);
    expect(detail.billableHours).toBe(1.5);
    expect(detail.billableAmount).toBe(225); // 1.5h * 150
    // only Acme activities are present
    expect(detail.activities.every((a) => a.label.includes("Acme"))).toBe(true);
  });
});

describe("buildDailyTotals", () => {
  it("produces per-(day,client) rows, most recent first", () => {
    const rowsOut = buildDailyTotals(categorized, clients);
    // 23rd: Acme (1.5h); 24th: Internal (0.5h)
    const acme23 = rowsOut.find(
      (r) => r.date === "2026-06-23" && r.clientId === 2,
    )!;
    expect(acme23.hours).toBe(1.5);
    expect(acme23.amount).toBe(225);
    expect(rowsOut[0].date).toBe("2026-06-24"); // newest day first
  });
});
