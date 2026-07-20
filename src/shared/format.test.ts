import { describe, it, expect } from 'vitest'
import { localDayISO, formatHoursDecimal } from './format'

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
