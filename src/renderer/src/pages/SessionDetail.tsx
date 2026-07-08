import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { TimerSession, SessionActivity } from '@shared/types'
import { api } from '../api'
import { useStore } from '../store'
import { formatDate, formatDuration } from '../format'

export function SessionDetail(): React.JSX.Element {
  const { id } = useParams()
  const sessionId = Number(id)
  const [session, setSession] = useState<TimerSession | null>(null)
  const [activities, setActivities] = useState<SessionActivity[]>([])
  const [loading, setLoading] = useState(true)
  const clients = useStore((s) => s.clients)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, acts] = await Promise.all([
      api.getSession(sessionId),
      api.getSessionActivities(sessionId)
    ])
    setSession(s)
    setActivities(acts)
    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  const clientName = session
    ? clients.find((c) => c.id === session.clientId)?.name ?? `Client #${session.clientId}`
    : ''

  async function toggleExclude(a: SessionActivity): Promise<void> {
    if (a.excluded && a.exclusionId != null) {
      await api.includeActivity(a.exclusionId, sessionId)
    } else {
      await api.excludeActivity(sessionId, a.app, a.host, a.activity)
    }
    await load()
  }

  const includedSeconds = activities
    .filter((a) => !a.excluded)
    .reduce((sum, a) => sum + a.seconds, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link to="/sessions" className="text-sm text-slate-500 hover:text-slate-900">
          ← Sessions
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{clientName}</h1>
        {session && (
          <p className="text-sm text-slate-500">
            {formatDate(session.startTime)}
            {session.endTime ? ` – ${formatDate(session.endTime)}` : ' – running'}
            {' · '}
            {formatDuration(includedSeconds)} counted
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-medium">Activities in this session</h2>
          <span className="text-sm text-slate-500">
            Exclude anything that wasn&apos;t work for this client
          </span>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-slate-500">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="px-4 py-6 text-slate-500">
            No activity captured in this window. Is ActivityWatch running?
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 font-medium">App</th>
                <th className="px-4 py-2 font-medium">Activity</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a, i) => (
                <tr
                  key={i}
                  className={`border-b border-slate-50 ${a.excluded ? 'text-slate-400' : ''}`}
                >
                  <td className="px-4 py-2">{a.app}</td>
                  <td className={`px-4 py-2 ${a.excluded ? 'line-through' : ''}`}>
                    {a.activity}
                    {a.host && <span className="ml-2 text-xs text-slate-400">{a.host}</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatDuration(a.seconds)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleExclude(a)}
                      className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      {a.excluded ? 'Restore' : 'Exclude'}
                    </button>
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
