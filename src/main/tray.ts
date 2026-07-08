// System tray: keeps Tally alive in the background, reflects the current timer
// state, and offers quick start/stop/open actions. Rebuilds its menu whenever
// the timer state changes.

import { Tray, Menu, nativeImage, app } from 'electron'
import icon from '../../resources/icon.png?asset'
import * as timer from './timer'
import * as db from './db'
import { showMainWindow, openPicker } from './windows'

let tray: Tray | null = null

function currentLabel(): string {
  const state = timer.getState()
  if (state.status !== 'running') return 'Tally — no timer running'
  const client = db.getClient(state.clientId)
  return `Tally — tracking ${client?.name ?? 'client'}`
}

function rebuild(onQuit: () => void): void {
  if (!tray) return
  const state = timer.getState()
  const running = state.status === 'running'

  const menu = Menu.buildFromTemplate([
    { label: currentLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Open Tally', click: () => showMainWindow() },
    running
      ? { label: 'Stop Timer', click: () => timer.stopTimer() }
      : { label: 'Start Timer…', click: () => openPicker() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        onQuit()
        app.quit()
      }
    }
  ])

  tray.setToolTip(currentLabel())
  tray.setContextMenu(menu)
}

export function createTray(onQuit: () => void): Tray {
  const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.on('click', () => showMainWindow())
  rebuild(onQuit)
  // Keep the tray in lockstep with the timer.
  timer.onStateChange(() => rebuild(onQuit))
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
