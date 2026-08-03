// Always-visible timer control at the top of the app. Shows the running
// client + a live elapsed clock, or a Start button when idle. For a client on a
// retainer it also shows how much of this month's included hours is left,
// counting down live as the timer runs.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { formatClock, formatHoursShort, formatRetainerRemaining } from '../format'
import { useRetainer } from '../useRetainer'

export function TimerBanner(): React.JSX.Element {
  const timer = useStore((s) => s.timer)
  const clients = useStore((s) => s.clients)
  const [now, setNow] = useState(Date.now())

  const running = timer.status === 'running'
  const elapsed = running ? (now - Date.parse(timer.startTime)) / 1000 : 0
  const retainer = useRetainer(running ? timer.clientId : null, elapsed)

  // Tick once a second while running so the clock advances.
  useEffect(() => {
    if (timer.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer.status])

  if (timer.status === 'running') {
    const client = clients.find((c) => c.id === timer.clientId)
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="font-medium">{client?.name ?? 'Unknown client'}</span>
          <span className="font-mono text-lg tabular-nums">{formatClock(elapsed)}</span>
          {retainer && (
            <span
              title={
                retainer.source === 'local'
                  ? "Team database unreachable — this machine's hours only"
                  : `Team-wide, this calendar month. Retainer: ${formatHoursShort(retainer.retainerHours)} h`
              }
              className={`rounded-full px-2.5 py-0.5 text-sm font-medium tabular-nums ${
                retainer.overBudget
                  ? 'bg-red-100 text-red-700'
                  : retainer.low
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-white text-slate-600'
              }`}
            >
              {formatRetainerRemaining(retainer.remainingSeconds)} of{' '}
              {formatHoursShort(retainer.retainerHours)} h
              {retainer.source === 'local' && ' *'}
            </span>
          )}
        </div>
        <button
          onClick={() => api.stopTimer()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Stop
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3 text-slate-500">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span>No timer running</span>
      </div>
      <button
        onClick={() => api.openPicker()}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Start timer
      </button>
    </div>
  )
}
