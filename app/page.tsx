"use client";

import Link from "next/link";
import LoadingGate from "@/components/LoadingGate";
import ExportButton from "@/components/ExportButton";
import { PageHeading, Panel, PanelTitle, StatCard } from "@/components/ui";
import { ClientValueDonut, HoursBars } from "@/components/charts";
import { formatCurrency, formatHours } from "@/lib/format";
import { groupActivitiesBySite } from "@/lib/group";

export default function OverviewPage() {
  return (
    <div>
      <PageHeading
        title="Overview"
        subtitle="Where billable time and value are going, by client."
        actions={<ExportButton />}
      />

      <LoadingGate>
        {(report) => {
          const topClients = report.clients
            .filter((c) => c.hours > 0)
            .sort((a, b) => b.hours - a.hours)
            .slice(0, 6)
            .map((c) => ({
              name: c.name,
              value: c.hours,
              unassigned: c.clientId === null,
            }));

          const topSites = groupActivitiesBySite(report.activities)
            .slice(0, 8)
            .map((g) => ({
              name: g.site,
              value: g.hours,
              unassigned: !g.topClient || g.topClient === "Unassigned",
            }));

          return (
            <div className="space-y-5">
              {/* Single money hero — totals de-emphasised in favour of breakdowns. */}
              <div className="grid gap-4 lg:grid-cols-3">
                <StatCard
                  label="Billable value"
                  value={formatCurrency(report.billableAmount)}
                  caption={`${formatHours(report.billableHours)} billable${
                    report.unassignedHours > 0
                      ? ` · ${formatHours(report.unassignedHours)} unassigned`
                      : ""
                  }`}
                  tone="good"
                />
                <Panel className="lg:col-span-2 !p-5">
                  <PanelTitle
                    title="Where the value is"
                    subtitle="Billable value by client"
                  />
                  <ClientValueDonut clients={report.clients} />
                </Panel>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelTitle title="Top clients" subtitle="Active hours" />
                  <HoursBars data={topClients} />
                </Panel>
                <Panel>
                  <PanelTitle title="Top sites" subtitle="Active hours by site" />
                  <HoursBars data={topSites} />
                </Panel>
              </div>

              {report.unassignedHours > 0 ? (
                <p className="text-center text-xs text-slate-400">
                  {formatHours(report.unassignedHours)} of time isn&apos;t mapped
                  to a client yet ·{" "}
                  <Link
                    href="/settings"
                    className="text-slate-500 underline-offset-2 hover:underline"
                  >
                    review in Settings
                  </Link>
                </p>
              ) : null}
            </div>
          );
        }}
      </LoadingGate>
    </div>
  );
}
