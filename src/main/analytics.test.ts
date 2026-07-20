import { describe, it, expect } from 'vitest'
import { applySessionOverrides, rollup, buildRangeSummary, sessionActiveSeconds } from './analytics'
import { categorizeAll } from './categorize'
import type {
  UsageEvent,
  MappingRule,
  TimerSession,
  SessionExclusion,
  SessionActivity,
  Client
} from '../shared/types'

function evt(partial: Partial<UsageEvent> & { timestamp: string; duration: number }): UsageEvent {
  return {
    app: 'chrome.exe',
    title: 'Some tab',
    host: '',
    ...partial
  }
}

function session(
  partial: Partial<TimerSession> & { id: number; clientId: number; startTime: string }
): TimerSession {
  return {
    endTime: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

const clients: Client[] = [
  { id: 1, name: 'Client A', billableRate: 100, color: '#111' },
  { id: 2, name: 'Client B', billableRate: 200, color: '#222' }
]

describe('applySessionOverrides', () => {
  it('reassigns events inside the session window to the session client', () => {
    const events = [
      evt({ timestamp: '2026-07-08T10:05:00.000Z', duration: 600, app: 'figma.exe', title: 'Design' })
    ]
    const categorized = categorizeAll(events, []) // no rules → unassigned
    expect(categorized[0].clientId).toBeNull()

    const s = session({
      id: 1,
      clientId: 2,
      startTime: '2026-07-08T10:00:00.000Z',
      endTime: '2026-07-08T11:00:00.000Z'
    })
    const result = applySessionOverrides(categorized, [s], new Map())
    expect(result[0].clientId).toBe(2)
    expect(result[0].billable).toBe(true)
  })

  it('leaves events outside the session window untouched', () => {
    const events = [evt({ timestamp: '2026-07-08T09:00:00.000Z', duration: 600, app: 'figma.exe' })]
    const categorized = categorizeAll(events, [])
    const s = session({
      id: 1,
      clientId: 2,
      startTime: '2026-07-08T10:00:00.000Z',
      endTime: '2026-07-08T11:00:00.000Z'
    })
    const result = applySessionOverrides(categorized, [s], new Map())
    expect(result[0].clientId).toBeNull()
  })

  it('respects exclusions — excluded activity falls back to rule categorization', () => {
    const events = [
      evt({
        timestamp: '2026-07-08T10:05:00.000Z',
        duration: 600,
        app: 'spotify.exe',
        title: 'Music',
        host: ''
      })
    ]
    const categorized = categorizeAll(events, [])
    const s = session({
      id: 1,
      clientId: 2,
      startTime: '2026-07-08T10:00:00.000Z',
      endTime: '2026-07-08T11:00:00.000Z'
    })
    const exclusions = new Map<number, SessionExclusion[]>([
      [1, [{ id: 1, sessionId: 1, app: 'spotify.exe', host: '', activity: 'Music' }]]
    ])
    const result = applySessionOverrides(categorized, [s], exclusions)
    expect(result[0].clientId).toBeNull() // not overridden
  })

  it('latest-starting overlapping session wins (client switch mid-stream)', () => {
    const events = [evt({ timestamp: '2026-07-08T10:30:00.000Z', duration: 60, app: 'code.exe' })]
    const categorized = categorizeAll(events, [])
    const s1 = session({
      id: 1,
      clientId: 1,
      startTime: '2026-07-08T10:00:00.000Z',
      endTime: '2026-07-08T11:00:00.000Z'
    })
    const s2 = session({
      id: 2,
      clientId: 2,
      startTime: '2026-07-08T10:20:00.000Z',
      endTime: '2026-07-08T11:00:00.000Z'
    })
    const result = applySessionOverrides(categorized, [s1, s2], new Map())
    expect(result[0].clientId).toBe(2)
  })

  it('treats a running session (null end) as ongoing to now', () => {
    const now = new Date()
    const started = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const events = [evt({ timestamp: new Date(now.getTime() - 60 * 1000).toISOString(), duration: 30 })]
    const categorized = categorizeAll(events, [])
    const s = session({ id: 1, clientId: 1, startTime: started, endTime: null })
    const result = applySessionOverrides(categorized, [s], new Map())
    expect(result[0].clientId).toBe(1)
  })
})

describe('rollup', () => {
  it('aggregates seconds by client/app/activity/host', () => {
    const rules: MappingRule[] = [
      { id: 1, match: { app: 'code.exe' }, clientId: 1, billable: true, priority: 10 }
    ]
    const events = [
      evt({ timestamp: '2026-07-08T10:00:00.000Z', duration: 100, app: 'code.exe', title: 'main.ts' }),
      evt({ timestamp: '2026-07-08T10:05:00.000Z', duration: 50, app: 'code.exe', title: 'main.ts' })
    ]
    const categorized = categorizeAll(events, rules)
    const rows = rollup(categorized, '2026-07-08')
    expect(rows).toHaveLength(1)
    expect(rows[0].seconds).toBe(150)
    expect(rows[0].clientId).toBe(1)
  })

  it('drops unassigned time — a row with no client is never produced', () => {
    const events = [
      evt({ timestamp: '2026-07-08T10:00:00.000Z', duration: 100, app: 'code.exe', title: 'main.ts' })
    ]
    const categorized = categorizeAll(events, []) // no rules → null client
    expect(rollup(categorized, '2026-07-08')).toHaveLength(0)
  })
})

describe('sessionActiveSeconds', () => {
  const act = (seconds: number, excluded = false): SessionActivity => ({
    app: 'x',
    host: '',
    activity: 'a',
    seconds,
    excluded,
    exclusionId: excluded ? 1 : null
  })

  it('sums non-excluded activity seconds', () => {
    expect(sessionActiveSeconds([act(300), act(600)])).toBe(900)
  })

  it('ignores excluded activities', () => {
    expect(sessionActiveSeconds([act(300), act(600, true)])).toBe(300)
  })

  it('is zero for no activities', () => {
    expect(sessionActiveSeconds([])).toBe(0)
  })
})

describe('buildRangeSummary', () => {
  it('computes billable amount from client rate', () => {
    const events = [
      evt({ timestamp: '2026-07-08T10:00:00.000Z', duration: 3600, app: 'code.exe', title: 'work' })
    ]
    let categorized = categorizeAll(events, [])
    const s = session({
      id: 1,
      clientId: 2,
      startTime: '2026-07-08T00:00:00.000Z',
      endTime: '2026-07-08T23:59:59.000Z'
    })
    categorized = applySessionOverrides(categorized, [s], new Map())
    const rows = rollup(categorized, '2026-07-08')
    const summary = buildRangeSummary(rows, clients, 1)
    const clientB = summary.clients.find((c) => c.clientId === 2)!
    expect(clientB.billableSeconds).toBe(3600)
    expect(clientB.amount).toBe(200) // 1h * $200
  })
})

describe('categorizeAll', () => {
  it('matches app rules case-insensitively, first by priority', () => {
    const rules: MappingRule[] = [
      { id: 1, match: { app: 'OUTLOOK.EXE' }, clientId: 5, billable: false, priority: 10 }
    ]
    const events = [evt({ timestamp: '2026-07-08T10:00:00.000Z', duration: 60, app: 'outlook.exe' })]
    const [c] = categorizeAll(events, rules)
    expect(c.clientId).toBe(5)
    expect(c.billable).toBe(false)
  })

  it('matches domain rules subdomain-aware', () => {
    const rules: MappingRule[] = [
      { id: 1, match: { urlDomain: 'office.com' }, clientId: 5, billable: false, priority: 10 }
    ]
    const events = [
      evt({
        timestamp: '2026-07-08T10:00:00.000Z',
        duration: 60,
        app: 'chrome.exe',
        host: 'outlook.office.com',
        url: 'https://outlook.office.com/mail'
      })
    ]
    const [c] = categorizeAll(events, rules)
    expect(c.clientId).toBe(5)
  })
})
