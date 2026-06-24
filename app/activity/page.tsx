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
import { PageHeading, Panel, Pill } from "@/components/ui";
import { formatHours } from "@/lib/format";

type View = "activities" | "apps";

export default function ActivityPage() {
  const [view, setView] = useState<View>("activities");

  return (
    <div>
      <PageHeading
        title="Activity"
        subtitle="The specific tabs, chats and apps your time went to."
      />

      <LoadingGate>
        {(report) => (
          <Panel>
            <div className="mb-4 inline-flex rounded-full bg-slate-100 p-1">
              {(["activities", "apps"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={[
                    "rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                    view === v
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  ].join(" ")}
                >
                  {v === "apps" ? "Apps & sites" : "Activities"}
                </button>
              ))}
            </div>

            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>
                    {view === "apps" ? "App / Site" : "Activity"}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {view === "apps" ? "Top client" : "Where"}
                  </TableHeaderCell>
                  {view === "activities" ? (
                    <TableHeaderCell>Top client</TableHeaderCell>
                  ) : null}
                  <TableHeaderCell className="text-right">Active</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Billable
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view === "activities"
                  ? report.activities.slice(0, 60).map((a) => (
                      <TableRow key={a.label}>
                        <TableCell className="max-w-sm truncate font-medium text-slate-700">
                          {a.label}
                        </TableCell>
                        <TableCell className="text-slate-400">
                          {a.host || a.app}
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
                    ))
                  : report.apps.slice(0, 60).map((a) => (
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
          </Panel>
        )}
      </LoadingGate>
    </div>
  );
}
