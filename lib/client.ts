// Browser-side data client. Runs in the React UI and talks to the Next.js REST
// API via fetch. This is the ONLY transport seam, so pages never branch on
// environment.

import type { Report, ClientReport, DailyReport } from "./report";
import type { CleanupResult } from "./cleanup";
import type { Client, MappingRule, Person } from "./types";

/** `?personId=` query suffix, or "" for the whole-team view. */
function personParam(personId?: number): string {
  return personId === undefined ? "" : `&personId=${personId}`;
}

export interface HealthResult {
  available: boolean;
  awBaseUrl: string;
}

/** The surface the REST client implements. `personId` omitted = whole team. */
export interface TallyApi {
  getAnalytics(days: number, personId?: number): Promise<Report>;
  getClientReport(
    clientId: number,
    days: number,
    personId?: number,
  ): Promise<ClientReport>;
  getClientDay(
    clientId: number,
    date: string,
    personId?: number,
  ): Promise<ClientReport>;
  getDaily(days: number, personId?: number): Promise<DailyReport>;
  listPeople(): Promise<{ people: Person[] }>;
  createPerson(input: { name: string }): Promise<{ person: Person; token: string }>;
  deletePerson(id: number): Promise<{ ok: boolean }>;
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

/** REST implementation — talks to the central server's /api routes. */
const restApi: TallyApi = {
  getAnalytics: (days, personId) =>
    http(`/api/analytics?days=${days}${personParam(personId)}`),
  getClientReport: (id, days, personId) =>
    http(`/api/clients/${id}/analytics?days=${days}${personParam(personId)}`),
  getClientDay: (id, date, personId) =>
    http(`/api/clients/${id}/day?date=${date}${personParam(personId)}`),
  getDaily: (days, personId) =>
    http(`/api/daily?days=${days}${personParam(personId)}`),
  listPeople: () => http(`/api/people`),
  createPerson: (input) =>
    http(`/api/people`, { method: "POST", body: JSON.stringify(input) }),
  deletePerson: (id) => http(`/api/people/${id}`, { method: "DELETE" }),
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

/** The REST client (the only transport now that the Electron IPC bridge is gone). */
export function api(): TallyApi {
  return restApi;
}
