// Shared domain types for Tally.

/** A raw ActivityWatch event as returned by the REST API / query engine. */
export interface AWEvent {
  id?: number;
  timestamp: string; // ISO8601
  duration: number; // seconds
  data: Record<string, unknown>;
}

/** A bucket descriptor from GET /api/0/buckets/. */
export interface AWBucket {
  id: string;
  type: string;
  client: string;
  hostname: string;
  created: string;
}

/**
 * A normalised slice of tracked usage produced by `getUsageEvents`.
 * Each slice is a contiguous chunk of *active* (non-AFK) time spent in a
 * single app, with the browser URL attached when the app is a browser.
 */
export interface UsageEvent {
  app: string; // e.g. "OUTLOOK.EXE", "ms-teams.exe", "chrome.exe"
  title: string; // window title
  url?: string; // active tab URL, when app is a tracked browser
  duration: number; // seconds
  timestamp: string; // ISO8601 start of the slice
}

/** A client the firm bills. */
export interface Client {
  id: number;
  name: string;
  billableRate: number; // currency units per hour
  color?: string; // tremor colour name for charts
}

/** Where a usage event's time is matched against. */
export interface RuleMatch {
  app?: string; // exact (case-insensitive) app/exe name
  titleRegex?: string; // regex tested against the window title
  urlDomain?: string; // matches when the event URL's host ends with this
}

/** A mapping rule: usage matching `match` rolls up to a client/project. */
export interface MappingRule {
  id: number;
  match: RuleMatch;
  clientId: number | null; // null => explicitly non-billable / internal
  project: string | null;
  billable: boolean;
  priority: number; // lower number = evaluated first
}

/** Result of categorising a single usage event. */
export interface Categorized {
  event: UsageEvent;
  clientId: number | null;
  project: string | null;
  billable: boolean;
  matchedRuleId: number | null; // null => unassigned
}

/** The sentinel client id used for usage that matched no rule. */
export const UNASSIGNED_CLIENT_ID = null;
