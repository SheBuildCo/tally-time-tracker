// Browser-side data client. Runs in the React UI and talks to either:
//   - Electron's main process via the `window.tally` IPC bridge (packaged app), or
//   - the Next.js REST API via fetch (browser dev).
// This is the ONLY transport seam, so pages never branch on environment.

import type { Report, ClientReport, DailyReport } from "./report";
import type { CleanupResult } from "./cleanup";
import type { Client, MappingRule } from "./types";

export interface HealthResult {
  available: boolean;
  awBaseUrl: string;
}

/** The surface both transports implement. */
export interface TallyApi {
  getAnalytics(days: number): Promise<Report>;
  getClientReport(clientId: number, days: number): Promise<ClientReport>;
  getClientDay(clientId: number, date: string): Promise<ClientReport>;
  getDaily(days: number): Promise<DailyReport>;
  health(): Promise<HealthResult>;
  resync(days: number): Promise<{ ok: boolean; trackerAvailable: boolean }>;
  cleanup(days: number, opts?: { force?: boolean }): Promise<CleanupResult>;
  setApiKey(value: string): Promise<{ ok: boolean }>;
  listClients(): Promise<{ clients: Client[] }>;
  createClient(input: {
    name: string;
    billableRate: number;
    color?: string;
  }): Promise<{ client: Client }>;
  updateClient(
    id: number,
    fields: Partial<Pick<Client, "name" | "billableRate" | "color">>,
  ): Promise<{ client: Client }>;
  deleteClient(id: number): Promise<{ ok: boolean }>;
  listRules(): Promise<{ rules: MappingRule[] }>;
  createRule(body: Record<string, unknown>): Promise<{ rule: MappingRule }>;
  deleteRule(id: number): Promise<{ ok: boolean }>;
  createChromeProfile(input: {
    clientId: number;
  }): Promise<{ client: Client; rule: MappingRule | null; nameToUse: string }>;
  launchChromeProfile(input: { clientId: number }): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    tally?: TallyApi;
  }
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** REST implementation used in the browser during `next dev` / static preview. */
const restApi: TallyApi = {
  getAnalytics: (days) => http(`/api/analytics?days=${days}`),
  getClientReport: (id, days) => http(`/api/clients/${id}/analytics?days=${days}`),
  getClientDay: (id, date) => http(`/api/clients/${id}/day?date=${date}`),
  getDaily: (days) => http(`/api/daily?days=${days}`),
  health: () => http(`/api/health`),
  resync: (days) => http(`/api/resync?days=${days}`, { method: "POST" }),
  cleanup: (days, opts) =>
    http(`/api/cleanup?days=${days}&force=${opts?.force ? 1 : 0}`, {
      method: "POST",
    }),
  setApiKey: (value) =>
    http(`/api/settings/api-key`, {
      method: "POST",
      body: JSON.stringify({ value }),
    }),
  listClients: () => http(`/api/clients`),
  createClient: (input) =>
    http(`/api/clients`, { method: "POST", body: JSON.stringify(input) }),
  updateClient: (id, fields) =>
    http(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deleteClient: (id) => http(`/api/clients/${id}`, { method: "DELETE" }),
  listRules: () => http(`/api/rules`),
  createRule: (body) =>
    http(`/api/rules`, { method: "POST", body: JSON.stringify(body) }),
  deleteRule: (id) => http(`/api/rules/${id}`, { method: "DELETE" }),
  createChromeProfile: (input) =>
    http(`/api/chrome/profile`, { method: "POST", body: JSON.stringify(input) }),
  launchChromeProfile: (input) =>
    http(`/api/chrome/launch`, { method: "POST", body: JSON.stringify(input) }),
};

/** Pick the IPC bridge when running inside Electron, else the REST client. */
export function api(): TallyApi {
  if (typeof window !== "undefined" && window.tally) return window.tally;
  return restApi;
}
