// Pure aggregation functions: turn categorized usage into the numbers the
// dashboard renders. No I/O here so these are trivially unit-testable.

import { activityLabel } from "./categorize";
import type { Categorized, Client } from "./types";

const SECONDS_PER_HOUR = 3600;

export interface ClientSummary {
  clientId: number | null;
  name: string;
  hours: number;
  billableHours: number;
  amount: number; // billableHours * rate
  color?: string;
}

export interface AppSummary {
  label: string; // host (for web) or app name
  app: string;
  hours: number;
  billableHours: number;
  topClient: string;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  billableHours: number;
  nonBillableHours: number;
}

export interface AnalyticsSummary {
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  unassignedHours: number;
  billableAmount: number;
  clients: ClientSummary[];
  apps: AppSummary[];
  daily: DailyPoint[];
}

function hours(seconds: number): number {
  return round(seconds / SECONDS_PER_HOUR);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Build a complete analytics summary from categorized events + client config. */
export function buildSummary(
  categorized: Categorized[],
  clients: Client[],
): AnalyticsSummary {
  const clientById = new Map(clients.map((c) => [c.id, c]));

  let totalSeconds = 0;
  let billableSeconds = 0;
  let unassignedSeconds = 0;

  // Per-client accumulation.
  const clientAgg = new Map<
    number | null,
    { seconds: number; billableSeconds: number }
  >();
  // Per-app/site accumulation, tracking which client dominated.
  const appAgg = new Map<
    string,
    {
      app: string;
      seconds: number;
      billableSeconds: number;
      byClient: Map<number | null, number>;
    }
  >();
  // Per-day accumulation.
  const dayAgg = new Map<
    string,
    { billableSeconds: number; nonBillableSeconds: number }
  >();

  for (const c of categorized) {
    const sec = c.event.duration;
    totalSeconds += sec;
    if (c.billable) billableSeconds += sec;
    if (c.matchedRuleId === null) unassignedSeconds += sec;

    // client
    const ca = clientAgg.get(c.clientId) ?? { seconds: 0, billableSeconds: 0 };
    ca.seconds += sec;
    if (c.billable) ca.billableSeconds += sec;
    clientAgg.set(c.clientId, ca);

    // app/site
    const label = activityLabel(c.event);
    const aa =
      appAgg.get(label) ??
      {
        app: c.event.app,
        seconds: 0,
        billableSeconds: 0,
        byClient: new Map<number | null, number>(),
      };
    aa.seconds += sec;
    if (c.billable) aa.billableSeconds += sec;
    aa.byClient.set(c.clientId, (aa.byClient.get(c.clientId) ?? 0) + sec);
    appAgg.set(label, aa);

    // day
    const d = dayOf(c.event.timestamp);
    const da = dayAgg.get(d) ?? { billableSeconds: 0, nonBillableSeconds: 0 };
    if (c.billable) da.billableSeconds += sec;
    else da.nonBillableSeconds += sec;
    dayAgg.set(d, da);
  }

  const nameFor = (id: number | null): string =>
    id === null ? "Unassigned" : clientById.get(id)?.name ?? `Client ${id}`;

  const clientSummaries: ClientSummary[] = [...clientAgg.entries()]
    .map(([clientId, agg]) => {
      const rate = clientId === null ? 0 : clientById.get(clientId)?.billableRate ?? 0;
      const billableHrs = hours(agg.billableSeconds);
      return {
        clientId,
        name: nameFor(clientId),
        hours: hours(agg.seconds),
        billableHours: billableHrs,
        amount: round(billableHrs * rate),
        color: clientId === null ? "gray" : clientById.get(clientId)?.color,
      };
    })
    .sort((a, b) => b.hours - a.hours);

  const appSummaries: AppSummary[] = [...appAgg.entries()]
    .map(([label, agg]) => {
      const topClientId = [...agg.byClient.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      return {
        label,
        app: agg.app,
        hours: hours(agg.seconds),
        billableHours: hours(agg.billableSeconds),
        topClient: nameFor(topClientId ?? null),
      };
    })
    .sort((a, b) => b.hours - a.hours);

  const daily: DailyPoint[] = [...dayAgg.entries()]
    .map(([date, agg]) => ({
      date,
      billableHours: hours(agg.billableSeconds),
      nonBillableHours: hours(agg.nonBillableSeconds),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const billableAmount = round(
    clientSummaries.reduce((sum, c) => sum + c.amount, 0),
  );

  return {
    totalHours: hours(totalSeconds),
    billableHours: hours(billableSeconds),
    nonBillableHours: hours(totalSeconds - billableSeconds),
    unassignedHours: hours(unassignedSeconds),
    billableAmount,
    clients: clientSummaries,
    apps: appSummaries,
    daily,
  };
}
