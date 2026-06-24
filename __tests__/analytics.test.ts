import { describe, expect, it } from "vitest";
import { categorizeAll } from "@/lib/categorize";
import { buildSummary } from "@/lib/analytics";
import { clients, rules, usage } from "./fixtures";

describe("buildSummary", () => {
  const events = [
    // Acme billable: 1h on Jira
    usage({
      url: "https://acme.atlassian.net/browse/ABC-1",
      duration: 3600,
      timestamp: "2026-06-23T09:00:00.000Z",
    }),
    // Globex billable: 30m on Monday
    usage({
      app: "chrome.exe",
      url: "https://globex.monday.com/boards/1",
      duration: 1800,
      timestamp: "2026-06-23T11:00:00.000Z",
    }),
    // Internal non-billable: 30m Outlook
    usage({
      app: "OUTLOOK.EXE",
      title: "Inbox",
      duration: 1800,
      timestamp: "2026-06-24T09:00:00.000Z",
    }),
    // Unassigned: 15m random site
    usage({
      url: "https://news.ycombinator.com",
      duration: 900,
      timestamp: "2026-06-24T10:00:00.000Z",
    }),
  ];

  const summary = buildSummary(categorizeAll(events, rules), clients);

  it("totals all active time", () => {
    // 3600 + 1800 + 1800 + 900 = 8100s = 2.25h
    expect(summary.totalHours).toBe(2.25);
  });

  it("splits billable vs non-billable correctly", () => {
    // billable = 3600 + 1800 = 5400s = 1.5h
    expect(summary.billableHours).toBe(1.5);
    // non-billable = 1800 + 900 = 2700s = 0.75h
    expect(summary.nonBillableHours).toBe(0.75);
  });

  it("counts unassigned time", () => {
    expect(summary.unassignedHours).toBe(0.25);
  });

  it("computes billable value from per-client rates", () => {
    // Acme: 1h * 150 = 150; Globex: 0.5h * 120 = 60; total 210
    expect(summary.billableAmount).toBe(210);
    const acme = summary.clients.find((c) => c.clientId === 2)!;
    expect(acme.amount).toBe(150);
    const globex = summary.clients.find((c) => c.clientId === 3)!;
    expect(globex.amount).toBe(60);
  });

  it("aggregates apps/sites with their dominant client", () => {
    const jira = summary.apps.find((a) => a.label === "acme.atlassian.net")!;
    expect(jira.topClient).toBe("Acme Corp");
    expect(jira.hours).toBe(1);
  });

  it("produces a sorted daily series", () => {
    expect(summary.daily.map((d) => d.date)).toEqual([
      "2026-06-23",
      "2026-06-24",
    ]);
    expect(summary.daily[0].billableHours).toBe(1.5); // both billables on the 23rd
    expect(summary.daily[1].nonBillableHours).toBe(0.75);
  });
});
