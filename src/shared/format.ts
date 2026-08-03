// Pure formatting helpers shared between the main process (report generation)
// and the renderer (UI display). No DOM/Node APIs — safe to import from either
// side of the Electron process boundary.

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

// "H:MM:SS" — the live elapsed clock.
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${h}:${pad(m)}:${pad(sec)}`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

// Date only, no time — used for report session rows and date-range labels.
// Renders in the machine's local timezone (toLocale* always does), so an
// evening-local session shows the correct local date, not the UTC one.
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// A calendar day as YYYY-MM-DD in the machine's LOCAL timezone (not UTC). Used
// to bucket activity by the day the user actually experienced: for a UTC+10
// user an evening-local event has a next-day UTC date, and bucketing by UTC is
// what made sessions look like they ran "overnight". Passing no argument uses
// now; pass a Date to convert a specific instant.
export function localDayISO(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Local time-of-day, 12-hour, e.g. "9:30 AM" — for the CSV Start/End columns
// and session display. Local timezone, so it never reads as an "overnight" UTC
// time for a session actually worked during the day.
export function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Decimal hours to 2dp, e.g. 4530s -> "1.26". Used for the CSV Hours column and
// as the basis for the billable amount, so Hours × rate reconciles exactly.
export function formatHoursDecimal(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(2)
}

// Hours to 1dp for at-a-glance retainer readouts, e.g. "12.4". One decimal is
// deliberate: a retainer is a budget, not an invoice line, and 2dp reads as
// false precision on a clock that moves every second.
export function formatHoursShort(hours: number): string {
  return (Math.round(Math.abs(hours) * 10) / 10).toFixed(1)
}

// The retainer position as a phrase: "12.4 h left" while there's budget,
// "2.1 h over" once it's blown. Shared by the timer banner and the pinned
// widget so both always word it identically.
export function formatRetainerRemaining(remainingSeconds: number): string {
  const hours = remainingSeconds / 3600
  return hours < 0 ? `${formatHoursShort(hours)} h over` : `${formatHoursShort(hours)} h left`
}

// ---- Reporting periods ----
//
// Every range in the app is CALENDAR-ALIGNED, not a rolling window. A retainer
// resets on the 1st, so a rolling "last 7 days" viewed on the 3rd of a month
// mixes two retainer periods and makes used-vs-included unreadable — which is
// exactly what a trailing window did before. Weeks align to Monday for the same
// reason: a period that starts mid-week can't be compared to the one before it.

export type Period = 'week' | 'month'

/** Midnight local on the Monday of `date`'s week. */
export function startOfWeek(date: Date = new Date()): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay() is 0=Sunday; shift so Monday is the first day.
  const back = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - back)
  return d
}

/** Midnight local on the 1st of `date`'s month. */
export function startOfMonth(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function startOfPeriod(period: Period, date: Date = new Date()): Date {
  return period === 'week' ? startOfWeek(date) : startOfMonth(date)
}

/**
 * How many calendar days the period covers so far, inclusive of today — the
 * count the existing day-window queries (recentDays, getRangeRows) already take.
 * Expressing the period this way means calendar alignment costs nothing
 * downstream: on the 3rd of the month, 'month' is simply 3 days.
 */
export function periodDays(period: Period, date: Date = new Date()): number {
  const start = startOfPeriod(period, date)
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((today.getTime() - start.getTime()) / MS_PER_DAY) + 1
}

export function periodLabel(period: Period): string {
  return period === 'week' ? 'This week' : 'This month'
}
