"use client";

import { AreaChart, BarChart, Card, Text, Title } from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import { formatDayLabel, formatHours } from "@/lib/format";

export default function TimePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Time</h1>
        <p className="text-sm text-gray-500">
          How your tracked hours trend over the selected range.
        </p>
      </div>

      <LoadingGate>
        {(report) => {
          const data = report.daily.map((d) => ({
            date: formatDayLabel(d.date),
            Billable: d.billableHours,
            "Non-billable": d.nonBillableHours,
            Total: Math.round((d.billableHours + d.nonBillableHours) * 100) / 100,
          }));

          return (
            <div className="space-y-6">
              <Card>
                <Title>Total tracked hours per day</Title>
                <BarChart
                  className="mt-4 h-72"
                  data={data}
                  index="date"
                  categories={["Billable", "Non-billable"]}
                  colors={["emerald", "gray"]}
                  valueFormatter={(v) => formatHours(v)}
                  stack
                  showLegend
                />
              </Card>

              <Card>
                <Title>Billable trend</Title>
                <Text>Billable hours recorded each day</Text>
                <AreaChart
                  className="mt-4 h-64"
                  data={data}
                  index="date"
                  categories={["Billable"]}
                  colors={["emerald"]}
                  valueFormatter={(v) => formatHours(v)}
                  showLegend={false}
                />
              </Card>
            </div>
          );
        }}
      </LoadingGate>
    </div>
  );
}
