import { useEffect, useState } from 'react'
import type { RangeSummary } from '@shared/types'
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
  const [summary, setSummary] = useState<RangeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useStore((s) => s.timer)

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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
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

      {loading || !summary ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total tracked" value={formatDuration(summary.totalSeconds)} />
            <StatCard label="Billable" value={formatDuration(summary.billableSeconds)} />
            <StatCard
              label="Billable value"
              value={formatCurrency(summary.clients.reduce((sum, c) => sum + c.amount, 0))}
            />
          </div>

          <section className="rounded-lg border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-4 py-3 font-medium">By client</h2>
            {summary.clients.length === 0 ? (
              <p className="px-4 py-6 text-slate-500">
                No activity yet. Start a timer to begin tracking.
              </p>
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
                  {summary.clients.map((c) => (
                    <tr key={String(c.clientId)} className="border-b border-slate-50">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
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
        </>
      )}
    </div>
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
