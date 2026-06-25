// Orchestration: assemble the dashboard's data from the persisted rollup
// (history) plus a live recompute of the current day, then aggregate it. This is
// the single entry point the API routes / Electron IPC handlers call, so all the
// ingest + categorize + analytics wiring lives in one place.

import {
  suggestRules,
  type EnrichmentLookup,
  type RuleSuggestion,
} from "./categorize";
import { ENRICH_MODEL } from "./enrich";
import {
  buildClientDetail,
  buildDailyTotals,
  buildSummary,
  type AnalyticsSummary,
  type ClientDetail,
  type DailyTotalRow,
} from "./analytics";
import { getCleanupCache, listClients } from "./db";
import {
  dayStrings,
  ensureDayRows,
  getRangeRows,
  rowsToCategorized,
} from "./ingest";

export interface RangeMeta {
  start: string; // first day (YYYY-MM-DD)
  end: string; // last day (YYYY-MM-DD)
  days: number;
}

export interface Report extends AnalyticsSummary {
  range: RangeMeta;
  suggestions: RuleSuggestion[];
  trackerAvailable: boolean;
}

function rangeMeta(days: number): RangeMeta {
  const ds = dayStrings(days);
  return { start: ds[0], end: ds[ds.length - 1], days };
}

/**
 * Build an enrichment lookup from the cached LLM cleanups (cache-only — no
 * network). Once a cleanup has run, every report reflects cleaned labels and
 * correctly-scoped per-client subdomains with zero API calls.
 */
function cachedEnrichment(): EnrichmentLookup {
  const cache = getCleanupCache(ENRICH_MODEL);
  return {
    get: (raw) => {
      const r = cache.get(raw);
      if (!r) return undefined;
      return {
        cleanedLabel: r.cleanedLabel,
        isPerClientSubdomain: r.isPerClient,
        suggestedUrlDomain: r.suggestedDomain,
        suggestedClientName: r.suggestedClientName,
        confidence: r.confidence,
      };
    },
  };
}

/** Full dashboard report for the last `days` days. */
export async function buildReport(days = 7): Promise<Report> {
  const { rows, trackerAvailable } = await getRangeRows(days);
  const categorized = rowsToCategorized(rows);
  const clients = listClients();
  const summary = buildSummary(categorized, clients);
  const suggestions = suggestRules(categorized, 5, cachedEnrichment());
  return {
    ...summary,
    range: rangeMeta(days),
    suggestions,
    trackerAvailable,
  };
}

export interface ClientReport extends ClientDetail {
  range: RangeMeta;
  trackerAvailable: boolean;
}

/** One client's breakdown over the last `days` days (null if unknown client). */
export async function buildClientReport(
  clientId: number,
  days = 7,
): Promise<ClientReport | null> {
  const client = listClients().find((c) => c.id === clientId);
  if (!client) return null;
  const { rows, trackerAvailable } = await getRangeRows(days);
  const categorized = rowsToCategorized(rows);
  const detail = buildClientDetail(categorized, client);
  return { ...detail, range: rangeMeta(days), trackerAvailable };
}

export interface DailyReport {
  rows: DailyTotalRow[];
  range: RangeMeta;
  trackerAvailable: boolean;
}

/** Daily Totals table data for the last `days` days. */
export async function buildDailyReport(days = 7): Promise<DailyReport> {
  const { rows, trackerAvailable } = await getRangeRows(days);
  const categorized = rowsToCategorized(rows);
  const clients = listClients();
  return {
    rows: buildDailyTotals(categorized, clients),
    range: rangeMeta(days),
    trackerAvailable,
  };
}

/** One client's detail for a single (possibly historical) day. */
export async function buildClientDay(
  clientId: number,
  day: string,
): Promise<ClientReport | null> {
  const client = listClients().find((c) => c.id === clientId);
  if (!client) return null;
  const { rows, trackerAvailable } = await ensureDayRows(day);
  const categorized = rowsToCategorized(rows);
  const detail = buildClientDetail(categorized, client);
  return {
    ...detail,
    range: { start: day, end: day, days: 1 },
    trackerAvailable,
  };
}
