import { describe, it, expect } from 'vitest'
import { buildCsv, buildTeamCsv, type ReportData, type SessionWithActivities } from './reports'
import type { TimerSession, SessionActivity } from '../shared/types'
import type { TeamSessionRow } from './sync'

function session(partial: Partial<TimerSession> & { id: number; startTime: string }): TimerSession {
  return {
    clientId: 1,
    endTime: null,
    notes: null,
    createdAt: partial.startTime,
    ...partial
  }
}

function activity(partial: Partial<SessionActivity> & { app: string; activity: string }): SessionActivity {
  return { host: '', seconds: 0, excluded: false, exclusionId: null, ...partial }
}

function reportData(sessions: SessionWithActivities[], billableRate = 150): ReportData {
  return {
    clientId: 1,
    clientName: 'Acme Corp',
    billableRate,
    startDay: '2026-07-01',
    endDay: '2026-07-08',
    sessions
  }
}

describe('buildCsv', () => {
  it('emits one row per session with the clean header and a BOM', () => {
    const data = reportData([
      {
        // 300 + 600 = 900s active = 0.25h; @ $150 = $37.50
        session: session({ id: 1, startTime: '2026-07-01T09:00:00.000Z', endTime: '2026-07-01T10:00:00.000Z' }),
        activities: [
          activity({ app: 'chrome.exe', host: 'github.com', activity: 'Pull request', seconds: 300 }),
          activity({ app: 'code.exe', activity: 'main.ts', seconds: 600 })
        ]
      }
    ])

    const csv = buildCsv(data)
    const lines = csv.replace(/^﻿/, '').split('\r\n')

    expect(lines[0]).toBe('Date,Client,Description,Start,End,Hours,Amount')
    expect(lines).toHaveLength(2) // header + 1 session row
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM present

    const cols = lines[1].split(',')
    expect(cols[1]).toBe('Acme Corp')
    expect(cols[5]).toBe('0.25') // active hours, single decimal-hours column
    expect(cols[6]).toBe('37.50') // Hours × rate
  })

  it('uses the session notes as the description, blank when none', () => {
    const data = reportData([
      {
        session: session({
          id: 1,
          startTime: '2026-07-01T09:00:00.000Z',
          endTime: '2026-07-01T10:00:00.000Z',
          notes: 'Drafted the scope of works'
        }),
        activities: [activity({ app: 'word.exe', activity: 'Scope', seconds: 3600 })]
      }
    ])
    expect(buildCsv(data)).toContain('Drafted the scope of works')
  })

  it('leaves Amount blank for a non-billable client (rate 0)', () => {
    const data = reportData(
      [
        {
          session: session({ id: 1, startTime: '2026-07-01T09:00:00.000Z', endTime: '2026-07-01T10:00:00.000Z' }),
          activities: [activity({ app: 'chrome.exe', activity: 'Admin', seconds: 3600 })]
        }
      ],
      0
    )
    const cols = buildCsv(data).replace(/^﻿/, '').split('\r\n')[1].split(',')
    expect(cols[5]).toBe('1.00') // hours still shown
    expect(cols[6]).toBe('') // amount blank
  })

  it('skips sessions with zero active time (all activities excluded upstream)', () => {
    const data = reportData([
      { session: session({ id: 1, startTime: '2026-07-01T09:00:00.000Z', endTime: '2026-07-01T10:00:00.000Z' }), activities: [] }
    ])
    const lines = buildCsv(data).replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(1) // header only
  })

  it('escapes commas and quotes in the description', () => {
    const data = reportData([
      {
        session: session({
          id: 1,
          startTime: '2026-07-01T09:00:00.000Z',
          endTime: '2026-07-01T10:00:00.000Z',
          notes: 'Title, with "quotes"'
        }),
        activities: [activity({ app: 'chrome.exe', activity: 'x', seconds: 60 })]
      }
    ])
    expect(buildCsv(data)).toContain('"Title, with ""quotes"""')
  })
})

describe('buildTeamCsv', () => {
  const teamRow = (over: Partial<TeamSessionRow> = {}): TeamSessionRow => ({
    person: 'Oli',
    client: 'MAAS Constructions',
    startTime: '2026-07-15T09:00:00.000Z',
    endTime: '2026-07-15T10:00:00.000Z',
    notes: null,
    billableRate: 150,
    activeSeconds: 900, // 0.25h
    ...over
  })

  it('has the Person column header and one row per session', () => {
    const csv = buildTeamCsv([teamRow({ person: 'Oli' }), teamRow({ person: 'Megs', activeSeconds: 3600 })])
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe('Date,Person,Client,Description,Start,End,Hours,Amount')
    expect(lines).toHaveLength(3) // header + 2 sessions

    const first = lines[1].split(',')
    expect(first[1]).toBe('Oli')
    expect(first[2]).toBe('MAAS Constructions')
    expect(first[6]).toBe('0.25')
    expect(first[7]).toBe('37.50') // 0.25h × 150
  })

  it('skips zero-active sessions and blanks amount for a non-billable client', () => {
    const csv = buildTeamCsv([
      teamRow({ activeSeconds: 0 }), // dropped
      teamRow({ person: 'KP', activeSeconds: 3600, billableRate: 0 })
    ])
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(2) // header + the one non-zero session
    const cols = lines[1].split(',')
    expect(cols[6]).toBe('1.00')
    expect(cols[7]).toBe('') // no rate → blank amount
  })
})
