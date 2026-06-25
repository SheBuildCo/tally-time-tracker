// The single boundary to the Anthropic API.
//
// Cleans messy window titles into readable labels and — crucially — decides
// which site hosts are *per-client subdomains* (e.g. `maasgroup.looplogics.com`,
// `acme.looplogics.com` on the shared LoopLogics platform) so each client gets
// its own rule instead of everything collapsing to `looplogics.com`.
//
// This module is the ONLY place that imports the Anthropic SDK or reads the API
// key. It is reached exclusively from the main-process data layer (lib/cleanup,
// via handlers) — never the renderer, so the key never crosses IPC. Every
// failure path degrades to `[]` so the rest of the app keeps working on the
// deterministic `registrableDomain` / `cleanTitle` fallbacks.

import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "./db";

/** Single source of truth for the cleanup model. */
export const ENRICH_MODEL = "claude-sonnet-4-6";

/** Distinct items per API call (keeps each response well under max_tokens). */
const BATCH_SIZE = 40;
/** Hard cap on items processed per cleanup run, regardless of how many distinct. */
const MAX_ITEMS = 200;

/** One distinct host/title to clean. `raw` is the SQLite cache key. */
export interface EnrichInput {
  raw: string; // cache key: the host (sites) or the cleaned title (titles)
  kind: "site" | "title";
  host: string; // raw host, "" when none (e.g. Comet without the web extension)
  title: string; // window/tab title
  app: string; // e.g. "comet.exe"
  sampleSeconds: number; // total unassigned time, so the model can weight effort
}

export interface EnrichContext {
  /** Existing client names, so the model can map a subdomain to a real client. */
  clientNames: string[];
}

export interface EnrichedItem {
  raw: string;
  kind: "site" | "title";
  cleanedLabel: string;
  isPerClientSubdomain: boolean;
  suggestedUrlDomain: string | null; // full host when per-client, else registrable
  suggestedClientName: string | null; // an existing client name, or null
  confidence: number; // 0..1
}

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "raw",
    "cleanedLabel",
    "isPerClientSubdomain",
    "suggestedUrlDomain",
    "suggestedClientName",
    "confidence",
  ],
  properties: {
    raw: { type: "string" },
    cleanedLabel: { type: "string" },
    isPerClientSubdomain: { type: "boolean" },
    suggestedUrlDomain: { type: ["string", "null"] },
    suggestedClientName: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: ITEM_SCHEMA },
  },
} as const;

const SYSTEM_PROMPT = `You clean up automatically-captured computer-activity labels for a professional services firm's time-tracking app, so time is billed to the right client.

You receive a JSON array of distinct activity items, each with a stable "raw" key, a "kind" ("site" or "title"), a host, a window/tab title, the app, and how many seconds were spent. You also receive the firm's existing client names.

For each item return:
- "raw": echo the input's raw key verbatim (this is how results are matched back).
- "cleanedLabel": a short, human-readable label for what this activity is (strip browser/app chrome, unread counts, trailing " - <Browser>"). Keep it specific.
- "isPerClientSubdomain": true ONLY when the host's subdomain identifies a specific client/tenant of a shared SaaS platform (e.g. "maasgroup.looplogics.com", "acme.atlassian.net"). It is FALSE for generic shared apps where the subdomain is not a client (e.g. "mail.google.com", "app.asana.com", "teams.microsoft.com", "outlook.office.com").
- "suggestedUrlDomain": when isPerClientSubdomain is true, the FULL host (e.g. "maasgroup.looplogics.com") so each client gets its own rule. Otherwise the registrable domain (e.g. "asana.com"). Null for title-only items with no host.
- "suggestedClientName": EXACTLY one of the provided client names when you are confident this activity belongs to that client (e.g. the subdomain or title clearly names them); otherwise null. Never invent a client name.
- "confidence": 0..1, how sure you are of the client attribution. Use a high value (>=0.85) only when the mapping is unambiguous.

Be conservative: when unsure, set suggestedClientName to null and a low confidence. Billing accuracy matters more than coverage.`;

function resolveApiKey(): string | null {
  try {
    const fromSettings = getSetting("anthropic_api_key");
    if (fromSettings && fromSettings.trim()) return fromSettings.trim();
  } catch {
    // DB not available (e.g. before migrate) — fall through to env.
  }
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null;
}

/** Pull the first text block out of a Messages response. */
function textOf(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

function validate(
  obj: unknown,
  byRaw: Map<string, EnrichInput>,
): EnrichedItem | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const input = typeof o.raw === "string" ? byRaw.get(o.raw) : undefined;
  if (!input) return null; // unknown/hallucinated key — drop it
  if (typeof o.cleanedLabel !== "string" || !o.cleanedLabel.trim()) return null;
  const confidence =
    typeof o.confidence === "number" && Number.isFinite(o.confidence)
      ? Math.max(0, Math.min(1, o.confidence))
      : 0;
  return {
    raw: input.raw,
    kind: input.kind,
    cleanedLabel: o.cleanedLabel.trim(),
    isPerClientSubdomain: o.isPerClientSubdomain === true,
    suggestedUrlDomain:
      typeof o.suggestedUrlDomain === "string" && o.suggestedUrlDomain.trim()
        ? o.suggestedUrlDomain.trim().toLowerCase()
        : null,
    suggestedClientName:
      typeof o.suggestedClientName === "string" && o.suggestedClientName.trim()
        ? o.suggestedClientName.trim()
        : null,
    confidence,
  };
}

async function enrichBatch(
  client: Anthropic,
  batch: EnrichInput[],
  ctx: EnrichContext,
): Promise<EnrichedItem[]> {
  const byRaw = new Map(batch.map((i) => [i.raw, i]));
  const userPayload = {
    clients: ctx.clientNames,
    items: batch.map((i) => ({
      raw: i.raw,
      kind: i.kind,
      host: i.host,
      title: i.title,
      app: i.app,
      sampleSeconds: Math.round(i.sampleSeconds),
    })),
  };

  const message = await client.messages.create({
    model: ENRICH_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [{ role: "user", content: JSON.stringify(userPayload) }],
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(message));
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => validate(it, byRaw))
    .filter((x): x is EnrichedItem => x !== null);
}

/**
 * Clean a set of distinct host/title items via Claude. Returns one EnrichedItem
 * per successfully-processed input (keyed by `raw`). Degrades to `[]` on a
 * missing API key or any SDK error — the caller falls back to deterministic
 * behavior and the app keeps working.
 */
export async function enrichDistinct(
  inputs: EnrichInput[],
  ctx: EnrichContext,
): Promise<EnrichedItem[]> {
  if (inputs.length === 0) return [];
  const apiKey = resolveApiKey();
  if (!apiKey) return []; // not configured — never construct the client

  const capped = inputs.slice(0, MAX_ITEMS);
  let client: Anthropic;
  try {
    client = new Anthropic({ apiKey });
  } catch (err) {
    console.warn("[enrich] failed to construct Anthropic client:", err);
    return [];
  }

  const out: EnrichedItem[] = [];
  for (let i = 0; i < capped.length; i += BATCH_SIZE) {
    const batch = capped.slice(i, i + BATCH_SIZE);
    try {
      out.push(...(await enrichBatch(client, batch, ctx)));
    } catch (err) {
      // Auth/rate-limit/connection/API errors all degrade gracefully: keep
      // whatever earlier batches produced and stop.
      console.warn("[enrich] cleanup request failed, using fallbacks:", err);
      break;
    }
  }
  return out;
}
