import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initDb, getClient } from './db'
import { initTimer, getState, onStateChange } from './timer'
import { registerHandlers } from './handlers'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { createTray, destroyTray } from './tray'
import {
  createMainWindow,
  showMainWindow,
  openPicker,
  closePicker,
  openPinned,
  closePinned
} from './windows'
import { syncNow } from './sync'
import { invalidateRetainerCache } from './retainer'
import { disconnect } from './supabase'

// The pinned widget only reserves space for the retainer line when the client
// actually has one.
function hasRetainer(clientId: number): boolean {
  return (getClient(clientId)?.retainerHours ?? 0) > 0
}

// How often each machine pushes its time to the shared team database. Kept
// short because the live retainer readout reads the team's usage back out of
// this database: stale pushes mean a teammate's hours are missing from the
// "hours left" figure someone else is looking at right now. Still cheap — one
// small database, a trailing few days of rows per push.
const SYNC_INTERVAL_MS = 90 * 1000

// Single-instance lock: a second launch just focuses the running app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // Launched hidden (via login item) → stay in the tray, don't pop a window.
  const startHidden = process.argv.includes('--hidden')

  let quitting = false
  let syncTimer: NodeJS.Timeout | null = null

  // Push to the shared team database in the background. No-ops when team sync
  // isn't configured, and syncNow() never throws — tracking must never depend
  // on the network being up.
  //
  // The window narrows after the first push: startup does the full catch-up (in
  // case the machine was offline for days), while the frequent ticks only cover
  // today and yesterday. Older days can't change without the app running, and
  // re-pushing a week of sessions every 90s on every teammate's machine would be
  // a lot of work to rewrite rows that are already correct.
  function startTeamSync(): void {
    const run = (days?: number): void =>
      void syncNow(days).then(() => invalidateRetainerCache())
    run()
    syncTimer = setInterval(() => run(2), SYNC_INTERVAL_MS)
  }

  function setAutoLaunch(enabled: boolean): void {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--hidden']
    })
  }

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.shebuild.tally')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Boot order: DB first (everything depends on it), then timer rehydrate.
    initDb()
    initTimer()

    registerHandlers({
      openPicker,
      closePicker,
      updateShortcuts: registerShortcuts,
      setAutoLaunch
    })
    registerShortcuts()
    createTray(() => {
      quitting = true
    })

    createMainWindow(startHidden)
    startTeamSync()

    // Pinned timer widget: visible only while a timer runs. Driven by timer
    // state changes, plus an initial check in case a session was rehydrated on
    // boot (initTimer sets state without broadcasting).
    onStateChange((s) => {
      if (s.status === 'running') {
        openPinned(hasRetainer(s.clientId))
      } else {
        closePinned()
        // A session just finished: push it immediately so everyone else's
        // retainer readout reflects it within seconds rather than at the next
        // interval. One day's window is enough and keeps the push cheap.
        void syncNow(1).then(() => invalidateRetainerCache())
      }
    })
    const boot = getState()
    if (boot.status === 'running') openPinned(hasRetainer(boot.clientId))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(false)
      else showMainWindow()
    })
  })

  // Closing the last window hides to tray rather than quitting — Tally is meant
  // to keep running in the background. Actual quit goes through the tray menu.
  app.on('window-all-closed', () => {
    // Intentionally do nothing: the tray keeps the app alive.
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('will-quit', () => {
    unregisterShortcuts()
    destroyTray()
    if (syncTimer) clearInterval(syncTimer)
    void disconnect()
  })

  // Expose for potential future use / clarity.
  void quitting
}
