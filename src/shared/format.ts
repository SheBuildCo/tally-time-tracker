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
