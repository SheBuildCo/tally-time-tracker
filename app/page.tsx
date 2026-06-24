"use client";

import { BarChart, BarList, LineChart } from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import {
  CHART,
  PageHeading,
  Panel,
  PanelTitle,
  StatCard,
} from "@/components/ui";
import { formatCurrency, formatDayLabel, formatHours } from "@/lib/format";

export default function OverviewPage() {
  return (
    <div>
      <PageHeading
        title="Overview"
        subtitle="Your tracked activity, mapped to clients and billables."
      />

      <LoadingGate>
        {(report) => {
          const daily = report.daily.map((d) => ({
            date: formatDayLabel(d.date),
            Billable: d.billableHours,
            "Non-billable": d.nonBillableHours,
            Total:
              Math.round((d.billableHours + d.nonBillableHours) * 100) / 100,
          }));

          const topClients = report.clients
            .filter((c) => c.hours > 0)
            .slice(0, 6)
            .map((c) => ({ name: c.name, value: c.hours }));

          const topActivities = report.activities
            .slice(0, 6)
            .map((a) => ({ name: a.label, value: a.hours }));

          const billablePct =
            report.totalHours > 0
              ? Math.round((report.billableHours / report.totalHours) * 100)
              : 0;

          return (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Active time"
                  value={formatHours(report.totalHours)}
                  caption="excludes idle time"
                />
                <StatCard
                  label="Billable time"
                  value={formatHours(report.billableHours)}
                  caption={`${billablePct}% of tracked`}
                  tone="good"
                />
                <StatCard
                  label="Billable value"
                  value={formatCurrency(report.billableAmount)}
                  caption="across all clients"
                  tone="good"
                />
                <StatCard
                  label="Unassigned"
                  value={formatHours(report.unassignedHours)}
                  caption={
                    report.unassignedHours > 0
                      ? "review in Settings"
                      : "all mapped"
                  }
                  tone={report.unassignedHours > 0 ? "warn" : "default"}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelTitle
                    title="Activity by day"
                    subtitle="Billable vs non-billable hours"
                  />
                  <BarChart
                    className="h-72"
                    data={daily}
                    index="date"
                    categories={["Billable", "Non-billable"]}
                    colors={[CHART.billable, CHART.nonBillable]}
                    valueFormatter={(v: number) => formatHours(v)}
                    stack
                    showLegend
                  />
                </Panel>
                <Panel>
                  <PanelTitle
                    title="Total hours trend"
                    subtitle="Active hours per day"
                  />
                  <LineChart
                    className="h-72"
                    data={daily}
                    index="date"
                    categories={["Total"]}
                    colors={[CHART.accent]}
                    valueFormatter={(v: number) => formatHours(v)}
                    showLegend={false}
                    curveType="monotone"
                  />
                </Panel>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelTitle title="Top clients" subtitle="Active hours" />
                  <BarList
                    data={topClients}
                    valueFormatter={(v: number) => formatHours(v)}
                    color={CHART.billable}
                  />
                </Panel>
                <Panel>
                  <PanelTitle
                    title="Top activities"
                    subtitle="Specific tabs, chats & apps"
                  />
                  <BarList
                    data={topActivities}
                    valueFormatter={(v: number) => formatHours(v)}
                    color={CHART.accent}
                  />
                </Panel>
              </div>
            </div>
          );
        }}
      </LoadingGate>
    </div>
  );
}
