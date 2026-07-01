"use client";

import { BarChart } from "@tremor/react";
import {
  AppGroup,
  CHART,
  EmptyState,
  Panel,
  PanelTitle,
  SiteGroup,
  StatCard,
} from "@/components/ui";
import { formatCurrency, formatDayLabel, formatHours } from "@/lib/format";
import { groupActivitiesByApp, groupActivitiesBySite } from "@/lib/group";
import type { ClientDetail } from "@/lib/analytics";

/**
 * Renders one client's breakdown — the same shape whether scoped to a date range
 * (Clients tab) or a single day (Daily card). `showDaily` hides the per-day chart
 * when there's only one day to show.
 */
export default function ClientDetailView({
  detail,
  showDaily = true,
}: {
  detail: ClientDetail;
  showDaily?: boolean;
}) {
  if (detail.totalHours === 0) {
    return (
      <Panel>
        <div className="py-6 text-center text-sm text-slate-400">
          No tracked time for {detail.name} in this period.
        </div>
      </Panel>
    );
  }

  const daily = detail.daily.map((d) => ({
    date: formatDayLabel(d.date),
    Billable: d.billableHours,
    "Non-billable": d.nonBillableHours,
  }));

  const apps = groupActivitiesByApp(detail.activities);
  const showAppTier = apps.length >= 2;
  const sites = showAppTier ? [] : groupActivitiesBySite(detail.activities);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active time" value={formatHours(detail.totalHours)} />
        <StatCard
          label="Billable time"
          value={formatHours(detail.billableHours)}
          tone="good"
        />
        <StatCard
          label="Billable value"
          value={formatCurrency(detail.billableAmount)}
          tone="good"
        />
      </div>

      {showDaily && daily.length > 1 ? (
        <Panel>
          <PanelTitle title="Activity by day" />
          <BarChart
            className="h-56"
            data={daily}
            index="date"
            categories={["Billable", "Non-billable"]}
            colors={[CHART.billable, CHART.nonBillable]}
            valueFormatter={(v: number) => formatHours(v)}
            stack
            showLegend
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelTitle
          title="What was worked on"
          subtitle={
            showAppTier
              ? "Grouped by app, then site — expand to see the specific tabs & chats"
              : "Grouped by site — expand a site to see the specific tabs & chats"
          }
        />
        {detail.activities.length === 0 ? (
          <EmptyState>Nothing recorded for this period.</EmptyState>
        ) : showAppTier ? (
          <div className="space-y-2">
            {apps.map((g) => (
              <AppGroup key={g.app} group={g} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {sites.map((g) => (
              <SiteGroup key={g.site} group={g} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
