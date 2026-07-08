// Global renderer state. Holds the live timer state (kept in sync via the main
// process push channel) and the client list (so the picker and nav don't each
// re-fetch).

import { create } from 'zustand'
import type { Client, TimerState } from '@shared/types'
import { api } from './api'

interface TallyStore {
  timer: TimerState
  clients: Client[]
  setTimer: (state: TimerState) => void
  refreshClients: () => Promise<void>
  init: () => Promise<void>
}

export const useStore = create<TallyStore>((set) => ({
  timer: { status: 'idle' },
  clients: [],
  setTimer: (state) => set({ timer: state }),
  refreshClients: async () => {
    const clients = await api.listClients()
    set({ clients })
  },
  init: async () => {
    const [timer, clients] = await Promise.all([api.getTimerState(), api.listClients()])
    set({ timer, clients })
  }
}))

// Subscribe once to the main-process timer broadcasts.
api.onTimerState((state) => {
  useStore.getState().setTimer(state)
})
