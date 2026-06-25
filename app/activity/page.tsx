"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@tremor/react";
import LoadingGate from "@/components/LoadingGate";
import { EmptyState, PageHeading, Panel, Pill, SiteGroup } from "@/components/ui";
import { formatHours } from "@/lib/format";
import { groupActivitiesBySite } from "@/lib/group";

type View = "sites" | "apps";

export default function ActivityPage() {
  const [view, setView] = useState<View>("sites");

  return (
    <div>
      <PageHeading
        title="Sites & activity"
        subtitle="Your time by site — expand a site to see the specific tabs and chats."
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
                      <SiteGroup key={g.site} group={g} />
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
