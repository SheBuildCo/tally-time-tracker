// Client work-summary report generation: aggregates a client's tracked
// sessions over a date range into a PDF (built from the user's rich-text
// template) and a raw CSV. Sessions — not the rule-based daily_activity
// rollup — are the source of truth here: only time the user explicitly
// tracked for a client via the manual timer belongs in a report.

import { BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { parse } from 'node-html-parser'
import type { TimerSession, SessionActivity, ReportHistoryEntry } from '../shared/types'
import { formatDay, formatHoursMinutes, formatClock } from '../shared/format'
import * as db from './db'
import { getSessionActivities } from './ingest'

export interface SessionWithActivities {
  session: TimerSession
  activities: SessionActivity[] // excluded rows already filtered out
}

export interface ReportData {
  clientId: number
  clientName: string
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

const CSV_HEADER = [
  'Session Date',
  'Session Start',
  'Session End',
  'App',
  'Host',
  'Activity',
  'Duration (seconds)',
  'Duration (H:MM:SS)'
]

// One row per non-excluded activity within each session. A session with no
// remaining activities after exclusion contributes no rows.
export function buildCsv(data: ReportData): string {
  const rows: string[] = [CSV_HEADER.join(',')]

  for (const { session, activities } of data.sessions) {
    for (const activity of activities) {
      const row = [
        formatDay(session.startTime),
        session.startTime,
        session.endTime ?? '',
        activity.app,
        activity.host,
        activity.activity,
        String(Math.round(activity.seconds)),
        formatClock(activity.seconds)
      ].map(csvEscape)
      rows.push(row.join(','))
    }
  }

  // UTF-8 BOM so Excel on Windows doesn't mis-decode non-ASCII names.
  return '﻿' + rows.join('\r\n')
}

// ---- Merge-field substitution ----
//
// The template editor (TipTap) only ever produces structurally well-defined
// `[data-merge-field]` elements — never free-form text a user typed — so
// substitution is a DOM-attribute-driven replace, not a regex pass over raw
// HTML. This avoids false-positive replacements inside user-authored prose.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sessionDurationSeconds(session: TimerSession): number {
  if (!session.endTime) return 0
  return (Date.parse(session.endTime) - Date.parse(session.startTime)) / 1000
}

function renderSessionsTableHtml(data: ReportData): string {
  const rows = data.sessions
    .map(({ session }) => {
      return `<tr>
        <td>${escapeHtml(formatDay(session.startTime))}</td>
        <td>${escapeHtml(formatHoursMinutes(sessionDurationSeconds(session)))}</td>
        <td>${escapeHtml(data.clientName)}</td>
      </tr>`
    })
    .join('')

  if (data.sessions.length === 0) {
    return `<table class="sessions-table"><thead><tr><th>Date</th><th>Duration</th><th>Client</th></tr></thead>
      <tbody><tr><td colspan="3" class="empty">No sessions in this period.</td></tr></tbody></table>`
  }

  return `<table class="sessions-table">
    <thead><tr><th>Date</th><th>Duration</th><th>Client</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function dateRangeLabel(startDay: string, endDay: string): string {
  return `${formatDay(`${startDay}T00:00:00.000Z`)} – ${formatDay(`${endDay}T00:00:00.000Z`)}`
}

export function substituteMergeFields(templateHtml: string, data: ReportData): string {
  const root = parse(templateHtml)

  for (const el of root.querySelectorAll('[data-merge-field]')) {
    const field = el.getAttribute('data-merge-field')
    switch (field) {
      case 'client_name':
        el.replaceWith(escapeHtml(data.clientName))
        break
      case 'date_range':
        el.replaceWith(escapeHtml(dateRangeLabel(data.startDay, data.endDay)))
        break
      case 'generated_date':
        el.replaceWith(escapeHtml(formatDay(new Date().toISOString())))
        break
      case 'sessions_table':
        el.replaceWith(renderSessionsTableHtml(data))
        break
      default:
        // Unknown field key (e.g. from a stale template) — leave a visible
        // placeholder rather than silently dropping content.
        el.replaceWith(`[Unknown field: ${escapeHtml(field ?? '')}]`)
    }
  }

  return root.toString()
}

// ---- PDF rendering ----

const REPORT_PRINT_CSS = `
  @page { margin: 20mm 16mm; }
  body { font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; color: #1e293b; font-size: 12pt; line-height: 1.5; }
  h1, h2, h3 { color: #0f172a; margin-bottom: 0.4em; }
  p { margin: 0.6em 0; }
  table.sessions-table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 11pt; }
  table.sessions-table th, table.sessions-table td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; }
  table.sessions-table th { background: #f1f5f9; font-weight: 600; }
  table.sessions-table td.empty { text-align: center; color: #64748b; font-style: italic; }
`

function wrapReportDocument(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${REPORT_PRINT_CSS}</style>
  </head>
  <body>${bodyHtml}</body>
</html>`
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    const loaded = new Promise<void>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve())
    })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await loaded
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
    return buffer
  } finally {
    win.destroy()
  }
}

async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const templateHtml = db.getSetting('report_template_html') ?? ''
  const mergedHtml = substituteMergeFields(templateHtml, data)
  const fullDocument = wrapReportDocument(mergedHtml)
  return renderHtmlToPdf(fullDocument)
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

export function reportFilePaths(clientName: string, startDay: string, endDay: string): {
  pdfPath: string
  csvPath: string
} {
  const base = `${sanitizeForFilename(clientName)}_${startDay}_to_${endDay}_${Date.now()}`
  const dir = reportsDir()
  return { pdfPath: join(dir, `${base}.pdf`), csvPath: join(dir, `${base}.csv`) }
}

// Orchestrates a full report: aggregate session data, write the CSV, render
// and write the PDF, then record the result in report_history.
export async function generateReport(
  clientId: number,
  startDay: string,
  endDay: string
): Promise<ReportHistoryEntry> {
  const data = await getReportData(clientId, startDay, endDay)
  const { pdfPath, csvPath } = reportFilePaths(data.clientName, startDay, endDay)

  const csv = buildCsv(data)
  writeFileSync(csvPath, csv, 'utf-8')

  const pdfBuffer = await renderReportPdf(data)
  writeFileSync(pdfPath, pdfBuffer)

  return db.createReportHistoryEntry({
    clientId,
    startDate: startDay,
    endDate: endDay,
    pdfPath,
    csvPath
  })
}
