"use client";

import {
  BarChart,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@tremor/react";
import { CHART, Panel, PanelTitle, Pill, StatCard } from "@/components/ui";
import { formatCurrency, formatDayLabel, formatHours } from "@/lib/format";
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
          subtitle="Specific tabs, chats & documents"
        />
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Activity</TableHeaderCell>
              <TableHeaderCell>Where</TableHeaderCell>
              <TableHeaderCell className="text-right">Time</TableHeaderCell>
              <TableHeaderCell className="text-right">Billable</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {detail.activities.slice(0, 25).map((a) => (
              <TableRow key={a.label}>
                <TableCell className="max-w-xs truncate font-medium text-slate-700">
                  {a.label}
                </TableCell>
                <TableCell className="text-slate-400">
                  {a.host || a.app}
                </TableCell>
                <TableCell className="text-right text-slate-600">
                  {formatHours(a.hours)}
                </TableCell>
                <TableCell className="text-right">
                  {a.billableHours > 0 ? (
                    <Pill tone="good">{formatHours(a.billableHours)}</Pill>
                  ) : (
                    <Pill tone="muted">—</Pill>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
