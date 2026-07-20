// In-memory manual-timer state machine. The single source of truth for "is a
// timer running and for whom". Persists a row to timer_sessions on start and
// stamps end_time on stop. Broadcasts state changes so the tray, the picker,
// and every renderer window stay in sync.

import { BrowserWindow } from 'electron'
import type { TimerState, TimerSession } from '../shared/types'
import * as db from './db'
import { invalidateSession, captureSessionSnapshot } from './ingest'
import { getLastActiveAt } from './activitywatch'

// Defaults for the forgotten-timer guards. Both are configurable via settings.
export const DEFAULT_IDLE_AUTO_STOP_MINUTES = 15
const DEFAULT_MAX_SESSION_HOURS = 10
const IDLE_CHECK_INTERVAL_MS = 60_000

let state: TimerState = { status: 'idle' }
const listeners = new Set<(state: TimerState) => void>()
let idleTimer: ReturnType<typeof setInterval> | null = null
let checkingIdle = false

// Rehydrate on boot: if a session was left running (app crashed / force-quit),
// pick it back up so the user isn't silently losing tracked time — then
// immediately run the idle check, so a timer left running across an overnight
// crash/sleep is auto-stopped and back-dated rather than counting the whole gap.
export function initTimer(): void {
  const running = db.getRunningSession()
  if (running) {
    state = {
      status: 'running',
      sessionId: running.id,
      clientId: running.clientId,
      startTime: running.startTime
    }
    startIdleWatch()
    void checkIdle()
  }
}

function idleAutoStopMs(): number {
  const m = Number(db.getSetting('idle_auto_stop_minutes'))
  return (Number.isFinite(m) && m > 0 ? m : DEFAULT_IDLE_AUTO_STOP_MINUTES) * 60_000
}

function maxSessionMs(): number {
  const h = Number(db.getSetting('max_session_hours'))
  return (Number.isFinite(h) && h > 0 ? h : DEFAULT_MAX_SESSION_HOURS) * 3_600_000
}

function startIdleWatch(): void {
  stopIdleWatch()
  idleTimer = setInterval(() => void checkIdle(), IDLE_CHECK_INTERVAL_MS)
}

function stopIdleWatch(): void {
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}

// Auto-stop a forgotten timer. Preferred path: AW's AFK data — if the user has
// been idle >= the threshold, stop and back-date end_time to when they were
// last active, so trailing idle never inflates the session. If AFK data is
// unavailable we can't detect idle, so a hard max-duration cap is the safety
// net. (Displayed duration comes from the AFK-filtered snapshot either way, so
// even a capped end_time doesn't over-count active hours.)
async function checkIdle(): Promise<void> {
  if (state.status !== 'running' || checkingIdle) return
  checkingIdle = true
  try {
    if (state.status !== 'running') return
    const startMs = Date.parse(state.startTime)
    const now = Date.now()

    const lastActive = await getLastActiveAt(state.startTime)
    if (lastActive) {
      if (now - lastActive.getTime() >= idleAutoStopMs()) {
        const end = Math.max(lastActive.getTime(), startMs) // never before start
        stopTimer(new Date(end).toISOString())
      }
      return
    }

    // No AFK signal — safety net only.
    if (now - startMs >= maxSessionMs()) stopTimer(new Date(now).toISOString())
  } finally {
    checkingIdle = false
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
  startIdleWatch()
  broadcast()
  return session
}

// Stop the running timer. `endTimeISO` defaults to now; the idle auto-stop
// passes a back-dated time (the user's last active moment) so trailing idle
// isn't counted.
export function stopTimer(endTimeISO?: string): TimerSession | null {
  if (state.status !== 'running') return null
  stopIdleWatch()
  const session = db.endSession(state.sessionId, endTimeISO ?? new Date().toISOString())
  state = { status: 'idle' }
  if (session) {
    invalidateSession(session)
    // Freeze the session's activity breakdown now, while it's fresh. Reading
    // it live on every future view would let ActivityWatch's own buffering
    // drift the numbers out from under a record the user needs as proof of
    // work — capture it once here instead.
    captureSessionSnapshot(session).catch((err) => {
      console.error('[tally] failed to capture session snapshot', session.id, err)
    })
  }
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
