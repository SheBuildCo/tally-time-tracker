// Client work-summary report generation: aggregates a client's tracked
// sessions over a date range into a clean CSV. Sessions — not the rule-based
// daily_activity rollup — are the source of truth here: only time the user
// explicitly tracked for a client via the manual timer belongs in a report.
//
// The CSV is the sole output: our monthly process is CSV -> Claude -> Canva, so
// the file must be readable by someone with no context. One row per session,
// all times in the machine's local timezone, a single decimal-hours duration.

import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import type { TimerSession, SessionActivity, ReportHistoryEntry } from '../shared/types'
import { formatDay, formatTimeOfDay, formatHoursDecimal } from '../shared/format'
import { sessionActiveSeconds } from './analytics'
import * as db from './db'
import { getSessionActivities } from './ingest'

export interface SessionWithActivities {
  session: TimerSession
  activities: SessionActivity[] // excluded rows already filtered out
}

export interface ReportData {
  clientId: number
  clientName: string
  billableRate: number
  startDay: string // YYYY-MM-DD
  endDay: string // YYYY-MM-DD
  sessions: SessionWithActivities[]
}

// Fetch every completed session for a client in [startDay, endDay], each with
// its non-excluded activity breakdown attached.
export async function getReportData(
  clientId: number,
  startDay: string,
  endDay: string
): Promise<ReportData> {
  const client = db.getClient(clientId)
  if (!client) throw new Error(`Unknown client ${clientId}`)

  const startISO = `${startDay}T00:00:00.000Z`
  const endISO = `${endDay}T23:59:59.999Z`
  const sessions = db.getSessionsForClientInRange(clientId, startISO, endISO)

  const sessionsWithActivities: SessionWithActivities[] = []
  for (const session of sessions) {
    const activities = (await getSessionActivities(session.id)).filter((a) => !a.excluded)
    sessionsWithActivities.push({ session, activities })
  }

  return {
    clientId,
    clientName: client.name,
    billableRate: client.billableRate,
    startDay,
    endDay,
    sessions: sessionsWithActivities
  }
}

// ---- CSV ----

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const CSV_HEADER = ['Date', 'Client', 'Description', 'Start', 'End', 'Hours', 'Amount']

function formatAmount(hours: number, rate: number): string {
  if (rate <= 0) return '' // non-billable client — leave blank rather than $0.00
  return (hours * rate).toFixed(2)
}

// One row per completed session, in local time. Duration is the session's
// active tracked time (sessionActiveSeconds), and Amount = Hours × rate so the
// two columns reconcile for a reader. Sessions whose activities were all
// excluded (zero active time) are skipped rather than shown as 0h rows.
export function buildCsv(data: ReportData): string {
  const rows: string[] = [CSV_HEADER.join(',')]

  for (const { session, activities } of data.sessions) {
    const seconds = sessionActiveSeconds(activities)
    if (seconds <= 0) continue
    const hours = Number(formatHoursDecimal(seconds))
    const row = [
      formatDay(session.startTime),
      data.clientName,
      session.notes ?? '',
      formatTimeOfDay(session.startTime),
      session.endTime ? formatTimeOfDay(session.endTime) : '',
      hours.toFixed(2),
      formatAmount(hours, data.billableRate)
    ].map(csvEscape)
    rows.push(row.join(','))
  }

  // UTF-8 BOM so Excel on Windows doesn't mis-decode non-ASCII names.
  return '﻿' + rows.join('\r\n')
}

// ---- File output ----

function reportsDir(): string {
  const dir = join(db.resolveDataDir(), 'reports')
  mkdirSync(dir, { recursive: true })
  return dir
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'report'
}

export function reportFilePath(clientName: string, startDay: string, endDay: string): string {
  const base = `${sanitizeForFilename(clientName)}_${startDay}_to_${endDay}_${Date.now()}`
  return join(reportsDir(), `${base}.csv`)
}

// Orchestrates a full report: aggregate session data, write the CSV, and record
// the result in report_history.
export async function generateReport(
  clientId: number,
  startDay: string,
  endDay: string
): Promise<ReportHistoryEntry> {
  const data = await getReportData(clientId, startDay, endDay)
  const csvPath = reportFilePath(data.clientName, startDay, endDay)

  writeFileSync(csvPath, buildCsv(data), 'utf-8')

  return db.createReportHistoryEntry({
    clientId,
    startDate: startDay,
    endDate: endDay,
    csvPath
  })
}
