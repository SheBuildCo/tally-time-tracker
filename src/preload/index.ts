import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { TimerState } from '../shared/types'

// Bridge between renderer and main. `invoke` proxies to ipcMain.handle handlers;
// `onTimerState` subscribes to the push channel the timer broadcasts on.
const tally = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),

  onTimerState: (cb: (state: TimerState) => void): (() => void) => {
    const listener = (_e: unknown, state: TimerState): void => cb(state)
    ipcRenderer.on('timer:state', listener)
    return () => ipcRenderer.removeListener('timer:state', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('tally', tally)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.tally = tally
}

export type TallyBridge = typeof tally
