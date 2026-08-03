// Live retainer position for a client: how much of this calendar month's
// included hours the team has already used.
//
// Most of our clients are on a monthly retainer measured in hours, and the point
// of this module is to answer "how much is left?" WHILE work is happening rather
// than after the invoice. Two decisions shape it:
//
//  * The figure is TEAM-WIDE. A retainer is consumed by everyone who touches the
//    client, so a per-machine number would flatter us. The shared database is
//    the only place that knows the whole team's time, so that's the source; when
//    it isn't reachable we fall back to this machine's own sessions and say so
//    (`source: 'local'`) rather than pretending the number is complete.
//  * usedSeconds counts COMPLETED sessions only. A running session hasn't been
//    pushed yet, so the UI adds its live elapsed on top — that keeps the clock
//    ticking every second without re-querying, and can't double-count.

import * as db from './db'
import { fetchAllClientsUsedSeconds, fetchClientUsedSeconds } from './sync'
import { isConfigured } from './supabase'
import type { RetainerStatus } from '../shared/types'

/**
 * The current calendar month in the machine's LOCAL timezone, as ISO instants.
 * Local because "this month" means the month the team is living in, not UTC's —
 * the same reasoning as localDayISO in shared/format.ts.
 */
export function monthBounds(now: Date = new Date()): { startISO: string; endISO: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

/** Cached per client: the UI ticks every second and must not re-query that often. */
const CACHE_TTL_MS = 60 * 1000
const cache = new Map<number, { status: RetainerStatus; at: number }>()

/** Drop cached figures (e.g. after a sync, or when a client's retainer changes). */
export function invalidateRetainerCache(clientId?: number): void {
  if (clientId == null) cache.clear()
  else cache.delete(clientId)
}

export async function getRetainerStatus(
  clientId: number,
  opts: { force?: boolean } = {}
): Promise<RetainerStatus> {
  const cached = cache.get(clientId)
  if (!opts.force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.status

  const client = db.getClient(clientId)
  if (!client) throw new Error(`Unknown client ${clientId}`)

  const { startISO, endISO } = monthBounds()

  let usedSeconds: number
  let source: 'team' | 'local'
  if (isConfigured()) {
    try {
      usedSeconds = await fetchClientUsedSeconds(client.name, startISO, endISO)
      source = 'team'
    } catch (err) {
      // Never let the retainer readout break tracking — degrade to local.
      console.error('[retainer] team lookup failed, falling back to local:', err)
      usedSeconds = db.getClientActiveSecondsInRange(clientId, startISO, endISO)
      source = 'local'
    }
  } else {
    usedSeconds = db.getClientActiveSecondsInRange(clientId, startISO, endISO)
    source = 'local'
  }

  const status: RetainerStatus = {
    clientId,
    clientName: client.name,
    retainerHours: client.retainerHours,
    usedSeconds,
    source,
    asOf: new Date().toISOString()
  }
  cache.set(clientId, { status, at: Date.now() })
  return status
}

/**
 * Every client's retainer position for the current calendar month, in one round
 * trip. The dashboard needs the whole list at once; asking getRetainerStatus per
 * client would be one query each.
 *
 * Deliberately always the CALENDAR MONTH, whatever range the dashboard is
 * showing. A retainer is a monthly budget, so "used" against any other window
 * isn't a retainer position — it's just hours, and comparing a week's hours to a
 * month's inclusion is what made the old rolling ranges unreadable.
 */
export async function getAllRetainerStatuses(): Promise<RetainerStatus[]> {
  const clients = db.listClients()
  const { startISO, endISO } = monthBounds()

  let used: Map<string, number>
  let source: 'team' | 'local'
  if (isConfigured()) {
    try {
      used = await fetchAllClientsUsedSeconds(startISO, endISO)
      source = 'team'
    } catch (err) {
      console.error('[retainer] team lookup failed, falling back to local:', err)
      used = db.getAllClientsActiveSecondsInRange(startISO, endISO)
      source = 'local'
    }
  } else {
    used = db.getAllClientsActiveSecondsInRange(startISO, endISO)
    source = 'local'
  }

  const asOf = new Date().toISOString()
  const at = Date.now()
  return clients.map((c) => {
    const status: RetainerStatus = {
      clientId: c.id,
      clientName: c.name,
      retainerHours: c.retainerHours,
      usedSeconds: used.get(c.name) ?? 0,
      source,
      asOf
    }
    // Same figures the single-client path would return, so seed its cache too —
    // the timer banner then starts from the dashboard's already-paid-for query.
    cache.set(c.id, { status, at })
    return status
  })
}
