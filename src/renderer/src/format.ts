// Display formatting helpers. Duration/date helpers live in shared/format.ts
// so the main process (report generation) uses the exact same logic; this
// file re-exports them plus renderer-only formatters like currency.

export { formatDuration, formatHoursMinutes, formatClock, formatDate, formatDay } from '@shared/format'

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(amount)
}
