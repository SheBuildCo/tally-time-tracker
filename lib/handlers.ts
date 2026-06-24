// Transport-agnostic handlers shared by the Next.js API routes (browser dev) and
// the Electron IPC layer (packaged app). Each returns plain JSON-serialisable
// data so both transports behave identically.

import { isAvailable, AW_BASE_URL } from "./activitywatch";
import {
  buildClientDay,
  buildClientReport,
  buildDailyReport,
  buildReport,
} from "./report";
import { resyncRange } from "./ingest";
import {
  createClient,
  createRule,
  deleteClient,
  deleteRule,
  getClient,
  listClients,
  listRules,
  updateClient,
  type RuleInput,
} from "./db";
import type { Client, RuleMatch } from "./types";

export function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(Math.floor(n), 90);
}

// ---- analytics / reports -------------------------------------------------

export const getAnalytics = (days: number) => buildReport(clampDays(days));

export const getClientReport = (clientId: number, days: number) =>
  buildClientReport(clientId, clampDays(days));

export const getDaily = (days: number) => buildDailyReport(clampDays(days));

export const getClientDay = (clientId: number, day: string) =>
  buildClientDay(clientId, day);

export const resync = (days: number) => resyncRange(clampDays(days));

export async function health() {
  return { available: await isAvailable(), awBaseUrl: AW_BASE_URL };
}

// ---- clients -------------------------------------------------------------

export const getClients = () => ({ clients: listClients() });

export function addClient(input: {
  name?: unknown;
  billableRate?: unknown;
  color?: unknown;
}): { client: Client } {
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new ValidationError("name is required");
  }
  const rate = Number(input.billableRate ?? 0);
  const client = createClient(
    input.name.trim(),
    Number.isFinite(rate) ? rate : 0,
    typeof input.color === "string" ? input.color : undefined,
  );
  return { client };
}

export function patchClient(
  id: number,
  fields: { name?: unknown; billableRate?: unknown; color?: unknown },
): { client: Client } {
  if (!Number.isInteger(id)) throw new ValidationError("invalid id");
  const update: Partial<Pick<Client, "name" | "billableRate" | "color">> = {};
  if (typeof fields.name === "string") update.name = fields.name.trim();
  if (fields.billableRate !== undefined)
    update.billableRate = Number(fields.billableRate);
  if (typeof fields.color === "string") update.color = fields.color;
  const client = updateClient(id, update);
  if (!client) throw new NotFoundError("not found");
  return { client };
}

export function removeClient(id: number): { ok: true } {
  if (!Number.isInteger(id)) throw new ValidationError("invalid id");
  deleteClient(id);
  return { ok: true };
}

// ---- rules ---------------------------------------------------------------

export const getRules = () => ({ rules: listRules() });

export function addRule(body: Record<string, unknown>): {
  rule: ReturnType<typeof createRule>;
} {
  const match: RuleMatch = {};
  if (typeof body.app === "string" && body.app.trim()) match.app = body.app.trim();
  if (typeof body.titleRegex === "string" && body.titleRegex.trim())
    match.titleRegex = body.titleRegex.trim();
  if (typeof body.urlDomain === "string" && body.urlDomain.trim())
    match.urlDomain = body.urlDomain.trim().toLowerCase();

  if (!match.app && !match.titleRegex && !match.urlDomain) {
    throw new ValidationError(
      "a rule needs at least one of app, titleRegex or urlDomain",
    );
  }

  const input: RuleInput = {
    match,
    clientId:
      body.clientId === null || body.clientId === undefined
        ? null
        : Number(body.clientId),
    project: typeof body.project === "string" ? body.project : null,
    billable: body.billable !== false,
    priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100,
  };
  return { rule: createRule(input) };
}

export function removeRule(id: number): { ok: true } {
  if (!Number.isInteger(id)) throw new ValidationError("invalid id");
  deleteRule(id);
  return { ok: true };
}

// ---- typed errors so each transport maps to its own status/shape ---------

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export { getClient };
