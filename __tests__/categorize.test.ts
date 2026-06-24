import { describe, expect, it } from "vitest";
import {
  categorize,
  categorizeAll,
  hostMatchesDomain,
  hostOf,
  registrableDomain,
  ruleMatches,
  suggestRules,
} from "@/lib/categorize";
import { rules, usage } from "./fixtures";

describe("hostOf", () => {
  it("extracts the host from a full URL", () => {
    expect(hostOf("https://acme.atlassian.net/browse/ABC-1")).toBe(
      "acme.atlassian.net",
    );
  });
  it("handles schemeless hosts", () => {
    expect(hostOf("canva.com/design/123")).toBe("canva.com");
  });
  it("returns empty for undefined/garbage", () => {
    expect(hostOf(undefined)).toBe("");
    expect(hostOf("   ")).toBe("");
  });
});

describe("hostMatchesDomain", () => {
  it("matches exact and subdomains only", () => {
    expect(hostMatchesDomain("acme.atlassian.net", "atlassian.net")).toBe(true);
    expect(hostMatchesDomain("atlassian.net", "atlassian.net")).toBe(true);
    expect(hostMatchesDomain("notatlassian.net", "atlassian.net")).toBe(false);
  });
});

describe("ruleMatches", () => {
  it("never matches an empty clause", () => {
    expect(ruleMatches({}, usage({}))).toBe(false);
  });
  it("matches app case-insensitively", () => {
    expect(ruleMatches({ app: "outlook.exe" }, usage({ app: "OUTLOOK.EXE" }))).toBe(
      true,
    );
  });
  it("requires all present sub-conditions", () => {
    const ev = usage({ app: "chrome.exe", url: "https://acme.atlassian.net/x" });
    expect(ruleMatches({ app: "chrome.exe", urlDomain: "acme.atlassian.net" }, ev)).toBe(
      true,
    );
    expect(ruleMatches({ app: "firefox.exe", urlDomain: "acme.atlassian.net" }, ev)).toBe(
      false,
    );
  });
  it("treats a malformed title regex as non-matching, not throwing", () => {
    expect(ruleMatches({ titleRegex: "(" }, usage({ title: "anything" }))).toBe(
      false,
    );
  });
});

describe("categorize", () => {
  it("maps a client PM site to the right billable client", () => {
    const c = categorize(
      usage({ url: "https://acme.atlassian.net/browse/ABC-1" }),
      rules,
    );
    expect(c.clientId).toBe(2);
    expect(c.billable).toBe(true);
    expect(c.matchedRuleId).toBe(10);
  });

  it("maps a native app (Outlook) to internal non-billable", () => {
    const c = categorize(usage({ app: "OUTLOOK.EXE", title: "Inbox" }), rules);
    expect(c.clientId).toBe(1);
    expect(c.billable).toBe(false);
  });

  it("returns unassigned when nothing matches", () => {
    const c = categorize(usage({ url: "https://news.ycombinator.com" }), rules);
    expect(c.clientId).toBeNull();
    expect(c.matchedRuleId).toBeNull();
    expect(c.billable).toBe(false);
  });

  it("respects priority: client rule wins over a lower-priority internal one", () => {
    // A browser tab on a client site should beat any generic app rule.
    const ev = usage({
      app: "chrome.exe",
      url: "https://globex.monday.com/boards/1",
    });
    const c = categorize(ev, rules);
    expect(c.clientId).toBe(3);
    expect(c.billable).toBe(true);
  });
});

describe("suggestRules", () => {
  it("surfaces unassigned sites as domain suggestions, largest first", () => {
    const events = [
      usage({ url: "https://news.ycombinator.com/item?id=1", duration: 1200 }),
      usage({ url: "https://news.ycombinator.com/item?id=2", duration: 600 }),
      usage({ app: "slack.exe", url: undefined, duration: 300 }),
      // below threshold, should be dropped
      usage({ url: "https://example.org/x", duration: 10 }),
    ];
    const categorized = categorizeAll(events, rules);
    const suggestions = suggestRules(categorized, 60);

    expect(suggestions[0].kind).toBe("site");
    expect(suggestions[0].label).toBe("news.ycombinator.com");
    expect(suggestions[0].match.urlDomain).toBe("ycombinator.com");
    // slack app suggestion present, example.org dropped (under threshold)
    expect(suggestions.some((s) => s.label === "slack.exe")).toBe(true);
    expect(suggestions.some((s) => s.label === "example.org")).toBe(false);
  });
});

describe("registrableDomain", () => {
  it("reduces deep subdomains to the registrable domain", () => {
    expect(registrableDomain("app.asana.com")).toBe("asana.com");
    expect(registrableDomain("asana.com")).toBe("asana.com");
  });
  it("keeps three labels for known two-part TLDs", () => {
    expect(registrableDomain("foo.company.co.uk")).toBe("company.co.uk");
  });
});
