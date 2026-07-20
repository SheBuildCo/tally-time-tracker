// The always-on-top pinned timer widget (its own small window). Shows which
// client the timer is on and a live elapsed clock so a running timer is never
// forgotten, with a Stop button. Main shows this window only while a timer runs
// (see index.ts), so idle is a transient state during teardown.
//
// The whole card is a drag region (-webkit-app-region: drag) so it can be moved
// like a sticky note; the Stop button opts out so it stays clickable.

import { useEffect, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { formatClock } from '../format'

const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

export function PinnedTimer(): React.JSX.Element {
  const timer = useStore((s) => s.timer)
  const clients = useStore((s) => s.clients)
  const init = useStore((s) => s.init)
  const [now, setNow] = useState(Date.now())

  // Pull initial timer state + client names; live updates arrive via the store's
  // onTimerState subscription.
  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (timer.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer.status])

  if (timer.status !== 'running') {
    return <div style={DRAG} className="h-screen w-screen bg-slate-900" />
  }

  const client = clients.find((c) => c.id === timer.clientId)
  const elapsed = (now - Date.parse(timer.startTime)) / 1000

  return (
    <div
      style={DRAG}
      className="flex h-screen w-screen select-none items-center gap-2 bg-slate-900 px-3 text-white"
    >
      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium leading-tight">
          {client?.name ?? 'Tracking'}
        </div>
        <div className="font-mono text-base leading-tight tabular-nums">{formatClock(elapsed)}</div>
      </div>
      <button
        style={NO_DRAG}
        onClick={() => api.stopTimer()}
        className="shrink-0 rounded bg-white/15 px-2 py-1 text-xs font-medium hover:bg-white/25"
      >
        Stop
      </button>
    </div>
  )
}
