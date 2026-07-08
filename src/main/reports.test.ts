import { describe, it, expect } from 'vitest'
import { buildCsv, substituteMergeFields, type ReportData, type SessionWithActivities } from './reports'
import type { TimerSession, SessionActivity } from '../shared/types'

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

function reportData(sessions: SessionWithActivities[]): ReportData {
  return {
    clientId: 1,
    clientName: 'Acme Corp',
    startDay: '2026-07-01',
    endDay: '2026-07-08',
    sessions
  }
}

describe('buildCsv', () => {
  it('emits one row per activity, with a header row and BOM', () => {
    const data = reportData([
      {
        session: session({ id: 1, startTime: '2026-07-01T09:00:00.000Z', endTime: '2026-07-01T10:00:00.000Z' }),
        activities: [
          activity({ app: 'chrome.exe', host: 'github.com', activity: 'Pull request', seconds: 300 }),
          activity({ app: 'code.exe', activity: 'main.ts', seconds: 600 })
        ]
      }
    ])

    const csv = buildCsv(data)
    const lines = csv.replace(/^﻿/, '').split('\r\n')

    expect(lines[0]).toBe(
      'Session Date,Session Start,Session End,App,Host,Activity,Duration (seconds),Duration (H:MM:SS)'
    )
    expect(lines).toHaveLength(3) // header + 2 activity rows
    expect(lines[1]).toContain('chrome.exe')
    expect(lines[1]).toContain('github.com')
    expect(lines[2]).toContain('code.exe')
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM present
  })

  it('produces no rows for a session with only excluded activities (caller filters before calling)', () => {
    // buildCsv trusts its input has already been filtered — verify a session
    // with an empty activities array contributes nothing.
    const data = reportData([
      { session: session({ id: 1, startTime: '2026-07-01T09:00:00.000Z', endTime: '2026-07-01T10:00:00.000Z' }), activities: [] }
    ])
    const csv = buildCsv(data)
    const lines = csv.replace(/^﻿/, '').split('\r\n')
    expect(lines).toHaveLength(1) // header only
  })

  it('escapes commas and quotes in activity titles', () => {
    const data = reportData([
      {
        session: session({ id: 1, startTime: '2026-07-01T09:00:00.000Z', endTime: '2026-07-01T10:00:00.000Z' }),
        activities: [activity({ app: 'chrome.exe', activity: 'Title, with "quotes"', seconds: 60 })]
      }
    ])
    const csv = buildCsv(data)
    expect(csv).toContain('"Title, with ""quotes"""')
  })
})

describe('substituteMergeFields', () => {
  const templateHtml = `
    <h2>Work Summary</h2>
    <p><span data-merge-field="client_name" contenteditable="false">[Client Name]</span> — <span data-merge-field="date_range" contenteditable="false">[Date Range]</span></p>
    <div data-merge-field="sessions_table" contenteditable="false">[Sessions Table]</div>
    <p>Generated <span data-merge-field="generated_date" contenteditable="false">[Generated Date]</span></p>
  `

  it('replaces client_name and date_range with plain text', () => {
    const data = reportData([])
    const html = substituteMergeFields(templateHtml, data)
    expect(html).toContain('Acme Corp')
    expect(html).not.toContain('data-merge-field="client_name"')
    expect(html).not.toContain('data-merge-field="date_range"')
  })

  it('replaces sessions_table with a real table containing only date/duration/client — no totals or amounts', () => {
    const data = reportData([
      {
        session: session({
          id: 1,
          startTime: '2026-07-01T09:00:00.000Z',
          endTime: '2026-07-01T10:30:00.000Z'
        }),
        activities: []
      }
    ])
    const html = substituteMergeFields(templateHtml, data)

    expect(html).toContain('<table')
    expect(html).toContain('Acme Corp')
    expect(html).not.toContain('data-merge-field="sessions_table"')
    // No billable-amount or total-hours language should ever appear.
    expect(html.toLowerCase()).not.toContain('total')
    expect(html.toLowerCase()).not.toContain('billable')
    expect(html).not.toContain('$')
  })

  it('shows an empty-state row when there are no sessions in range', () => {
    const html = substituteMergeFields(templateHtml, reportData([]))
    expect(html).toContain('No sessions in this period')
  })

  it('escapes a client name containing HTML-significant characters', () => {
    const data = { ...reportData([]), clientName: '<script>alert(1)</script>' }
    const html = substituteMergeFields(templateHtml, data)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('leaves ordinary prose the user typed completely untouched', () => {
    const withProse = `<p>Hi there, thanks for a great week!</p>` + templateHtml
    const html = substituteMergeFields(withProse, reportData([]))
    expect(html).toContain('Hi there, thanks for a great week!')
  })
})
