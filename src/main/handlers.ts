// Central IPC registry. Every channel the renderer can call is defined here and
// exposed verbatim through the preload bridge as window.tally.<method>. Keeping
// them in one map makes the preload and the typed renderer API trivial to keep
// in sync.

import { ipcMain, shell } from 'electron'
import * as db from './db'
import * as timer from './timer'
import { getRangeRows, getSessionActivities, invalidateSession } from './ingest'
import { buildRangeSummary } from './analytics'
import { isAvailable } from './activitywatch'
import { generateReport } from './reports'
import { fetchTeamSummary, getLastSyncResult, syncNow } from './sync'
import {
  PERSON_NAME_KEY,
  SUPABASE_URL_KEY,
  getPersonName,
  getSupabaseUrl,
  isConfigured,
  testConnection
} from './supabase'
import type { Client, MappingRule, Settings, TeamStatus } from '../shared/types'

// Side-effecting capabilities the handlers need but that live in main/index or
// other modules. Injected to avoid circular imports.
export interface HandlerContext {
  openPicker: () => void
  closePicker: () => void
  updateShortcuts: () => void
  setAutoLaunch: (enabled: boolean) => void
}

function readSettings(): Settings {
  return {
    shortcutToggle: db.getSetting('shortcut_toggle') ?? 'CommandOrControl+Shift+T',
    shortcutPicker: db.getSetting('shortcut_picker') ?? 'CommandOrControl+Shift+P',
    autoLaunch: db.getSetting('auto_launch') === 'true',
    trackingStartedAt: db.getSetting('tracking_started_at') ?? new Date().toISOString(),
    awStatus: false // filled in live by settings:get
  }
}

export function registerHandlers(ctx: HandlerContext): void {
  const handlers: Record<string, (...args: any[]) => any> = {
    // Clients
    'clients:list': () => db.listClients(),
    'clients:create': (input: Omit<Client, 'id'>) => db.createClient(input),
    'clients:update': (id: number, input: Partial<Omit<Client, 'id'>>) =>
      db.updateClient(id, input),
    'clients:delete': (id: number) => db.deleteClient(id),

    // Rules
    'rules:list': () => db.listRules(),
    'rules:create': (input: Omit<MappingRule, 'id'>) => db.createRule(input),
    'rules:delete': (id: number) => db.deleteRule(id),

    // Timer
    'timer:start': (clientId: number) => timer.startTimer(clientId),
    'timer:stop': () => timer.stopTimer(),
    'timer:getState': () => timer.getState(),
    'timer:openPicker': () => ctx.openPicker(),
    'picker:close': () => ctx.closePicker(),

    // Sessions
    'sessions:list': (limit?: number) => db.listSessions(limit),
    'sessions:get': (id: number) => db.getSession(id),
    'sessions:activities': (id: number) => getSessionActivities(id),
    'sessions:exclude': (sessionId: number, app: string, host: string, activity: string) => {
      const ex = db.addExclusion(sessionId, app, host, activity)
      const session = db.getSession(sessionId)
      if (session) invalidateSession(session)
      return ex
    },
    'sessions:include': (exclusionId: number, sessionId: number) => {
      db.removeExclusion(exclusionId)
      const session = db.getSession(sessionId)
      if (session) invalidateSession(session)
    },

    // Analytics
    'analytics:range': async (days: number) => {
      const rows = await getRangeRows(days)
      return buildRangeSummary(rows, db.listClients(), days)
    },

    // Settings
    'settings:get': async (): Promise<Settings> => {
      const s = readSettings()
      s.awStatus = await isAvailable()
      return s
    },
    'settings:updateShortcuts': (toggle: string, picker: string) => {
      db.setSetting('shortcut_toggle', toggle)
      db.setSetting('shortcut_picker', picker)
      ctx.updateShortcuts()
    },
    'settings:setAutoLaunch': (enabled: boolean) => {
      db.setSetting('auto_launch', enabled ? 'true' : 'false')
      ctx.setAutoLaunch(enabled)
    },
    'settings:clearActivityData': () => db.clearActivityData(),

    // Reports
    'reports:generate': (clientId: number, startDay: string, endDay: string) =>
      generateReport(clientId, startDay, endDay),
    'reports:history': (clientId?: number) => db.listReportHistory(clientId),
    'reports:openFile': (path: string) => shell.openPath(path),
    'reports:getTemplate': () => db.getSetting('report_template_html'),
    'reports:saveTemplate': (html: string) => db.setSetting('report_template_html', html),

    // Team sync (shared Supabase database). Every one of these is safe to call
    // when team sync isn't configured — the UI stays usable either way.
    'team:status': (): TeamStatus => ({
      configured: isConfigured(),
      personName: getPersonName(),
      hasUrl: !!getSupabaseUrl(),
      lastSync: getLastSyncResult()
    }),
    'team:setup': (personName: string, url: string) => {
      db.setSetting(PERSON_NAME_KEY, personName.trim())
      db.setSetting(SUPABASE_URL_KEY, url.trim())
      return { configured: isConfigured() }
    },
    'team:test': (url?: string) => testConnection(url),
    'team:sync': () => syncNow(),
    'team:summary': (days: number) => fetchTeamSummary(days),

    // ActivityWatch
    'aw:health': () => isAvailable()
  }

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) => fn(...args))
  }
}

// The channel list is also the contract the preload iterates over.
export const CHANNELS = [
  'clients:list',
  'clients:create',
  'clients:update',
  'clients:delete',
  'rules:list',
  'rules:create',
  'rules:delete',
  'timer:start',
  'timer:stop',
  'timer:getState',
  'timer:openPicker',
  'picker:close',
  'sessions:list',
  'sessions:get',
  'sessions:activities',
  'sessions:exclude',
  'sessions:include',
  'analytics:range',
  'settings:get',
  'settings:updateShortcuts',
  'settings:setAutoLaunch',
  'settings:clearActivityData',
  'aw:health',
  'reports:generate',
  'reports:history',
  'reports:openFile',
  'reports:getTemplate',
  'reports:saveTemplate',
  'team:status',
  'team:setup',
  'team:test',
  'team:sync',
  'team:summary'
] as const
