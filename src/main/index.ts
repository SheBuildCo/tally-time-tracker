import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initDb } from './db'
import { initTimer } from './timer'
import { registerHandlers } from './handlers'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { createTray, destroyTray } from './tray'
import { createMainWindow, showMainWindow, openPicker, closePicker } from './windows'

// Single-instance lock: a second launch just focuses the running app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  // Launched hidden (via login item) → stay in the tray, don't pop a window.
  const startHidden = process.argv.includes('--hidden')

  let quitting = false

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
  })

  // Expose for potential future use / clarity.
  void quitting
}
