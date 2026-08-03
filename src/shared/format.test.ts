import { describe, it, expect } from 'vitest'
import {
  formatHoursDecimal,
  formatRetainerRemaining,
  localDayISO,
  periodDays,
  startOfMonth,
  startOfWeek
} from './format'

describe('localDayISO', () => {
  it('formats a date as YYYY-MM-DD from its LOCAL components, zero-padded', () => {
    // Constructed with local Y/M/D, so this holds regardless of the test
    // machine's timezone — an evening time still yields that same local day.
    expect(localDayISO(new Date(2026, 6, 17, 23, 30))).toBe('2026-07-17')
    expect(localDayISO(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })

  it('uses the local day, not the UTC day, for a near-midnight instant', () => {
    const d = new Date(2026, 6, 17, 23, 30) // 11:30pm local on the 17th
    // toISOString (UTC) may roll to the 18th for positive offsets; localDayISO
    // must still report the 17th — this is the "overnight" fix.
    expect(localDayISO(d)).toBe('2026-07-17')
  })
})

describe('formatHoursDecimal', () => {
  it('converts seconds to 2dp hours', () => {
    expect(formatHoursDecimal(3600)).toBe('1.00')
    expect(formatHoursDecimal(4530)).toBe('1.26') // 1.258.. rounded
    expect(formatHoursDecimal(900)).toBe('0.25')
  })

  it('clamps negatives to zero', () => {
    expect(formatHoursDecimal(-100)).toBe('0.00')
  })
})

describe('formatRetainerRemaining', () => {
  it('reads as remaining budget while there is some', () => {
    expect(formatRetainerRemaining(12.4 * 3600)).toBe('12.4 h left')
  })

  // The magnitude is shown without a minus sign — "over" already carries it.
  it('reads as an overrun once negative', () => {
    expect(formatRetainerRemaining(-2.1 * 3600)).toBe('2.1 h over')
  })

  it('treats exactly zero as nothing left rather than an overrun', () => {
    expect(formatRetainerRemaining(0)).toBe('0.0 h left')
  })
})

describe('startOfWeek', () => {
  // Weeks start Monday: a period that began mid-week can't be compared to the
  // one before it.
  it('returns the Monday of that week, at local midnight', () => {
    // 2026-08-03 is a Monday; the 5th is the Wednesday of the same week.
    expect(startOfWeek(new Date(2026, 7, 5, 14, 30))).toEqual(new Date(2026, 7, 3))
  })

  it('treats Sunday as the END of its week, not the start', () => {
    // 2026-08-09 is a Sunday — it belongs to the week beginning Monday the 3rd.
    expect(startOfWeek(new Date(2026, 7, 9, 23, 59))).toEqual(new Date(2026, 7, 3))
  })

  it('crosses a month boundary backwards when the week does', () => {
    // Wednesday 2026-09-02 sits in the week beginning Monday 2026-08-31.
    expect(startOfWeek(new Date(2026, 8, 2))).toEqual(new Date(2026, 7, 31))
  })
})

describe('startOfMonth', () => {
  it('returns the 1st at local midnight', () => {
    expect(startOfMonth(new Date(2026, 7, 25, 9, 0))).toEqual(new Date(2026, 7, 1))
  })
})

describe('periodDays', () => {
  // The day count is what the existing range queries take, so this is where
  // calendar alignment actually happens.
  it('counts the month inclusive of today', () => {
    // The 3rd of the month is 3 days in, not 30 — the whole point of dropping
    // the rolling ranges, which spanned the previous retainer period.
    expect(periodDays('month', new Date(2026, 7, 3, 10, 0))).toBe(3)
    expect(periodDays('month', new Date(2026, 7, 1))).toBe(1)
    expect(periodDays('month', new Date(2026, 7, 31))).toBe(31)
  })

  it('counts the week inclusive of today, from Monday', () => {
    expect(periodDays('week', new Date(2026, 7, 3))).toBe(1) // Monday
    expect(periodDays('week', new Date(2026, 7, 5))).toBe(3) // Wednesday
    expect(periodDays('week', new Date(2026, 7, 9))).toBe(7) // Sunday
  })
})
