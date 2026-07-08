// Shared domain types used by both the main process (DB, IPC handlers) and the
// renderer (typed API wrappers, UI). Keep this file free of any runtime imports
// so it can be pulled into either side without pulling in Node or browser deps.

export interface Client {
  id: number
  name: string
  billableRate: number // currency units per hour
  color: string // hex or tailwind-ish token used for charts/badges
}

export interface RuleMatch {
  app?: string // exact, case-insensitive match on the app/exe name
  titleRegex?: string // regex tested against the window title
  urlDomain?: string // suffix match against the event host
}

export interface MappingRule {
  id: number
  match: RuleMatch
  clientId: number | null // null = explicitly non-billable / unassigned
  billable: boolean
  priority: number // lower = evaluated first
}

// A single active-usage slice pulled from ActivityWatch (window + browser tab
// stitched together). Duration is in seconds.
export interface UsageEvent {
  timestamp: string // ISO-8601 UTC, start of the slice
  duration: number // seconds
  app: string // exe / app name, e.g. "chrome.exe"
  title: string // window or tab title
  host: string // URL host for browser events, else ""
  url?: string // full URL for browser events
}

// Result of running a UsageEvent through the rule engine.
export interface Categorized {
  event: UsageEvent
  clientId: number | null
  billable: boolean
  matchedRuleId: number | null // null = unassigned by rules
}

// One aggregated row persisted per (day, client, app, activity, host). This is
// the durable cache of AW history so analytics survives AW going offline.
export interface DailyActivityRow {
  day: string // YYYY-MM-DD (UTC)
  clientId: number | null
  app: string
  activity: string // cleaned title / activity label
  host: string
  billable: boolean
  seconds: number
}

// ---- Manual timer ----

export interface TimerSession {
  id: number
  clientId: number
  startTime: string // ISO-8601 UTC
  endTime: string | null // null while running
  notes: string | null
  createdAt: string
}

export interface SessionExclusion {
  id: number
  sessionId: number
  app: string
  host: string
  activity: string
}

export type TimerState =
  | { status: 'idle' }
  | {
      status: 'running'
      sessionId: number
      clientId: number
      startTime: string // ISO-8601 UTC
    }

// ---- Analytics view models ----

export interface ClientSummary {
  clientId: number | null
  clientName: string
  color: string
  seconds: number
  billableSeconds: number
  amount: number // billableSeconds/3600 * rate
}

export interface DailyTotal {
  day: string
  seconds: number
  byClient: { clientId: number | null; seconds: number }[]
}

export interface RangeSummary {
  days: number
  totalSeconds: number
  billableSeconds: number
  clients: ClientSummary[]
  daily: DailyTotal[]
}

// Activity row shown in the session detail view, annotated with whether the
// user has excluded it from the session.
export interface SessionActivity {
  app: string
  host: string
  activity: string
  seconds: number
  excluded: boolean
  exclusionId: number | null
}

export const DEFAULT_SHORTCUTS = {
  toggle: 'CommandOrControl+Shift+T',
  picker: 'CommandOrControl+Shift+P'
} as const

export interface ReportHistoryEntry {
  id: number
  clientId: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  pdfPath: string
  csvPath: string
  createdAt: string
}

export interface Settings {
  shortcutToggle: string
  shortcutPicker: string
  autoLaunch: boolean
  trackingStartedAt: string // ISO-8601 UTC; AW history before this is never ingested
  awStatus: boolean
}
