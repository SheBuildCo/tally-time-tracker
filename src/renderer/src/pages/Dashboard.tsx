import { useEffect, useState } from 'react'
import type { ClientSummary, RangeSummary, TeamSummary } from '@shared/types'
import { api } from '../api'
import { formatDuration, formatCurrency } from '../format'
import { useStore } from '../store'

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 }
]

export function Dashboard(): React.JSX.Element {
  const [days, setDays] = useState(7)
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [summary, setSummary] = useState<RangeSummary | null>(null)
  const [team, setTeam] = useState<TeamSummary | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [teamEnabled, setTeamEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const timer = useStore((s) => s.timer)

  // Only offer the Team toggle once team sync is set up in Settings.
  useEffect(() => {
    api.teamStatus().then((s) => setTeamEnabled(s.configured))
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    api.analyticsRange(days).then((s) => {
      if (active) {
        setSummary(s)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
    // Re-fetch when the timer stops (new data may have landed).
  }, [days, timer.status])

  // The team view reads the shared database, so it can fail in ways the local
  // view can't (offline, bad credentials). Surface that instead of a blank card.
  useEffect(() => {
    if (scope !== 'team' || !teamEnabled) return
    let active = true
    setTeamError(null)
    api
      .teamSummary(days)
      .then((t) => active && setTeam(t))
      .catch((err: Error) => active && setTeamError(err.message))
    return () => {
      active = false
    }
  }, [scope, days, teamEnabled, timer.status])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          {teamEnabled && (
            <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1">
              {(['mine', 'team'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`rounded px-3 py-1 text-sm ${
                    scope === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {s === 'mine' ? 'Mine' : 'Team'}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded px-3 py-1 text-sm ${
                  days === r.days ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {scope === 'mine' ? (
        loading || !summary ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          <>
            <StatRow
              totalSeconds={summary.totalSeconds}
              billableSeconds={summary.billableSeconds}
              amount={summary.clients.reduce((sum, c) => sum + c.amount, 0)}
            />
            <ByClient
              clients={summary.clients}
              empty="No activity yet. Start a timer to begin tracking."
            />
          </>
        )
      ) : teamError ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Couldn’t load the team view: {teamError}
        </section>
      ) : !team ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <StatRow
            totalSeconds={team.totalSeconds}
            billableSeconds={team.billableSeconds}
            amount={team.clients.reduce((sum, c) => sum + c.amount, 0)}
          />

          <section className="rounded-lg border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-3 font-medium">By person</h2>
            {team.people.length === 0 ? (
              <p className="px-4 py-6 text-slate-500">
                Nobody has synced any time yet. Time appears here once teammates set up team sync.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 font-medium">Person</th>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Billable</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {team.people.map((p) => (
                    <tr key={p.person} className="border-b border-slate-50">
                      <td className="px-4 py-2">{p.person}</td>
                      <td className="px-4 py-2">{formatDuration(p.seconds)}</td>
                      <td className="px-4 py-2">{formatDuration(p.billableSeconds)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <ByClient
            clients={team.clients}
            empty="No team activity in this range."
            title="By client (whole team)"
          />
        </>
      )}
    </div>
  )
}

function StatRow({
  totalSeconds,
  billableSeconds,
  amount
}: {
  totalSeconds: number
  billableSeconds: number
  amount: number
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard label="Total tracked" value={formatDuration(totalSeconds)} />
      <StatCard label="Billable" value={formatDuration(billableSeconds)} />
      <StatCard label="Billable value" value={formatCurrency(amount)} />
    </div>
  )
}

// Shared by the personal and team views — the team summary deliberately reuses
// RangeSummary's ClientSummary shape so this renders both unchanged.
function ByClient({
  clients,
  empty,
  title = 'By client'
}: {
  clients: ClientSummary[]
  empty: string
  title?: string
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-3 font-medium">{title}</h2>
      {clients.length === 0 ? (
        <p className="px-4 py-6 text-slate-500">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Billable</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={String(c.clientId)} className="border-b border-slate-50">
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.clientName}
                  </span>
                </td>
                <td className="px-4 py-2">{formatDuration(c.seconds)}</td>
                <td className="px-4 py-2">{formatDuration(c.billableSeconds)}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
