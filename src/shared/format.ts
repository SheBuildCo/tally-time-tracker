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

// "H:MM" — used in the report PDF's sessions table.
export function formatHoursMinutes(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${m.toString().padStart(2, '0')}`
}

// "H:MM:SS" — the live elapsed clock, and the CSV duration column.
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
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
