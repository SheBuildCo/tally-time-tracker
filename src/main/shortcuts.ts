// Global keyboard shortcut registration. Reads the accelerators from settings so
// the user can rebind them; re-registers on demand after a settings change.

import { globalShortcut } from 'electron'
import * as db from './db'
import * as timer from './timer'
import { openPicker } from './windows'

function toggle(): void {
  const result = timer.toggleTimer()
  // Idle → we need the user to pick a client before we start counting.
  if (result.opened) openPicker()
}

export function registerShortcuts(): void {
  globalShortcut.unregisterAll()

  const toggleAccel = db.getSetting('shortcut_toggle') ?? 'CommandOrControl+Shift+T'
  const pickerAccel = db.getSetting('shortcut_picker') ?? 'CommandOrControl+Shift+P'

  try {
    globalShortcut.register(toggleAccel, toggle)
  } catch {
    // An invalid/duplicate accelerator shouldn't crash the app.
  }
  try {
    globalShortcut.register(pickerAccel, () => openPicker())
  } catch {
    /* ignore */
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
