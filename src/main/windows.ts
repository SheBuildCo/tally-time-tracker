// Window management: the main app window and the transient client-picker popup.
// Both share the same preload bridge; they just load different HTML entries.

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let pickerWindow: BrowserWindow | null = null

// Load a renderer entry ("index" or "picker") in dev (Vite server) or prod
// (bundled html file).
function loadEntry(win: BrowserWindow, entry: 'index' | 'picker'): void {
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
