// Unit tests for the team aggregation. This is the one place where a mistake
// silently produces wrong *billable* numbers for the whole team, so it's split
// out of sync.ts as a pure function and tested without a database.

import { describe, expect, it } from 'vitest'
import { aggregateTeam, toSharedRows } from './sync'

describe('toSharedRows', () => {
  const local = (over: Partial<Parameters<typeof toSharedRows>[2][number]> = {}) => ({
    clientId: 6 as number | null,
    app: 'chrome.exe',
    activity: 'Dashboard',
    host: 'app.example.com',
    billable: true,
    seconds: 600,
    ...over
  })

  it('translates local client ids to shared ids', () => {
    const rows = toSharedRows(1, '2026-07-15', [local()], new Map([[6, 1]]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ person_id: 1, day: '2026-07-15', client_id: 1, seconds: 600 })
  })

  it('maps unattributed time to the -1 sentinel', () => {
    const rows = toSharedRows(1, '2026-07-15', [local({ clientId: null })], new Map())
    expect(rows[0].client_id).toBe(-1)
  })

  // A client deleted locally but still referenced by an old rollup row must not
  // be pushed under someone else's id — it becomes unattributed.
  it('falls back to unassigned when the client is not in the map', () => {
    const rows = toSharedRows(1, '2026-07-15', [local({ clientId: 99 })], new Map([[6, 1]]))
    expect(rows[0].client_id).toBe(-1)
  })

  // SQLite allows two PK rows differing only by a NULL client; Postgres does
  // not. Without merging, the second row would collide and its time be lost.
  it('merges rows that collide once NULL becomes -1, summing their time', () => {
    const rows = toSharedRows(
      1,
      '2026-07-15',
      [local({ clientId: null, seconds: 600 }), local({ clientId: null, seconds: 300 })],
      new Map()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].seconds).toBe(900) // no time lost
  })

  it('keeps genuinely different activities apart', () => {
    const rows = toSharedRows(
      1,
      '2026-07-15',
      [local({ host: 'a.com' }), local({ host: 'b.com' })],
      new Map([[6, 1]])
    )
    expect(rows).toHaveLength(2)
  })

  it('rounds fractional seconds (the column is an integer)', () => {
    const rows = toSharedRows(1, '2026-07-15', [local({ seconds: 600.6 })], new Map([[6, 1]]))
    expect(rows[0].seconds).toBe(601)
  })
})

type Row = Parameters<typeof aggregateTeam>[0][number]

const row = (over: Partial<Row> = {}): Row => ({
  person: 'Oli',
  client_id: 1,
  client_name: 'MAAS Constructions',
  color: '#ef4444',
  billable_rate: 150,
  day: '2026-07-15',
  seconds: 3600,
  billable_seconds: 3600,
  ...over
})

describe('aggregateTeam', () => {
  it('sums a single person/client into every view', () => {
    const t = aggregateTeam([row()], 7)

    expect(t.totalSeconds).toBe(3600)
    expect(t.billableSeconds).toBe(3600)
    expect(t.people).toHaveLength(1)
    expect(t.people[0]).toMatchObject({ person: 'Oli', seconds: 3600, amount: 150 })
    expect(t.clients[0]).toMatchObject({ clientName: 'MAAS Constructions', amount: 150 })
    expect(t.daily[0]).toMatchObject({ day: '2026-07-15', seconds: 3600 })
  })

  it('keeps two people separate but sums them team-wide', () => {
    const t = aggregateTeam(
      [
        row({ person: 'Oli', seconds: 3600, billable_seconds: 3600 }),
        row({ person: 'Megs', seconds: 1800, billable_seconds: 1800 })
      ],
      7
    )

    expect(t.totalSeconds).toBe(5400)
    expect(t.people.map((p) => p.person)).toEqual(['Oli', 'Megs']) // sorted by time desc
    expect(t.people[0].seconds).toBe(3600)
    expect(t.people[1].seconds).toBe(1800)
    // One client row team-wide, holding both people's time.
    expect(t.clients).toHaveLength(1)
    expect(t.clients[0].seconds).toBe(5400)
    expect(t.clients[0].amount).toBe(225) // 1.5h @ 150
  })

  // The shared schema stores "no client" as -1 because Postgres PKs reject
  // NULL. It must surface as Unassigned/null, never as a client called "-1".
  it('maps the -1 sentinel back to unassigned', () => {
    const t = aggregateTeam(
      [row({ client_id: -1, client_name: null, color: null, billable_rate: null, billable_seconds: 0 })],
      7
    )

    expect(t.clients[0].clientId).toBeNull()
    expect(t.clients[0].clientName).toBe('Unassigned')
    expect(t.clients[0].amount).toBe(0)
    expect(t.billableSeconds).toBe(0)
  })

  // Unattributed time is the majority of a manual-timer user's day: it must
  // count toward total tracked but never toward billable value.
  it('counts unassigned time in the total but not the billable value', () => {
    const t = aggregateTeam(
      [
        row({ seconds: 3600, billable_seconds: 3600 }),
        row({
          client_id: -1,
          client_name: null,
          color: null,
          billable_rate: null,
          seconds: 7200,
          billable_seconds: 0
        })
      ],
      7
    )

    expect(t.totalSeconds).toBe(10800)
    expect(t.billableSeconds).toBe(3600)
    expect(t.clients.reduce((s, c) => s + c.amount, 0)).toBe(150)
  })

  it('splits one person across clients and days', () => {
    const t = aggregateTeam(
      [
        row({ client_id: 1, client_name: 'MAAS Constructions', day: '2026-07-15' }),
        row({ client_id: 2, client_name: 'QC Build', billable_rate: 100, day: '2026-07-16' })
      ],
      7
    )

    expect(t.people).toHaveLength(1)
    expect(t.people[0].clients).toHaveLength(2)
    expect(t.people[0].amount).toBe(250) // 150 + 100
    expect(t.daily.map((d) => d.day)).toEqual(['2026-07-15', '2026-07-16']) // chronological
  })

  it('returns empty structures for no rows', () => {
    const t = aggregateTeam([], 7)
    expect(t).toMatchObject({ totalSeconds: 0, billableSeconds: 0, people: [], clients: [], daily: [] })
  })
})
