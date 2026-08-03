// Live retainer readout for the running timer, shared by the in-app banner and
// the pinned widget so the two can never show different numbers.
//
// The main process gives us the team's used seconds for the current calendar
// month, counting COMPLETED sessions only. The session running right now isn't
// in that figure yet, so we subtract the live elapsed on top — that's what makes
// the number tick down every second without hitting the database every second.
// The baseline is refreshed periodically to pick up teammates' finished work.

import { useEffect, useState } from 'react'
import { api } from './api'
import type { RetainerStatus } from '@shared/types'

/** How often the team-wide baseline is refetched while a timer runs. */
const REFRESH_MS = 60 * 1000

export interface LiveRetainer {
  retainerHours: number
  remainingSeconds: number // negative once the retainer is blown
  overBudget: boolean
  low: boolean // under 10% of the retainer left
  source: 'team' | 'local'
}

/**
 * `clientId` null (or no timer running) disables the hook. `elapsedSeconds` is
 * the running session's live elapsed time. Returns null when the client has no
 * retainer configured or the figure isn't loaded yet — callers render nothing.
 */
export function useRetainer(clientId: number | null, elapsedSeconds: number): LiveRetainer | null {
  const [status, setStatus] = useState<RetainerStatus | null>(null)

  useEffect(() => {
    // No fetch when there's nothing running. Any status left over from the
    // previous client is discarded at render time by the clientId check below,
    // so there's nothing to clear here.
    if (clientId == null) return

    let cancelled = false
    async function load(): Promise<void> {
      try {
        const s = await api.retainerStatus(clientId as number)
        if (!cancelled) setStatus(s)
      } catch {
        // A missing retainer figure must never break the timer UI.
        if (!cancelled) setStatus(null)
      }
    }

    void load()
    const id = setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [clientId])

  if (!status || status.clientId !== clientId || status.retainerHours <= 0) return null

  const totalSeconds = status.retainerHours * 3600
  const remainingSeconds = totalSeconds - status.usedSeconds - Math.max(0, elapsedSeconds)

  return {
    retainerHours: status.retainerHours,
    remainingSeconds,
    overBudget: remainingSeconds < 0,
    low: remainingSeconds >= 0 && remainingSeconds < totalSeconds * 0.1,
    source: status.source
  }
}
