import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import type { TimerSession, SessionActivity } from '@shared/types'
import { api } from '../api'
import { useStore } from '../store'
import { formatDate, formatDuration } from '../format'

export function SessionDetail(): React.JSX.Element {
  const { id } = useParams()
  const sessionId = Number(id)
  const navigate = useNavigate()
  const [session, setSession] = useState<TimerSession | null>(null)
  const [activities, setActivities] = useState<SessionActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

  async function deleteSession(): Promise<void> {
    setDeleting(true)
    try {
      await api.deleteSession(sessionId)
      navigate('/sessions')
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  const includedSeconds = activities
    .filter((a) => !a.excluded)
    .reduce((sum, a) => sum + a.seconds, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
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
        <button
          onClick={() => setConfirmingDelete(true)}
          className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete session
        </button>
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
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="w-32 px-4 py-2 font-medium">App</th>
                <th className="px-4 py-2 font-medium">Activity</th>
                <th className="w-20 px-4 py-2 font-medium">Time</th>
                <th className="w-24 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a, i) => (
                <tr
                  key={i}
                  className={`border-b border-slate-50 ${a.excluded ? 'text-slate-400' : ''}`}
                >
                  <td className="break-words px-4 py-2 align-top">{a.app}</td>
                  <td className={`break-words px-4 py-2 align-top ${a.excluded ? 'line-through' : ''}`}>
                    {a.activity}
                    {a.host && <div className="break-words text-xs text-slate-400">{a.host}</div>}
                  </td>
                  <td className="px-4 py-2 align-top tabular-nums">{formatDuration(a.seconds)}</td>
                  <td className="px-4 py-2 text-right align-top">
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

      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleting && setConfirmingDelete(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Delete this session?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This permanently removes the session and its activity from Tally and the shared team
              database. It won’t appear in any report. This can’t be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={deleteSession}
                disabled={deleting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
