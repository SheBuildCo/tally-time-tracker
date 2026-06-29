// Mapping engine: turn raw usage into client/project/billable attributions.
//
// This is the piece ActivityWatch does not provide. A MappingRule matches on the
// app name, window title (regex) and/or the active tab's URL domain, and rolls the
// time up to a client/project with a billable flag. Rules are evaluated by
// ascending `priority`; the first match wins.

import type {
  Categorized,
  MappingRule,
  RuleMatch,
  UsageEvent,
} from "./types";

/** Extract the lowercased host from a URL, or "" if it isn't parseable. */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    // AW sometimes stores hosts without a scheme; try prefixing.
    try {
      return new URL(`https://${url}`).host.toLowerCase();
    } catch {
      return "";
    }
  }
}

/** A host matches a domain if it equals it or is a subdomain of it. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase().replace(/^\*\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/** Escape a string so it can be embedded literally in a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Chromium/Gecko browser executables we recognise. Comet (the user's browser) is
 * included so its tab activity is treated like any other browser. Matching is
 * case-insensitive against the window watcher's `app` field.
 */
export const BROWSER_APPS = new Set([
  "comet.exe",
  "comet",
  "chrome.exe",
  "google chrome",
  "msedge.exe",
  "microsoft edge",
  "firefox.exe",
  "firefox",
  "brave.exe",
  "brave",
  "opera.exe",
  "opera",
  "vivaldi.exe",
  "vivaldi",
  "arc.exe",
  "arc",
]);

export function isBrowserApp(app: string): boolean {
  return BROWSER_APPS.has(app.toLowerCase());
}

/**
 * Browser/app name fragments that appear as a trailing segment of a window title
 * (e.g. "Inbox - me@co - Comet", "Chat | Jane | Microsoft Teams"). Stripped by
 * `cleanTitle` so the remaining text is the actual tab/document/chat.
 */
export const TITLE_SUFFIXES = [
  "Comet",
  "Google Chrome",
  "Chromium",
  "Microsoft Edge",
  "Mozilla Firefox",
  "Firefox",
  "Brave",
  "Opera",
  "Vivaldi",
  "Arc",
  "Microsoft Teams",
  "Microsoft​ Teams", // teams sometimes uses a zero-width space
];

/**
 * Turn a raw window title into a readable activity label: drop leading unread
 * counts like "(3) " and any trailing " - <browser>" / " | <app>" chrome, so we
 * keep the specific tab/chat/document the user was actually in.
 */
export function cleanTitle(title: string | undefined): string {
  let t = (title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.replace(/^\(\d+\)\s*/, ""); // leading unread count
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of TITLE_SUFFIXES) {
      const re = new RegExp(`\\s*[-—|]\\s*${escapeRegExp(suffix)}\\s*$`, "i");
      if (re.test(t)) {
        t = t.replace(re, "").trim();
        changed = true;
      }
    }
  }
  return t.trim();
}

/** Does a single rule's match clause apply to this event? */
export function ruleMatches(match: RuleMatch, event: UsageEvent): boolean {
  // An empty match clause never matches (guards against catch-all rules slipping in).
  if (!match.app && !match.titleRegex && !match.urlDomain && !match.profile)
    return false;

  if (match.app && match.app.toLowerCase() !== event.app.toLowerCase()) {
    return false;
  }
  if (match.profile) {
    if (
      !event.profile ||
      event.profile.toLowerCase() !== match.profile.toLowerCase()
    ) {
      return false;
    }
  }
  if (match.titleRegex) {
    let re: RegExp;
    try {
      re = new RegExp(match.titleRegex, "i");
    } catch {
      return false; // a malformed rule never matches rather than throwing
    }
    if (!re.test(event.title)) return false;
  }
  if (match.urlDomain) {
    const host = hostOf(event.url);
    if (!host || !hostMatchesDomain(host, match.urlDomain)) return false;
  }
  return true;
}

/**
 * Categorise one usage event against an ordered ruleset.
 * Returns the first matching rule's attribution, or an "unassigned" result.
 */
export function categorize(
  event: UsageEvent,
  rules: MappingRule[],
): Categorized {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (ruleMatches(rule.match, event)) {
      return {
        event,
        clientId: rule.clientId,
        project: rule.project,
        billable: rule.billable,
        matchedRuleId: rule.id,
      };
    }
  }
  return {
    event,
    clientId: null,
    project: null,
    billable: false,
    matchedRuleId: null,
  };
}

/** Categorise a batch of events. */
export function categorizeAll(
  events: UsageEvent[],
  rules: MappingRule[],
): Categorized[] {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  return events.map((e) => categorize(e, ordered));
}

/**
 * Coarse "where" label — the web host when it's a browser tab, otherwise the app
 * name. Used for the high-level apps/sites rollup.
 */
export function appLabel(event: UsageEvent): string {
  const host = hostOf(event.url);
  return host || event.app;
}

/**
 * Fine "what" label — the specific tab/chat/document from the window title, then
 * the host, then the app. This is what surfaces per-tab and per-chat detail (e.g.
 * an individual client conversation inside Teams) instead of just "comet.exe".
 */
export function activityLabel(event: UsageEvent): string {
  return cleanTitle(event.title) || hostOf(event.url) || event.app;
}

export interface RuleSuggestion {
  /** A ready-to-save match clause (urlDomain, titleRegex, or app). */
  match: RuleMatch;
  label: string; // the host, activity title, or app this covers
  seconds: number; // total unassigned time this would capture
  kind: "site" | "title" | "app";
  // Optional LLM-cleanup enrichment (absent when cleanup hasn't run):
  cleanedLabel?: string; // human label to show instead of `label`
  suggestedClientName?: string; // an existing client this likely belongs to
  confidence?: number; // 0..1 confidence in the client attribution
}

/** A distinct unassigned host/title/app and the time it represents. */
export interface UnassignedBucket {
  kind: "site" | "title" | "app";
  key: string; // host (site), cleaned title (title), or app name (app)
  seconds: number;
  sampleHost: string;
  sampleTitle: string;
  sampleApp: string;
}

/** What the LLM cleanup contributes for one host/title, looked up by raw key. */
export interface EnrichmentHit {
  cleanedLabel: string;
  isPerClientSubdomain: boolean;
  suggestedUrlDomain: string | null;
  suggestedClientName: string | null;
  confidence: number;
}

export interface EnrichmentLookup {
  get(raw: string): EnrichmentHit | undefined;
}

/**
 * Bucket unassigned usage into distinct sites (by host), titles (browser tabs
 * without a URL) and apps, summing time and keeping a representative sample for
 * context. Shared by `suggestRules` and the LLM cleanup so both see the same set
 * of distinct strings. Buckets below `minSeconds` are dropped. Order is sites,
 * then titles, then apps (each in first-seen order).
 */
export function bucketUnassigned(
  categorized: Categorized[],
  minSeconds = 5,
): UnassignedBucket[] {
  const sites = new Map<string, UnassignedBucket>();
  const titles = new Map<string, UnassignedBucket>();
  const apps = new Map<string, UnassignedBucket>();

  const bump = (
    map: Map<string, UnassignedBucket>,
    kind: UnassignedBucket["kind"],
    key: string,
    seconds: number,
    sample: { host: string; title: string; app: string },
  ) => {
    const existing = map.get(key);
    if (existing) {
      existing.seconds += seconds;
    } else {
      map.set(key, {
        kind,
        key,
        seconds,
        sampleHost: sample.host,
        sampleTitle: sample.title,
        sampleApp: sample.app,
      });
    }
  };

  for (const c of categorized) {
    if (c.matchedRuleId !== null) continue; // only unassigned time
    const sec = c.event.duration;
    const host = hostOf(c.event.url);
    const sample = { host, title: c.event.title, app: c.event.app };
    if (host) {
      bump(sites, "site", host, sec, sample);
    } else if (isBrowserApp(c.event.app)) {
      const title = cleanTitle(c.event.title);
      if (title) bump(titles, "title", title, sec, sample);
      else bump(apps, "app", c.event.app, sec, sample);
    } else {
      bump(apps, "app", c.event.app, sec, sample);
    }
  }

  return [...sites.values(), ...titles.values(), ...apps.values()].filter(
    (b) => b.seconds >= minSeconds,
  );
}

/**
 * Inspect unassigned usage and propose the highest-impact rules to create, so
 * the user can resolve most untracked time with a couple of clicks. Sites
 * (URL domains) are preferred over bare app names because a browser app like
 * chrome.exe spans many clients.
 */
export function suggestRules(
  categorized: Categorized[],
  minSeconds = 5,
  enrich?: EnrichmentLookup,
): RuleSuggestion[] {
  const buckets = bucketUnassigned(categorized, minSeconds);

  const suggestions: RuleSuggestion[] = buckets.map((b) => {
    if (b.kind === "site") {
      const e = enrich?.get(b.key);
      // Match the FULL host by default (e.g. acme.looplogics.com), so the
      // suggestion label matches the Activity panel and per-client subdomains
      // stay separate. The LLM cleanup may still override with a scoped domain.
      const urlDomain = e?.suggestedUrlDomain ?? b.key;
      return withEnrichment(
        { match: { urlDomain }, label: b.key, seconds: b.seconds, kind: "site" },
        e,
      );
    }
    if (b.kind === "title") {
      const e = enrich?.get(b.key);
      return withEnrichment(
        {
          match: { titleRegex: escapeRegExp(b.key) },
          label: b.key,
          seconds: b.seconds,
          kind: "title",
        },
        e,
      );
    }
    return {
      match: { app: b.key },
      label: b.key,
      seconds: b.seconds,
      kind: "app",
    };
  });

  return suggestions.sort((a, b) => b.seconds - a.seconds);
}

/** Attach optional LLM display/attribution fields to a suggestion. */
function withEnrichment(
  s: RuleSuggestion,
  e: EnrichmentHit | undefined,
): RuleSuggestion {
  if (!e) return s;
  return {
    ...s,
    cleanedLabel: e.cleanedLabel,
    suggestedClientName: e.suggestedClientName ?? undefined,
    confidence: e.confidence,
  };
}

/**
 * Reduce a host to a registrable-ish domain (last two labels) so a suggested
 * rule for `app.asana.com` becomes `asana.com`. Good enough for the common
 * single-TLD case; multi-part TLDs (co.uk) keep three labels.
 */
export function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const twoPartTlds = new Set(["co.uk", "com.au", "co.nz", "co.za", "com.br"]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoPartTlds.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}
