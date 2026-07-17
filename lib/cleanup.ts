// LLM cleanup orchestration.
//
// Collects the distinct unassigned hosts/titles, sends only the not-yet-cached
// ones to Claude (lib/enrich), caches the results, and auto-applies the
// confident ones: a high-confidence host/title that maps to an existing client
// becomes a MappingRule (so per-client subdomains like maasgroup.looplogics.com
// get attributed to the right client). Low-confidence items are cached for
// display only and surface in the Settings suggestions list for a manual check —
// a weak guess never silently misattributes billable time.
//
// Runs in the main process only (it reaches the Anthropic SDK via lib/enrich).

import { bucketUnassigned, escapeRegExp } from "./categorize";
import {
  createRule,
  getCleanupFor,
  listClients,
  listRules,
  upsertCleanup,
  type CleanupRow,
} from "./db";
import {
  ENRICH_MODEL,
  enrichDistinct,
  type EnrichInput,
  type EnrichedItem,
} from "./enrich";
import { getRangeRows, rowsToCategorized } from "./ingest";
import { buildReport, type Report } from "./report";

/** Minimum confidence before a cleaned mapping auto-creates a billing rule. */
const AUTO_APPLY_CONFIDENCE = 0.85;

export interface CleanupResult {
  report: Report;
  cleaned: number; // distinct items enriched this run
  rulesCreated: number; // high-confidence attributions auto-applied
}

/**
 * Run cleanup over the last `days` days. Enriches only uncached distinct
 * hosts/titles (unless `force`), caches results, auto-applies confident
 * attributions as rules, and returns the refreshed report.
 */
export async function runCleanup(
  days: number,
  { force = false }: { force?: boolean } = {},
): Promise<CleanupResult> {
  const { rows } = await getRangeRows(days);
  const categorized = rowsToCategorized(rows);

  // Sites (per-client subdomain disambiguation) and titles (Comet tabs with no
  // URL) are worth cleaning; bare app names are already clean.
  const buckets = bucketUnassigned(categorized, 60).filter(
    (b) => b.kind === "site" || b.kind === "title",
  );

  const inputs: EnrichInput[] = buckets.map((b) => ({
    raw: b.key,
    kind: b.kind as "site" | "title",
    host: b.sampleHost,
    title: b.sampleTitle,
    app: b.sampleApp,
    sampleSeconds: b.seconds,
  }));

  // Only send strings we haven't cleaned yet (unless forcing a re-clean).
  const cached = force
    ? new Map()
    : await getCleanupFor(
        inputs.map((i) => i.raw),
        ENRICH_MODEL,
      );
  const todo = inputs.filter((i) => !cached.has(i.raw));

  const clients = await listClients();
  const enriched =
    todo.length > 0
      ? await enrichDistinct(todo, { clientNames: clients.map((c) => c.name) })
      : [];

  if (enriched.length > 0) {
    const now = new Date().toISOString();
    await upsertCleanup(enriched.map(toCleanupRow), now);
  }

  const rulesCreated = await autoApply(enriched, clients);

  return { report: await buildReport(days), cleaned: enriched.length, rulesCreated };
}

function toCleanupRow(e: EnrichedItem): CleanupRow {
  return {
    raw: e.raw,
    kind: e.kind,
    cleanedLabel: e.cleanedLabel,
    isPerClient: e.isPerClientSubdomain,
    suggestedDomain: e.suggestedUrlDomain,
    suggestedClientName: e.suggestedClientName,
    confidence: e.confidence,
    model: ENRICH_MODEL,
  };
}

/**
 * Auto-create rules for high-confidence attributions that name an existing
 * client, skipping any that already have an equivalent rule. Returns the count
 * created.
 */
async function autoApply(
  enriched: EnrichedItem[],
  clients: Awaited<ReturnType<typeof listClients>>,
): Promise<number> {
  const byName = new Map(clients.map((c) => [c.name.toLowerCase(), c]));
  const existing = await listRules();
  const hasDomainRule = (d: string) =>
    existing.some((r) => r.match.urlDomain?.toLowerCase() === d.toLowerCase());
  const hasTitleRule = (t: string) =>
    existing.some((r) => r.match.titleRegex === t);

  let created = 0;
  for (const e of enriched) {
    if (e.confidence < AUTO_APPLY_CONFIDENCE || !e.suggestedClientName) continue;
    const client = byName.get(e.suggestedClientName.toLowerCase());
    if (!client) continue; // named a client that doesn't exist — skip

    if (e.kind === "site") {
      const domain = e.suggestedUrlDomain;
      if (!domain || hasDomainRule(domain)) continue;
      existing.push(
        await createRule({
          match: { urlDomain: domain.toLowerCase() },
          clientId: client.id,
          billable: client.billableRate > 0,
          priority: 100,
        }),
      ); // keep the dup-guard current within this run
      created++;
    } else {
      const regex = escapeRegExp(e.raw);
      if (hasTitleRule(regex)) continue;
      existing.push(
        await createRule({
          match: { titleRegex: regex },
          clientId: client.id,
          billable: client.billableRate > 0,
          priority: 100,
        }),
      );
      created++;
    }
  }
  return created;
}
