// Window management: the main app window and the transient client-picker popup.
// Both share the same preload bridge; they just load different HTML entries.

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import * as db from './db'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let pickerWindow: BrowserWindow | null = null
let pinnedWindow: BrowserWindow | null = null

// Load a renderer entry in dev (Vite server) or prod (bundled html file).
function loadEntry(win: BrowserWindow, entry: 'index' | 'picker' | 'pinned'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${entry}.html`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${entry}.html`))
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(startHidden = false): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  loadEntry(mainWindow, 'index')
  return mainWindow
}

export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(false)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// The picker: a small, frameless, always-on-top popup centered on the primary
// display. Auto-closes when it loses focus so it never gets in the way.
export function openPicker(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.focus()
    return
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const w = 380
  const h = 480

  pickerWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((width - w) / 2),
    y: Math.round((height - h) / 2),
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  pickerWindow.once('ready-to-show', () => pickerWindow?.show())
  pickerWindow.on('blur', () => {
    if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close()
  })
  pickerWindow.on('closed', () => {
    pickerWindow = null
  })

  loadEntry(pickerWindow, 'picker')
}

export function closePicker(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.close()
}

// ---- Pinned timer widget ----
//
// A small always-on-top sticky-note-style window showing the running timer, so
// a teammate can't forget it's on. Unlike the picker it does NOT close on blur
// (it must stay pinned), and it remembers where the user dragged it.

const PINNED_W = 240
const PINNED_H = 92

function loadPinnedPos(): { x: number; y: number } | null {
  const raw = db.getSetting('pinned_pos')
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p
  } catch {
    /* ignore malformed value */
  }
  return null
}

// Default to the top-right corner of the primary display's work area.
function defaultPinnedPos(): { x: number; y: number } {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  return { x: width - PINNED_W - 24, y: 24 }
}

export function openPinned(): void {
  if (pinnedWindow && !pinnedWindow.isDestroyed()) {
    pinnedWindow.showInactive() // show without stealing focus from the user's work
    return
  }

  const { x, y } = loadPinnedPos() ?? defaultPinnedPos()

  pinnedWindow = new BrowserWindow({
    width: PINNED_W,
    height: PINNED_H,
    x,
    y,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 'screen-saver' level keeps it above full-screen apps too.
  pinnedWindow.setAlwaysOnTop(true, 'screen-saver')
  pinnedWindow.once('ready-to-show', () => pinnedWindow?.showInactive())

  // Remember where the user drags it.
  pinnedWindow.on('moved', () => {
    if (pinnedWindow && !pinnedWindow.isDestroyed()) {
      const [px, py] = pinnedWindow.getPosition()
      db.setSetting('pinned_pos', JSON.stringify({ x: px, y: py }))
    }
  })
  pinnedWindow.on('closed', () => {
    pinnedWindow = null
  })

  loadEntry(pinnedWindow, 'pinned')
}

export function closePinned(): void {
  if (pinnedWindow && !pinnedWindow.isDestroyed()) pinnedWindow.close()
}
