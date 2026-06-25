"use client";

import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import { useDashboard } from "@/components/DashboardContext";
import { EmptyState, PageHeading, Panel, Pill, SiteGroup } from "@/components/ui";
import { formatHours } from "@/lib/format";
import { groupActivitiesBySite, type SiteGroup as SiteGroupData } from "@/lib/group";
import { api } from "@/lib/client";
import type { Client } from "@/lib/types";

type View = "sites" | "apps";

export default function ActivityPage() {
  const [view, setView] = useState<View>("sites");
  const { days, refresh } = useDashboard();
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    api()
      .listClients()
      .then((r) => setClients(r.clients))
      .catch(() => {});
  }, []);

  // Assigning a site creates a full-host rule, then re-syncs the viewed range so
  // already-recorded time for that site moves to the chosen client too.
  async function assignSite(group: SiteGroupData, clientId: number | null) {
    const host = group.items.find((i) => i.host)?.host;
    const match = host ? { urlDomain: host } : { app: group.site };
    await api().createRule({
      ...match,
      clientId,
      billable: clientId !== null,
      priority: 50,
    });
    await api().resync(days);
    refresh();
  }

  return (
    <div>
      <PageHeading
        title="Sites & activity"
        subtitle="Your time by site — expand a site to assign it to a client or see the specific tabs."
      />

      <LoadingGate>
        {(report) => {
          const sites = groupActivitiesBySite(report.activities);
          return (
            <Panel>
              <div className="mb-4 inline-flex rounded-full bg-slate-100 p-1">
                {(["sites", "apps"] as View[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={[
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                      view === v
                        ? "bg-white text-slate-800 shadow-sm"
                        : "text-slate-500 hover:text-slate-700",
                    ].join(" ")}
                  >
                    {v === "sites" ? "By site" : "Apps & sites"}
                  </button>
                ))}
              </div>

              {view === "sites" ? (
                sites.length === 0 ? (
                  <EmptyState>No tracked activity in this range yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {sites.map((g) => (
                      <SiteGroup
                        key={g.site}
                        group={g}
                        clients={clients}
                        onAssign={(clientId) => assignSite(g, clientId)}
                      />
                    ))}
                  </div>
                )
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>App / Site</TableHeaderCell>
                      <TableHeaderCell>Top client</TableHeaderCell>
                      <TableHeaderCell className="text-right">
                        Active
                      </TableHeaderCell>
                      <TableHeaderCell className="text-right">
                        Billable
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.apps.slice(0, 60).map((a) => (
                      <TableRow key={a.label}>
                        <TableCell className="font-medium text-slate-700">
                          {a.label}
                          {a.label !== a.app ? (
                            <span className="ml-2 text-xs text-slate-300">
                              {a.app}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-slate-500">
                          {a.topClient}
                        </TableCell>
                        <TableCell className="text-right text-slate-600">
                          {formatHours(a.hours)}
                        </TableCell>
                        <TableCell className="text-right">
                          {a.billableHours > 0 ? (
                            <Pill tone="good">
                              {formatHours(a.billableHours)}
                            </Pill>
                          ) : (
                            <Pill tone="muted">—</Pill>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>
          );
        }}
      </LoadingGate>
    </div>
  );
}
