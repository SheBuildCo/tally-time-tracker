import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TimerSession } from '@shared/types'
import { api } from '../api'
import { useStore } from '../store'
import { formatDate, formatDuration } from '../format'

export function Sessions(): React.JSX.Element {
  const [sessions, setSessions] = useState<TimerSession[]>([])
  const clients = useStore((s) => s.clients)
  const timer = useStore((s) => s.timer)

  useEffect(() => {
    api.listSessions(200).then(setSessions)
  }, [timer.status])

  const clientName = (id: number): string =>
    clients.find((c) => c.id === id)?.name ?? `Client #${id}`

  const duration = (s: TimerSession): number => {
    const end = s.endTime ? Date.parse(s.endTime) : Date.now()
    return (end - Date.parse(s.startTime)) / 1000
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-xl font-semibold">Sessions</h1>

      <div className="rounded-lg border border-slate-200 bg-white">
        {sessions.length === 0 ? (
          <p className="px-4 py-6 text-slate-500">
            No sessions yet. Press your timer shortcut to start one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2">{formatDate(s.startTime)}</td>
                  <td className="px-4 py-2">{clientName(s.clientId)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatDuration(duration(s))}</td>
                  <td className="px-4 py-2">
                    {s.endTime ? (
                      <span className="text-slate-500">Complete</span>
                    ) : (
                      <span className="font-medium text-emerald-600">Running</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to={`/sessions/${s.id}`}
                      className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
