// Preload: exposes a typed `window.tally` bridge to the renderer. Every call is
// forwarded to a `tally:<name>` IPC channel handled in the main process. This is
// the Electron counterpart of the REST API used during browser dev; lib/client.ts
// picks whichever is present.

import { contextBridge, ipcRenderer } from "electron";

const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`tally:${name}`, ...args);

const tally = {
  getAnalytics: (days: number) => invoke("getAnalytics", days),
  getClientReport: (id: number, days: number) =>
    invoke("getClientReport", id, days),
  getClientDay: (id: number, date: string) => invoke("getClientDay", id, date),
  getDaily: (days: number) => invoke("getDaily", days),
  health: () => invoke("health"),
  resync: (days: number) => invoke("resync", days),
  listClients: () => invoke("listClients"),
  createClient: (input: unknown) => invoke("createClient", input),
  updateClient: (id: number, fields: unknown) =>
    invoke("updateClient", id, fields),
  deleteClient: (id: number) => invoke("deleteClient", id),
  listRules: () => invoke("listRules"),
  createRule: (body: unknown) => invoke("createRule", body),
  deleteRule: (id: number) => invoke("deleteRule", id),
};

contextBridge.exposeInMainWorld("tally", tally);
