// The popup shown when the user hits the timer shortcut. Lists clients with
// number-key + arrow navigation; Enter starts a timer for the selected client
// and closes the window. Escape dismisses.

import { useEffect, useState } from 'react'
import type { Client, TimerState } from '@shared/types'
import { api } from '../api'

export function ClientPicker(): React.JSX.Element {
  const [clients, setClients] = useState<Client[]>([])
  const [selected, setSelected] = useState(0)
  const [timer, setTimer] = useState<TimerState>({ status: 'idle' })

  useEffect(() => {
    api.listClients().then(setClients)
    api.getTimerState().then(setTimer)
  }, [])

  async function choose(client: Client): Promise<void> {
    await api.startTimer(client.id)
    await api.closePicker()
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        api.closePicker()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, clients.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (clients[selected]) choose(clients[selected])
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        if (clients[idx]) choose(clients[idx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clients, selected])

  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="text-sm font-medium text-slate-900">Track time for…</div>
        {timer.status === 'running' && (
          <div className="mt-1 text-xs text-amber-600">
            A timer is running — choosing switches clients
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {clients.length === 0 ? (
          <p className="px-2 py-4 text-sm text-slate-500">
            No clients yet. Add one in Tally first.
          </p>
        ) : (
          clients.map((c, i) => (
            <button
              key={c.id}
              onClick={() => choose(c)}
              onMouseEnter={() => setSelected(i)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                selected === i ? 'bg-slate-900 text-white' : 'text-slate-800 hover:bg-slate-100'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="flex-1 truncate">{c.name}</span>
              {i < 9 && (
                <kbd
                  className={`rounded px-1.5 text-xs ${
                    selected === i ? 'bg-white/20' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {i + 1}
                </kbd>
              )}
            </button>
          ))
        )}
      </div>
      <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        ↑↓ navigate · Enter select · Esc cancel
      </div>
    </div>
  )
}
