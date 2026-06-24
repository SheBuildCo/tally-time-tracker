"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@tremor/react";
import { useDashboard } from "@/components/DashboardContext";
import ClientDetailView from "@/components/ClientDetailView";
import { EmptyState, PageHeading, Panel, PanelTitle, Pill } from "@/components/ui";
import { api } from "@/lib/client";
import { formatCurrency, formatHours } from "@/lib/format";
import type { DailyTotalRow } from "@/lib/analytics";
import type { ClientReport } from "@/lib/report";

export default function DailyPage() {
  const { days } = useDashboard();
  const [rows, setRows] = useState<DailyTotalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<{ clientId: number; date: string } | null>(
    null,
  );
  const [detail, setDetail] = useState<ClientReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api()
      .getDaily(days)
      .then((r) => {
        if (!cancelled) setRows(r.rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api()
      .getClientDay(open.clientId, open.date)
      .then((r) => {
        if (!cancelled) {
          setDetail(r);
          cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Group rows by date for readable day headers.
  const byDate = useMemo(() => {
    const groups = new Map<string, DailyTotalRow[]>();
    for (const r of rows) {
      const list = groups.get(r.date) ?? [];
      list.push(r);
      groups.set(r.date, list);
    }
    return [...groups.entries()];
  }, [rows]);

  return (
    <div>
      <PageHeading
        title="Daily totals"
        subtitle="What each day went to, per client. Click a row to see the detail."
      />

      {loading ? (
        <Panel>
          <div className="h-40 animate-pulse rounded-xl bg-slate-50" />
        </Panel>
      ) : rows.length === 0 ? (
        <EmptyState>No tracked activity in this range yet.</EmptyState>
      ) : (
        <div className="space-y-5">
          <Panel>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell className="text-right">Active</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Billable
                  </TableHeaderCell>
                  <TableHeaderCell className="text-right">Value</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byDate.map(([date, group]) =>
                  group.map((r, i) => {
                    const clickable = r.clientId !== null;
                    const isOpen =
                      open?.clientId === r.clientId && open?.date === r.date;
                    return (
                      <TableRow
                        key={`${date}-${r.clientId ?? "none"}`}
                        onClick={
                          clickable
                            ? () =>
                                setOpen(
                                  isOpen
                                    ? null
                                    : { clientId: r.clientId as number, date },
                                )
                            : undefined
                        }
                        className={[
                          clickable ? "cursor-pointer" : "",
                          isOpen ? "bg-violet-50" : clickable ? "hover:bg-slate-50" : "",
                        ].join(" ")}
                      >
                        <TableCell className="text-slate-400">
                          {i === 0 ? formatLongDay(date) : ""}
                        </TableCell>
                        <TableCell className="font-medium text-slate-700">
                          {r.name}
                          {!clickable ? (
                            <span className="ml-2">
                              <Pill tone="muted">unmapped</Pill>
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-slate-600">
                          {formatHours(r.hours)}
                        </TableCell>
                        <TableCell className="text-right text-slate-600">
                          {formatHours(r.billableHours)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">
                          {r.amount > 0 ? formatCurrency(r.amount) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </Panel>

          {open ? (
            <div ref={cardRef}>
              <Panel>
                <div className="mb-4 flex items-center justify-between">
                  <PanelTitle
                    title={`${detail?.name ?? "Client"} — ${formatLongDay(open.date)}`}
                    subtitle="Their day at a glance"
                  />
                  <button
                    onClick={() => setOpen(null)}
                    className="rounded-full px-3 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    Close
                  </button>
                </div>
                {detailLoading && !detail ? (
                  <div className="h-32 animate-pulse rounded-xl bg-slate-50" />
                ) : detail ? (
                  <ClientDetailView detail={detail} showDaily={false} />
                ) : null}
              </Panel>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatLongDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
