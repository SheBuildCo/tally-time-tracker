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
import { runCleanup } from "./cleanup";
import {
  createClient,
  createRule,
  deleteClient,
  deleteRule,
  getClient,
  listClients,
  listRules,
  setClientChromeProfile,
  setSetting,
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

export const resync = async (days: number) => {
  const d = clampDays(days);
  const result = await resyncRange(d);
  // Hands-off cleanup: enrich any new unassigned hosts/titles and auto-apply
  // confident attributions. Never let it fail the resync.
  try {
    await runCleanup(d);
  } catch (err) {
    console.warn("[cleanup] post-resync cleanup failed:", err);
  }
  return result;
};

/** Explicit "Clean up titles & sites" action (and force re-clean). */
export const cleanup = (days: number, opts?: { force?: boolean }) =>
  runCleanup(clampDays(days), { force: opts?.force ?? false });

export async function health() {
  return { available: await isAvailable(), awBaseUrl: AW_BASE_URL };
}

// ---- settings ------------------------------------------------------------

/** Store the shared Anthropic API key (write-only — never read back to the UI). */
export function setApiKey(value: unknown): { ok: true } {
  if (typeof value !== "string") throw new ValidationError("invalid key");
  setSetting("anthropic_api_key", value.trim() || null);
  return { ok: true };
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
  if (typeof body.profile === "string" && body.profile.trim())
    match.profile = body.profile.trim();

  if (!match.app && !match.titleRegex && !match.urlDomain && !match.profile) {
    throw new ValidationError(
      "a rule needs at least one of app, titleRegex, urlDomain or profile",
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

// ---- chrome profiles -----------------------------------------------------

/**
 * Provision a dedicated Chrome profile for a client: name it (so the name lands
 * in window titles), record the mapping, auto-create a high-precedence profile
 * rule, and launch Chrome into it. Chrome interaction lives in lib/chrome.ts
 * (Node-only) and is imported lazily so non-Electron paths never load it eagerly.
 */
export async function createChromeProfile(input: {
  clientId?: unknown;
}): Promise<{ client: Client; rule: ReturnType<typeof createRule> | null }> {
  const id = Number(input.clientId);
  if (!Number.isInteger(id)) throw new ValidationError("clientId is required");
  const client = getClient(id);
  if (!client) throw new NotFoundError("client not found");

  const chrome = await import("./chrome");
  if (!chrome.findChromeExe()) {
    throw new ValidationError(
      "Chrome not found — set TALLY_CHROME_PATH to your chrome.exe",
    );
  }

  const dir = chrome.profileDirForClient(client);
  const name = chrome.sanitizeProfileName(client.name);
  chrome.setProfileDisplayName(dir, name);
  const saved = setClientChromeProfile(id, dir, name) ?? client;

  // Profile rules win over domain/title/app (priority 10 < suggestions 50 <
  // seeded 100). Skip if an equivalent one already exists (re-provisioning).
  const exists = listRules().some(
    (r) => r.match.profile?.toLowerCase() === name.toLowerCase() && r.clientId === id,
  );
  const rule = exists
    ? null
    : createRule({
        match: { profile: name },
        clientId: id,
        billable: client.billableRate > 0,
        priority: 10,
      });

  chrome.launchChromeProfile(dir);
  return { client: saved, rule };
}

/** Launch Chrome into a client's already-provisioned profile. */
export async function launchClientProfile(input: {
  clientId?: unknown;
}): Promise<{ ok: true }> {
  const id = Number(input.clientId);
  if (!Number.isInteger(id)) throw new ValidationError("clientId is required");
  const client = getClient(id);
  if (!client) throw new NotFoundError("client not found");
  if (!client.chromeProfileDir) {
    throw new ValidationError("this client has no Chrome profile yet");
  }
  const chrome = await import("./chrome");
  chrome.launchChromeProfile(client.chromeProfileDir);
  return { ok: true };
}

// ---- typed errors so each transport maps to its own status/shape ---------

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export { getClient };
