// Pure aggregation functions: turn categorized usage into the numbers the
// dashboard renders. No I/O here so these are trivially unit-testable.

import { activityLabel, appLabel, hostOf } from "./categorize";
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
  label: string; // host (for web) or app name — the coarse "where"
  app: string;
  hours: number;
  billableHours: number;
  topClient: string;
}

/** Fine-grained "what" — a specific tab / chat / document (window title). */
export interface ActivitySummary {
  label: string; // cleaned window title (or host/app fallback)
  app: string; // the app it happened in
  host: string; // web host when known, else ""
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
  activities: ActivitySummary[];
  daily: DailyPoint[];
}

/** A client's own breakdown — same shape as the overall summary, scoped down. */
export interface ClientDetail extends AnalyticsSummary {
  clientId: number;
  name: string;
}

/** One row of the Daily Totals table: a client's tally for a single day. */
export interface DailyTotalRow {
  date: string; // YYYY-MM-DD
  clientId: number | null;
  name: string;
  hours: number;
  billableHours: number;
  amount: number;
  color?: string;
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
  // Per-app/site accumulation (coarse "where"), tracking which client dominated.
  const appAgg = new Map<
    string,
    {
      app: string;
      seconds: number;
      billableSeconds: number;
      byClient: Map<number | null, number>;
    }
  >();
  // Per-activity accumulation (fine "what" — tab/chat/document by window title).
  const activityAgg = new Map<
    string,
    {
      app: string;
      host: string;
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

    // app/site (coarse)
    const aLabel = appLabel(c.event);
    const aa =
      appAgg.get(aLabel) ??
      {
        app: c.event.app,
        seconds: 0,
        billableSeconds: 0,
        byClient: new Map<number | null, number>(),
      };
    aa.seconds += sec;
    if (c.billable) aa.billableSeconds += sec;
    aa.byClient.set(c.clientId, (aa.byClient.get(c.clientId) ?? 0) + sec);
    appAgg.set(aLabel, aa);

    // activity (fine — tab/chat/document)
    const actLabel = activityLabel(c.event);
    const act =
      activityAgg.get(actLabel) ??
      {
        app: c.event.app,
        host: hostOf(c.event.url),
        seconds: 0,
        billableSeconds: 0,
        byClient: new Map<number | null, number>(),
      };
    act.seconds += sec;
    if (c.billable) act.billableSeconds += sec;
    act.byClient.set(c.clientId, (act.byClient.get(c.clientId) ?? 0) + sec);
    activityAgg.set(actLabel, act);

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

  const activitySummaries: ActivitySummary[] = [...activityAgg.entries()]
    .map(([label, agg]) => {
      const topClientId = [...agg.byClient.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      return {
        label,
        app: agg.app,
        host: agg.host,
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
    activities: activitySummaries,
    daily,
  };
}

/**
 * Build one client's own breakdown by running the same aggregation over only the
 * events attributed to that client. Reuses `buildSummary` so the per-client view
 * shows the exact same shape (KPIs, apps, activities, daily) as the whole.
 */
export function buildClientDetail(
  categorized: Categorized[],
  client: Client,
): ClientDetail {
  const subset = categorized.filter((c) => c.clientId === client.id);
  const summary = buildSummary(subset, [client]);
  return { ...summary, clientId: client.id, name: client.name };
}

/**
 * Build the Daily Totals table: one row per (day, client) with hours and billable
 * value. Rows are clicked to open a client's day detail. Most recent day first,
 * then largest client within a day.
 */
export function buildDailyTotals(
  categorized: Categorized[],
  clients: Client[],
): DailyTotalRow[] {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const agg = new Map<
    string,
    {
      date: string;
      clientId: number | null;
      seconds: number;
      billableSeconds: number;
    }
  >();

  for (const c of categorized) {
    const date = dayOf(c.event.timestamp);
    const key = `${date}|${c.clientId ?? "none"}`;
    const row =
      agg.get(key) ??
      { date, clientId: c.clientId, seconds: 0, billableSeconds: 0 };
    row.seconds += c.event.duration;
    if (c.billable) row.billableSeconds += c.event.duration;
    agg.set(key, row);
  }

  const nameFor = (id: number | null): string =>
    id === null ? "Unassigned" : clientById.get(id)?.name ?? `Client ${id}`;

  return [...agg.values()]
    .map((row) => {
      const rate =
        row.clientId === null
          ? 0
          : clientById.get(row.clientId)?.billableRate ?? 0;
      const billableHrs = hours(row.billableSeconds);
      return {
        date: row.date,
        clientId: row.clientId,
        name: nameFor(row.clientId),
        hours: hours(row.seconds),
        billableHours: billableHrs,
        amount: round(billableHrs * rate),
        color:
          row.clientId === null
            ? "gray"
            : clientById.get(row.clientId)?.color,
      };
    })
    .sort((a, b) =>
      a.date === b.date ? b.hours - a.hours : b.date.localeCompare(a.date),
    );
}
