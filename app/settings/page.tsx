"use client";

import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/DashboardContext";
import { PageHeading, Panel, PanelTitle, Pill } from "@/components/ui";
import { api } from "@/lib/client";
import { formatHours, secondsToHours } from "@/lib/format";
import type { Client, MappingRule } from "@/lib/types";
import type { RuleSuggestion } from "@/lib/categorize";

export default function SettingsPage() {
  const { report, refresh, days } = useDashboard();
  const [clients, setClients] = useState<Client[]>([]);
  const [rules, setRules] = useState<MappingRule[]>([]);

  const reload = useCallback(async () => {
    const [c, r] = await Promise.all([api().listClients(), api().listRules()]);
    setClients(c.clients);
    setRules(r.rules);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const clientName = (id: number | null) =>
    id === null
      ? "Non-billable"
      : clients.find((c) => c.id === id)?.name ?? `Client ${id}`;

  return (
    <div>
      <PageHeading
        title="Settings"
        subtitle="Tracking is automatic — this is the only setup. Map usage to clients here."
        actions={<ResyncButton days={days} onDone={refresh} />}
      />

      <div className="space-y-4">
        <UnassignedSuggestions
          suggestions={report?.suggestions ?? []}
          clients={clients}
          onCreated={async () => {
            await reload();
            refresh();
          }}
        />
        <ClientsCard clients={clients} onChange={reload} />
        <RulesCard
          rules={rules}
          clientName={clientName}
          onChange={async () => {
            await reload();
            refresh();
          }}
        />
      </div>
    </div>
  );
}

function ResyncButton({ days, onDone }: { days: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api().resync(days);
          onDone();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? "Re-syncing…" : "Re-sync with current rules"}
    </button>
  );
}

/* ---------------- Unassigned suggestions ---------------- */

function UnassignedSuggestions({
  suggestions,
  clients,
  onCreated,
}: {
  suggestions: RuleSuggestion[];
  clients: Client[];
  onCreated: () => void;
}) {
  const [assign, setAssign] = useState<Record<string, string>>({});

  if (suggestions.length === 0) {
    return (
      <Panel>
        <PanelTitle title="Unassigned usage" />
        <p className="text-sm text-slate-400">
          Everything tracked maps to a client or internal work. 🎉
        </p>
      </Panel>
    );
  }

  async function createRule(s: RuleSuggestion) {
    const choice = assign[s.label] ?? "";
    const billable = choice !== "" && choice !== "internal";
    const clientId = billable ? Number(choice) : null;
    await api().createRule({
      ...s.match,
      clientId,
      billable,
      priority: 50, // user-created mappings win over seeded defaults
    });
    onCreated();
  }

  return (
    <Panel>
      <PanelTitle
        title="Unassigned usage"
        subtitle="Assign each to a client (or mark internal) to capture it going forward."
      />
      <div className="divide-y divide-slate-100">
        {suggestions.slice(0, 12).map((s) => (
          <div key={s.label} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-700">
                {s.label}
              </div>
              <div className="text-xs text-slate-400">
                {describeMatch(s)} · {formatHours(secondsToHours(s.seconds))}
              </div>
            </div>
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
              value={assign[s.label] ?? ""}
              onChange={(e) =>
                setAssign((a) => ({ ...a, [s.label]: e.target.value }))
              }
            >
              <option value="">Choose…</option>
              <option value="internal">Internal / non-billable</option>
              {clients.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              disabled={(assign[s.label] ?? "") === ""}
              onClick={() => createRule(s)}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Add rule
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function describeMatch(s: RuleSuggestion): string {
  if (s.kind === "site") return `site ${s.match.urlDomain}`;
  if (s.kind === "title") return "tab / chat title";
  return "app";
}

/* ---------------- Clients ---------------- */

function ClientsCard({
  clients,
  onChange,
}: {
  clients: Client[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api().createClient({ name: name.trim(), billableRate: Number(rate) || 0 });
    setName("");
    setRate("");
    onChange();
  }

  async function saveRate(id: number, billableRate: number) {
    await api().updateClient(id, { billableRate });
    onChange();
  }

  async function remove(id: number) {
    await api().deleteClient(id);
    onChange();
  }

  return (
    <Panel>
      <PanelTitle title="Clients & rates" />
      <div className="space-y-2">
        {clients.map((c) => (
          <div key={c.id} className="flex items-center gap-3">
            <div className="flex-1 font-medium text-slate-700">{c.name}</div>
            <div className="flex items-center gap-1 text-sm text-slate-400">
              <span>$</span>
              <input
                type="number"
                defaultValue={c.billableRate}
                min={0}
                className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm text-slate-700"
                onBlur={(e) => saveRate(c.id, Number(e.target.value) || 0)}
              />
              <span>/hr</span>
            </div>
            <button
              onClick={() => remove(c.id)}
              className="text-sm text-slate-300 hover:text-rose-500"
              aria-label={`Delete ${c.name}`}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={addClient} className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-slate-400">Client name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400">Rate / hr</label>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            type="number"
            min={0}
            placeholder="150"
            className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white"
        >
          Add client
        </button>
      </form>
    </Panel>
  );
}

/* ---------------- Rules ---------------- */

function RulesCard({
  rules,
  clientName,
  onChange,
}: {
  rules: MappingRule[];
  clientName: (id: number | null) => string;
  onChange: () => void;
}) {
  async function remove(id: number) {
    await api().deleteRule(id);
    onChange();
  }

  function describe(r: MappingRule): string {
    const parts: string[] = [];
    if (r.match.app) parts.push(`app = ${r.match.app}`);
    if (r.match.urlDomain) parts.push(`site = ${r.match.urlDomain}`);
    if (r.match.titleRegex) parts.push(`title ~ /${r.match.titleRegex}/`);
    return parts.join(" · ") || "(empty)";
  }

  return (
    <Panel>
      <PanelTitle
        title="Mapping rules"
        subtitle="First match wins (lowest priority number first). Rules from suggestions outrank seeded defaults."
      />
      <div className="space-y-1">
        {[...rules]
          .sort((a, b) => a.priority - b.priority)
          .map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm ring-1 ring-slate-100"
            >
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400">
                p{r.priority}
              </span>
              <span className="font-mono text-slate-600">{describe(r)}</span>
              <span className="text-slate-300">→</span>
              <span className="font-medium text-slate-700">
                {clientName(r.clientId)}
              </span>
              <Pill tone={r.billable ? "good" : "muted"}>
                {r.billable ? "billable" : "non-billable"}
              </Pill>
              <button
                onClick={() => remove(r.id)}
                className="ml-auto text-slate-300 hover:text-rose-500"
              >
                Delete
              </button>
            </div>
          ))}
      </div>
    </Panel>
  );
}
