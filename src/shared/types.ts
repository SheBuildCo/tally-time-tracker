// Shared domain types used by both the main process (DB, IPC handlers) and the
// renderer (typed API wrappers, UI). Keep this file free of any runtime imports
// so it can be pulled into either side without pulling in Node or browser deps.

export interface Client {
  id: number
  name: string
  billableRate: number // currency units per hour
  retainerHours: number // hours included per calendar month; 0 = no retainer
  color: string // hex or tailwind-ish token used for charts/badges
}

// Result of editing a client. `remoteRename` reports what happened to the copy
// in the shared team database when the name changed: 'ok' it followed,
// 'name-taken' the team already had a different client under that name,
// 'skipped' team sync isn't set up, 'failed' the database was unreachable,
// null the name didn't change.
export interface ClientUpdateResult {
  client: Client | null
  remoteRename: 'ok' | 'name-taken' | 'skipped' | 'failed' | null
}

// A client's retainer position for the current calendar month. `usedSeconds`
// counts COMPLETED sessions only, so a live timer's elapsed time is added on top
// by the UI without double-counting.
export interface RetainerStatus {
  clientId: number
  // Client ids are per-machine, so the shared database and the team dashboard
  // key on name instead (see the header of src/main/sync.ts). Carrying the name
  // lets a caller line a status up with a team-scoped row.
  clientName: string
  retainerHours: number // 0 = no retainer configured for this client
  usedSeconds: number
  source: 'team' | 'local' // 'local' = shared DB unreachable or not set up
  asOf: string // ISO timestamp the figure was computed
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
  // Active (AFK-filtered) tracked seconds, summed from the session's snapshot.
  // Populated by listSessions for display; undefined elsewhere. This — not
  // wall-clock end−start — is the real worked duration.
  activeSeconds?: number
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

// ---- Team view (shared database) ----

// One teammate's slice of the team summary.
export interface TeamMemberSummary {
  person: string
  seconds: number
  billableSeconds: number
  amount: number
  clients: ClientSummary[]
}

// Mirrors RangeSummary (same clients/daily shape, so the dashboard's existing
// components render it unchanged) plus the per-person breakdown that only makes
// sense team-wide.
export interface TeamSummary {
  days: number
  totalSeconds: number
  billableSeconds: number
  people: TeamMemberSummary[]
  clients: ClientSummary[]
  daily: DailyTotal[]
}

// Team sync configuration + last-run status, surfaced in Settings.
export interface TeamStatus {
  configured: boolean
  personName: string | null
  hasUrl: boolean
  lastSync: { ok: boolean; message: string; at: string } | null
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
  csvPath: string
  createdAt: string
}

export interface Settings {
  shortcutToggle: string
  shortcutPicker: string
  autoLaunch: boolean
  trackingStartedAt: string // ISO-8601 UTC; AW history before this is never ingested
  awStatus: boolean // AW server reachable
  awAfkWatcher: boolean // AW AFK watcher present (idle detection / accurate durations)
  idleAutoStopMinutes: number // auto-stop a running timer after this much idle
}
