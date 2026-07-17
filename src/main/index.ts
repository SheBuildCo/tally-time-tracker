import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initDb } from './db'
import { initTimer } from './timer'
import { registerHandlers } from './handlers'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { createTray, destroyTray } from './tray'
import { createMainWindow, showMainWindow, openPicker, closePicker } from './windows'
import { syncNow } from './sync'
import { disconnect } from './supabase'

// How often each machine pushes its time to the shared team database. Generous
// on purpose: the data is a daily rollup, so minute-level freshness buys
// nothing, and this runs on every teammate's machine against one small database.
const SYNC_INTERVAL_MS = 5 * 60 * 1000

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
  function startTeamSync(): void {
    void syncNow()
    syncTimer = setInterval(() => void syncNow(), SYNC_INTERVAL_MS)
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
