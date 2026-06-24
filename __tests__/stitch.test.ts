import { describe, expect, it } from "vitest";
import { stitchUsage } from "@/lib/activitywatch";
import { awEvent } from "./fixtures";

describe("stitchUsage", () => {
  const browserApps = new Set(["chrome.exe"]);

  it("attaches the overlapping browser URL to a browser window slice", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        app: "chrome.exe",
        title: "Acme — Jira",
      }),
    ];
    const web = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        url: "https://acme.atlassian.net/browse/ABC-1",
        title: "Acme — Jira",
      }),
    ];
    const out = stitchUsage(windows, web, browserApps);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://acme.atlassian.net/browse/ABC-1");
  });

  it("leaves non-browser apps without a URL", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        app: "OUTLOOK.EXE",
        title: "Inbox",
      }),
    ];
    const out = stitchUsage(windows, [], browserApps);
    expect(out[0].url).toBeUndefined();
    expect(out[0].app).toBe("OUTLOOK.EXE");
  });

  it("chooses the browser tab with the greatest overlap", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        app: "chrome.exe",
        title: "switching",
      }),
    ];
    const web = [
      // 2 min overlap at the start
      awEvent("2026-06-23T08:59:00.000Z", 180, {
        url: "https://a.example.com",
        title: "A",
      }),
      // 8 min overlap for the rest
      awEvent("2026-06-23T09:02:00.000Z", 480, {
        url: "https://b.example.com",
        title: "B",
      }),
    ];
    const out = stitchUsage(windows, web, browserApps);
    expect(out[0].url).toBe("https://b.example.com");
  });
});
