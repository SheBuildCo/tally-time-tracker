// Always-visible timer control at the top of the app. Shows the running
// client + a live elapsed clock, or a Start button when idle.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { formatClock } from '../format'

export function TimerBanner(): React.JSX.Element {
  const timer = useStore((s) => s.timer)
  const clients = useStore((s) => s.clients)
  const [now, setNow] = useState(Date.now())

  // Tick once a second while running so the clock advances.
  useEffect(() => {
    if (timer.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer.status])

  if (timer.status === 'running') {
    const client = clients.find((c) => c.id === timer.clientId)
    const elapsed = (now - Date.parse(timer.startTime)) / 1000
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="font-medium">{client?.name ?? 'Unknown client'}</span>
          <span className="font-mono text-lg tabular-nums">{formatClock(elapsed)}</span>
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
