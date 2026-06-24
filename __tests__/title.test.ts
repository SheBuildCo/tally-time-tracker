import { describe, expect, it } from "vitest";
import {
  activityLabel,
  appLabel,
  cleanTitle,
  categorizeAll,
  isBrowserApp,
  suggestRules,
} from "@/lib/categorize";
import { rules, usage } from "./fixtures";

describe("cleanTitle", () => {
  it("strips a trailing browser suffix (Comet)", () => {
    expect(cleanTitle("Inbox - me@co.com - Comet")).toBe("Inbox - me@co.com");
  });
  it("strips Teams chrome with pipe separators", () => {
    expect(cleanTitle("Chat | Jane Smith | Microsoft Teams")).toBe(
      "Chat | Jane Smith",
    );
  });
  it("strips a leading unread count (and known browser suffix)", () => {
    expect(cleanTitle("(3) Slack - Comet")).toBe("Slack");
  });
  it("keeps non-browser trailing segments intact", () => {
    // "Acme" isn't a browser/app name, so it's preserved.
    expect(cleanTitle("Slack - Acme")).toBe("Slack - Acme");
  });
  it("returns empty for blank titles", () => {
    expect(cleanTitle("")).toBe("");
    expect(cleanTitle(undefined)).toBe("");
  });
});

describe("isBrowserApp", () => {
  it("recognises Comet and common browsers, case-insensitively", () => {
    expect(isBrowserApp("Comet.exe")).toBe(true);
    expect(isBrowserApp("chrome.exe")).toBe(true);
    expect(isBrowserApp("OUTLOOK.EXE")).toBe(false);
  });
});

describe("labels", () => {
  it("appLabel is coarse (host or app)", () => {
    expect(appLabel(usage({ app: "comet.exe", title: "Chat | Jane | Comet" }))).toBe(
      "comet.exe",
    );
    expect(
      appLabel(usage({ app: "comet.exe", url: "https://acme.atlassian.net/x" })),
    ).toBe("acme.atlassian.net");
  });
  it("activityLabel is fine (cleaned title preferred)", () => {
    expect(
      activityLabel(usage({ app: "comet.exe", title: "Chat | Jane Smith | Comet" })),
    ).toBe("Chat | Jane Smith");
  });
  it("activityLabel falls back to host then app when no title", () => {
    expect(
      activityLabel(usage({ app: "comet.exe", title: "", url: "https://x.io/a" })),
    ).toBe("x.io");
    expect(activityLabel(usage({ app: "code.exe", title: "" }))).toBe("code.exe");
  });
});

describe("suggestRules with titles (Comet, no URL)", () => {
  it("suggests a titleRegex rule for browser tabs without a URL", () => {
    const events = [
      usage({
        app: "comet.exe",
        title: "Acme board | Monday - Comet",
        url: undefined,
        duration: 1200,
      }),
      usage({
        app: "comet.exe",
        title: "Acme board | Monday - Comet",
        url: undefined,
        duration: 600,
      }),
    ];
    const categorized = categorizeAll(events, rules);
    const suggestions = suggestRules(categorized, 60);
    const top = suggestions[0];
    expect(top.kind).toBe("title");
    expect(top.label).toBe("Acme board | Monday");
    // titleRegex should be an escaped literal that matches the original title
    const re = new RegExp(top.match.titleRegex!, "i");
    expect(re.test("Acme board | Monday - Comet")).toBe(true);
  });
});
