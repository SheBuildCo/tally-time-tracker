"use client";

import {
  AreaChart,
  BarList,
  Card,
  DonutChart,
  Flex,
  Metric,
  Text,
  Title,
} from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import { formatCurrency, formatDayLabel, formatHours } from "@/lib/format";

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500">
          Your tracked activity, mapped to clients and billables.
        </p>
      </div>

      <LoadingGate>
        {(report) => {
          const dailyData = report.daily.map((d) => ({
            date: formatDayLabel(d.date),
            Billable: d.billableHours,
            "Non-billable": d.nonBillableHours,
          }));

          const split = [
            { name: "Billable", value: report.billableHours },
            { name: "Non-billable", value: report.nonBillableHours },
          ];

          const topClients = report.clients
            .filter((c) => c.hours > 0)
            .slice(0, 6)
            .map((c) => ({ name: c.name, value: c.hours }));

          const topApps = report.apps
            .slice(0, 6)
            .map((a) => ({ name: a.label, value: a.hours }));

          return (
            <div className="space-y-6">
              {/* KPI cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Active time"
                  value={formatHours(report.totalHours)}
                />
                <KpiCard
                  label="Billable time"
                  value={formatHours(report.billableHours)}
                  accent="text-emerald-600"
                />
                <KpiCard
                  label="Billable value"
                  value={formatCurrency(report.billableAmount)}
                  accent="text-emerald-600"
                />
                <KpiCard
                  label="Unassigned"
                  value={formatHours(report.unassignedHours)}
                  accent={
                    report.unassignedHours > 0
                      ? "text-amber-600"
                      : "text-gray-900"
                  }
                  hint={
                    report.unassignedHours > 0
                      ? "Review in Settings"
                      : undefined
                  }
                />
              </div>

              {/* Trend + split */}
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <Title>Daily activity</Title>
                  <Text>Billable vs non-billable hours per day</Text>
                  <AreaChart
                    className="mt-4 h-64"
                    data={dailyData}
                    index="date"
                    categories={["Billable", "Non-billable"]}
                    colors={["emerald", "gray"]}
                    valueFormatter={(v) => formatHours(v)}
                    showLegend
                    stack
                  />
                </Card>
                <Card>
                  <Title>Billable split</Title>
                  <DonutChart
                    className="mt-4 h-44"
                    data={split}
                    category="value"
                    index="name"
                    colors={["emerald", "gray"]}
                    valueFormatter={(v) => formatHours(v)}
                  />
                  <Flex className="mt-4">
                    <Text>Billable share</Text>
                    <Text>
                      {report.totalHours > 0
                        ? Math.round(
                            (report.billableHours / report.totalHours) * 100,
                          )
                        : 0}
                      %
                    </Text>
                  </Flex>
                </Card>
              </div>

              {/* Top clients + apps */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <Title>Top clients</Title>
                  <Text>Active hours by client</Text>
                  <BarList
                    className="mt-4"
                    data={topClients}
                    valueFormatter={(v: number) => formatHours(v)}
                    color="blue"
                  />
                </Card>
                <Card>
                  <Title>Top apps &amp; sites</Title>
                  <Text>Where your time went</Text>
                  <BarList
                    className="mt-4"
                    data={topApps}
                    valueFormatter={(v: number) => formatHours(v)}
                    color="indigo"
                  />
                </Card>
              </div>
            </div>
          );
        }}
      </LoadingGate>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent = "text-gray-900",
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <Card>
      <Text>{label}</Text>
      <Metric className={accent}>{value}</Metric>
      {hint ? <Text className="mt-1 text-amber-600">{hint}</Text> : null}
    </Card>
  );
}
