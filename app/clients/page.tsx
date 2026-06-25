"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/components/DashboardContext";
import ClientDetailView from "@/components/ClientDetailView";
import { EmptyState, PageHeading, Panel } from "@/components/ui";
import { api } from "@/lib/client";
import type { Client } from "@/lib/types";
import type { ClientReport } from "@/lib/report";

export default function ClientsPage() {
  const { days, refreshKey } = useDashboard();
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClientReport | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the client list (from Settings) and default to the first.
  useEffect(() => {
    api()
      .listClients()
      .then((r) => {
        setClients(r.clients);
        setSelected((cur) => cur ?? r.clients[0]?.id ?? null);
      });
  }, []);

  // Load the selected client's breakdown whenever selection / range changes.
  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;
    setLoading(true);
    api()
      .getClientReport(selected, days)
      .then((r) => {
        if (!cancelled) setDetail(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, days, refreshKey]);

  return (
    <div>
      <PageHeading
        title="Clients"
        subtitle="Per-client analytics. Pick a client to see their breakdown."
      />

      {clients.length === 0 ? (
        <EmptyState>
          No clients yet. Add them on the Settings page.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {/* Client tabs */}
          <div className="flex flex-wrap gap-2">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={[
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  selected === c.id
                    ? "bg-brand text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                {c.name}
              </button>
            ))}
          </div>

          {loading && !detail ? (
            <Panel>
              <div className="h-40 animate-pulse rounded-xl bg-slate-50" />
            </Panel>
          ) : detail ? (
            <ClientDetailView detail={detail} />
          ) : null}
        </div>
      )}
    </div>
  );
}
