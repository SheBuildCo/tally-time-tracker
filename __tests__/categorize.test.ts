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
  it("matches the Chrome profile case-insensitively", () => {
    expect(
      ruleMatches({ profile: "Acme Corp" }, usage({ profile: "acme corp" })),
    ).toBe(true);
  });
  it("fails a profile clause when the event has no profile", () => {
    expect(ruleMatches({ profile: "Acme Corp" }, usage({}))).toBe(false);
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

  it("a profile rule (p10) beats a domain rule (p50) for the same event", () => {
    // Same shared site, but the tab is running under Globex's Chrome profile.
    const withProfile = [
      ...rules,
      {
        id: 30,
        match: { profile: "Globex" },
        clientId: 3,
        project: null,
        billable: true,
        priority: 10,
      },
    ];
    const ev = usage({
      app: "chrome.exe",
      url: "https://acme.atlassian.net/x", // would otherwise map to Acme (id 2)
      profile: "Globex",
    });
    const c = categorize(ev, withProfile);
    expect(c.clientId).toBe(3);
    expect(c.matchedRuleId).toBe(30);
  });
});

describe("suggestRules", () => {
  it("surfaces unassigned sites as full-host suggestions, largest first", () => {
    const events = [
      usage({ url: "https://news.ycombinator.com/item?id=1", duration: 1200 }),
      usage({ url: "https://news.ycombinator.com/item?id=2", duration: 600 }),
      usage({ app: "slack.exe", url: undefined, duration: 300 }),
      // below threshold, should be dropped
      usage({ url: "https://example.org/x", duration: 2 }),
    ];
    const categorized = categorizeAll(events, rules);
    const suggestions = suggestRules(categorized);

    expect(suggestions[0].kind).toBe("site");
    expect(suggestions[0].label).toBe("news.ycombinator.com");
    // full host, not the collapsed registrable domain
    expect(suggestions[0].match.urlDomain).toBe("news.ycombinator.com");
    // slack app suggestion present, example.org dropped (under the 5s floor)
    expect(suggestions.some((s) => s.label === "slack.exe")).toBe(true);
    expect(suggestions.some((s) => s.label === "example.org")).toBe(false);
  });
});

describe("suggestRules with enrichment", () => {
  const events = [
    usage({ url: "https://maasgroup.looplogics.com/x", duration: 1200 }),
    usage({ url: "https://acme.looplogics.com/y", duration: 900 }),
    usage({ url: "https://app.asana.com/z", duration: 600 }),
  ];
  const categorized = categorizeAll(events, rules);

  const enrich = {
    get: (raw: string) => {
      if (raw === "maasgroup.looplogics.com")
        return {
          cleanedLabel: "MaasGroup — LoopLogics",
          isPerClientSubdomain: true,
          suggestedUrlDomain: "maasgroup.looplogics.com",
          suggestedClientName: "Acme Corp",
          confidence: 0.95,
        };
      if (raw === "acme.looplogics.com")
        return {
          cleanedLabel: "Acme — LoopLogics",
          isPerClientSubdomain: true,
          suggestedUrlDomain: "acme.looplogics.com",
          suggestedClientName: null,
          confidence: 0.6,
        };
      if (raw === "app.asana.com")
        return {
          cleanedLabel: "Asana",
          isPerClientSubdomain: false,
          suggestedUrlDomain: null,
          suggestedClientName: null,
          confidence: 0.2,
        };
      return undefined;
    },
  };

  it("keeps per-client subdomains as distinct full-host rules", () => {
    const s = suggestRules(categorized, 60, enrich);
    const maas = s.find((x) => x.label === "maasgroup.looplogics.com");
    const acme = s.find((x) => x.label === "acme.looplogics.com");
    expect(maas?.match.urlDomain).toBe("maasgroup.looplogics.com");
    expect(acme?.match.urlDomain).toBe("acme.looplogics.com");
    // two separate rules, not one collapsed looplogics.com
    expect(maas?.match.urlDomain).not.toBe(acme?.match.urlDomain);
    expect(maas?.cleanedLabel).toBe("MaasGroup — LoopLogics");
    expect(maas?.suggestedClientName).toBe("Acme Corp");
    expect(maas?.confidence).toBe(0.95);
  });

  it("matches the full host when the LLM gives no scoped domain", () => {
    const s = suggestRules(categorized, 60, enrich);
    const asana = s.find((x) => x.label === "app.asana.com");
    expect(asana?.match.urlDomain).toBe("app.asana.com");
  });

  it("without enrichment matches the full host (no collapse)", () => {
    const s = suggestRules(categorized, 60);
    const maas = s.find((x) => x.label === "maasgroup.looplogics.com");
    const acme = s.find((x) => x.label === "acme.looplogics.com");
    expect(maas?.match.urlDomain).toBe("maasgroup.looplogics.com");
    expect(acme?.match.urlDomain).toBe("acme.looplogics.com");
    expect(maas?.cleanedLabel).toBeUndefined();
  });

  it("per-client rules do not cross-match", () => {
    expect(
      hostMatchesDomain("maasgroup.looplogics.com", "maasgroup.looplogics.com"),
    ).toBe(true);
    expect(
      hostMatchesDomain("acme.looplogics.com", "maasgroup.looplogics.com"),
    ).toBe(false);
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
