import { describe, expect, it } from "vitest";
import { extractProfile, stitchUsage } from "@/lib/activitywatch";
import { awEvent } from "./fixtures";

describe("extractProfile", () => {
  it("pulls the profile segment before the browser suffix", () => {
    expect(extractProfile("Inbox - Acme Corp - Google Chrome")).toBe("Acme Corp");
  });
  it("returns undefined for a single-profile title (no profile segment)", () => {
    expect(extractProfile("Some Page - Google Chrome")).toBeUndefined();
  });
  it("returns undefined for non-Chrome two-segment titles", () => {
    expect(extractProfile("New Tab - Comet")).toBeUndefined();
  });
  it("takes the second-to-last segment when the page title has dashes", () => {
    expect(
      extractProfile("Re: Q3 - notes - Acme Client - Google Chrome"),
    ).toBe("Acme Client");
  });
  it("returns undefined for empty/garbage", () => {
    expect(extractProfile("")).toBeUndefined();
    expect(extractProfile(undefined)).toBeUndefined();
  });
});

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

  it("leaves non-browser apps without a URL and passes them through", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        app: "OUTLOOK.EXE",
        title: "Inbox",
      }),
    ];
    const out = stitchUsage(windows, [], browserApps);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBeUndefined();
    expect(out[0].app).toBe("OUTLOOK.EXE");
    expect(out[0].title).toBe("Inbox");
    expect(out[0].duration).toBe(600);
  });

  it("splits one browser window slice across the tabs it overlaps", () => {
    // A single window slice (the window query merges by app+title, so multiple
    // tabs can collapse into one generic slice) overlapping two distinct tabs.
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        app: "chrome.exe",
        title: "switching", // stale/generic OS window title
      }),
    ];
    const web = [
      // 2 min overlap at the start (08:59–09:02 ∩ 09:00–09:10 = 09:00–09:02)
      awEvent("2026-06-23T08:59:00.000Z", 180, {
        url: "https://a.example.com",
        title: "A",
      }),
      // 8 min overlap for the rest (09:02–09:10)
      awEvent("2026-06-23T09:02:00.000Z", 480, {
        url: "https://b.example.com",
        title: "B",
      }),
    ];
    const out = stitchUsage(windows, web, browserApps);
    expect(out).toHaveLength(2);

    // Per-tab title comes from the extension, not the window title.
    expect(out.map((e) => e.title)).toEqual(["A", "B"]);
    expect(out[0].url).toBe("https://a.example.com");
    expect(out[1].url).toBe("https://b.example.com");

    // Durations reflect the actual overlap with each tab.
    expect(out[0].duration).toBe(120);
    expect(out[1].duration).toBe(480);

    // Each activity starts when that tab became active within the slice.
    expect(out[0].timestamp).toBe("2026-06-23T09:00:00.000Z");
    expect(out[1].timestamp).toBe("2026-06-23T09:02:00.000Z");
  });

  it("prefers the extension's tab title over the window title", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 300, {
        app: "comet.exe",
        title: "New Tab", // generic Comet window title
      }),
    ];
    const web = [
      awEvent("2026-06-23T09:00:00.000Z", 300, {
        url: "https://github.com/shebuildco/tally-app/pull/1",
        title: "Fix tab accuracy by #1",
      }),
    ];
    const out = stitchUsage(windows, web, new Set(["comet.exe"]));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Fix tab accuracy by #1");
    expect(out[0].url).toBe("https://github.com/shebuildco/tally-app/pull/1");
  });

  it("falls back to the window title when a browser slice has no web data", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 300, {
        app: "chrome.exe",
        title: "Some Page — Google Chrome",
      }),
    ];
    const out = stitchUsage(windows, [], browserApps);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Some Page — Google Chrome");
    expect(out[0].url).toBeUndefined();
    expect(out[0].duration).toBe(300);
  });

  it("stamps the window's profile onto every tab, though tab titles lack it", () => {
    // The profile lives only in the OS window title; the extension's per-tab
    // titles don't carry it. Both derived events must still get the profile.
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 600, {
        app: "chrome.exe",
        title: "Dashboard - Acme Corp - Google Chrome",
      }),
    ];
    const web = [
      awEvent("2026-06-23T09:00:00.000Z", 300, {
        url: "https://a.example.com",
        title: "A",
      }),
      awEvent("2026-06-23T09:05:00.000Z", 300, {
        url: "https://b.example.com",
        title: "B",
      }),
    ];
    const out = stitchUsage(windows, web, browserApps);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.profile)).toEqual(["Acme Corp", "Acme Corp"]);
  });

  it("stamps the profile on the no-web passthrough branch too", () => {
    const windows = [
      awEvent("2026-06-23T09:00:00.000Z", 300, {
        app: "chrome.exe",
        title: "Some Page - Acme Corp - Google Chrome",
      }),
    ];
    const out = stitchUsage(windows, [], browserApps);
    expect(out[0].profile).toBe("Acme Corp");
  });
});
