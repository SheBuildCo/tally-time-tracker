// Typed wrappers over the window.tally IPC bridge. The renderer only ever talks
// to the main process through these functions.

import type {
  Client,
  MappingRule,
  TimerState,
  TimerSession,
  SessionActivity,
  SessionExclusion,
  RangeSummary,
  Settings
} from '@shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  window.tally.invoke(channel, ...args) as Promise<T>

export const api = {
  // Clients
  listClients: () => invoke<Client[]>('clients:list'),
  createClient: (input: Omit<Client, 'id'>) => invoke<Client>('clients:create', input),
  updateClient: (id: number, input: Partial<Omit<Client, 'id'>>) =>
    invoke<Client | null>('clients:update', id, input),
  deleteClient: (id: number) => invoke<void>('clients:delete', id),

  // Rules
  listRules: () => invoke<MappingRule[]>('rules:list'),
  createRule: (input: Omit<MappingRule, 'id'>) => invoke<MappingRule>('rules:create', input),
  deleteRule: (id: number) => invoke<void>('rules:delete', id),

  // Timer
  startTimer: (clientId: number) => invoke<TimerSession>('timer:start', clientId),
  stopTimer: () => invoke<TimerSession | null>('timer:stop'),
  getTimerState: () => invoke<TimerState>('timer:getState'),
  openPicker: () => invoke<void>('timer:openPicker'),
  closePicker: () => invoke<void>('picker:close'),

  // Sessions
  listSessions: (limit?: number) => invoke<TimerSession[]>('sessions:list', limit),
  getSession: (id: number) => invoke<TimerSession | null>('sessions:get', id),
  getSessionActivities: (id: number) => invoke<SessionActivity[]>('sessions:activities', id),
  excludeActivity: (sessionId: number, app: string, host: string, activity: string) =>
    invoke<SessionExclusion>('sessions:exclude', sessionId, app, host, activity),
  includeActivity: (exclusionId: number, sessionId: number) =>
    invoke<void>('sessions:include', exclusionId, sessionId),

  // Analytics
  analyticsRange: (days: number) => invoke<RangeSummary>('analytics:range', days),

  // Settings
  getSettings: () => invoke<Settings>('settings:get'),
  updateShortcuts: (toggle: string, picker: string) =>
    invoke<void>('settings:updateShortcuts', toggle, picker),
  setAutoLaunch: (enabled: boolean) => invoke<void>('settings:setAutoLaunch', enabled),

  // ActivityWatch
  awHealth: () => invoke<boolean>('aw:health'),

  // Push subscription
  onTimerState: (cb: (state: TimerState) => void) => window.tally.onTimerState(cb)
}
