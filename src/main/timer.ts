// In-memory manual-timer state machine. The single source of truth for "is a
// timer running and for whom". Persists a row to timer_sessions on start and
// stamps end_time on stop. Broadcasts state changes so the tray, the picker,
// and every renderer window stay in sync.

import { BrowserWindow } from 'electron'
import type { TimerState, TimerSession } from '../shared/types'
import * as db from './db'
import { invalidateSession } from './ingest'

let state: TimerState = { status: 'idle' }
const listeners = new Set<(state: TimerState) => void>()

// Rehydrate on boot: if a session was left running (app crashed / force-quit),
// pick it back up so the user isn't silently losing tracked time.
export function initTimer(): void {
  const running = db.getRunningSession()
  if (running) {
    state = {
      status: 'running',
      sessionId: running.id,
      clientId: running.clientId,
      startTime: running.startTime
    }
  }
}

export function getState(): TimerState {
  return state
}

export function onStateChange(cb: (state: TimerState) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function broadcast(): void {
  for (const cb of listeners) cb(state)
  // Push to every renderer window so React stores update without polling.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('timer:state', state)
  }
}

export function startTimer(clientId: number): TimerSession {
  // If a timer is already running, stop it first (switching clients).
  if (state.status === 'running') stopTimer()

  const session = db.createSession(clientId, new Date().toISOString())
  state = {
    status: 'running',
    sessionId: session.id,
    clientId: session.clientId,
    startTime: session.startTime
  }
  broadcast()
  return session
}

export function stopTimer(): TimerSession | null {
  if (state.status !== 'running') return null
  const session = db.endSession(state.sessionId, new Date().toISOString())
  state = { status: 'idle' }
  if (session) invalidateSession(session)
  broadcast()
  return session
}

// Toggle used by the global shortcut: returns whether a picker should open
// (i.e. we were idle and need the user to choose a client).
export function toggleTimer(): { opened: boolean } {
  if (state.status === 'running') {
    stopTimer()
    return { opened: false }
  }
  return { opened: true }
}
