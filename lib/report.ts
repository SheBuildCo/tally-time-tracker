// Orchestration: pull usage from ActivityWatch, categorize it with the stored
// rules, and aggregate it for the dashboard. This is the single entry point the
// API routes call so the AW + categorize + analytics wiring lives in one place.

import { getUsageEvents, lastNDays, type DateRange } from "./activitywatch";
import { categorizeAll, suggestRules, type RuleSuggestion } from "./categorize";
import { buildSummary, type AnalyticsSummary } from "./analytics";
import { listClients, listRules } from "./db";

export interface Report extends AnalyticsSummary {
  range: { start: string; end: string; days: number };
  suggestions: RuleSuggestion[];
}

/** Build the full dashboard report for the last `days` days. */
export async function buildReport(days = 7): Promise<Report> {
  const range: DateRange = lastNDays(days);
  const events = await getUsageEvents(range);
  const rules = listRules();
  const clients = listClients();

  const categorized = categorizeAll(events, rules);
  const summary = buildSummary(categorized, clients);
  const suggestions = suggestRules(categorized);

  return {
    ...summary,
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      days,
    },
    suggestions,
  };
}
