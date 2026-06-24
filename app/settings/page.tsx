"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Title, Text } from "@tremor/react";
import { useDashboard } from "@/components/DashboardContext";
import { formatCurrency, formatHours, secondsToHours } from "@/lib/format";
import type { Client, MappingRule } from "@/lib/types";
import type { RuleSuggestion } from "@/lib/categorize";

export default function SettingsPage() {
  const { report, refresh } = useDashboard();
  const [clients, setClients] = useState<Client[]>([]);
  const [rules, setRules] = useState<MappingRule[]>([]);

  const reload = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch("/api/clients").then((res) => res.json()),
      fetch("/api/rules").then((res) => res.json()),
    ]);
    setClients(c.clients ?? []);
    setRules(r.rules ?? []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const clientName = (id: number | null) =>
    id === null
      ? "Non-billable"
      : clients.find((c) => c.id === id)?.name ?? `Client ${id}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">
          Manage clients, billable rates and the rules that map usage to
          clients. Tracking itself is automatic — this is the only setup needed.
        </p>
      </div>

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
      <Card>
        <Title>Unassigned usage</Title>
        <Text>
          Nothing unassigned in the current range — all tracked time maps to a
          client or internal work. 🎉
        </Text>
      </Card>
    );
  }

  async function createRule(s: RuleSuggestion) {
    const choice = assign[s.label] ?? "";
    const billable = choice !== "" && choice !== "internal";
    const clientId = billable ? Number(choice) : null;
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...s.match,
        clientId,
        billable,
        priority: 50, // user-created mappings win over seeded defaults
      }),
    });
    onCreated();
  }

  return (
    <Card>
      <Title>Unassigned usage</Title>
      <Text>
        These apps/sites aren&apos;t mapped yet. Assign each to a client (or mark
        internal) to capture it going forward.
      </Text>
      <div className="mt-4 divide-y divide-gray-100">
        {suggestions.slice(0, 12).map((s) => (
          <div
            key={s.label}
            className="flex flex-wrap items-center gap-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-gray-900">
                {s.label}
              </div>
              <div className="text-xs text-gray-400">
                {s.kind === "site" ? `domain ${s.match.urlDomain}` : "app"} ·{" "}
                {formatHours(secondsToHours(s.seconds))}
              </div>
            </div>
            <select
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Add rule
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
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
    await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), billableRate: Number(rate) || 0 }),
    });
    setName("");
    setRate("");
    onChange();
  }

  async function saveRate(id: number, billableRate: number) {
    await fetch(`/api/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billableRate }),
    });
    onChange();
  }

  async function remove(id: number) {
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card>
      <Title>Clients &amp; rates</Title>
      <div className="mt-4 space-y-2">
        {clients.map((c) => (
          <div key={c.id} className="flex items-center gap-3">
            <div className="flex-1 font-medium text-gray-900">{c.name}</div>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <span>{formatCurrency(0).replace(/[\d.,]/g, "").trim()}</span>
              <input
                type="number"
                defaultValue={c.billableRate}
                min={0}
                className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                onBlur={(e) => saveRate(c.id, Number(e.target.value) || 0)}
              />
              <span>/hr</span>
            </div>
            <button
              onClick={() => remove(c.id)}
              className="text-sm text-gray-400 hover:text-red-600"
              aria-label={`Delete ${c.name}`}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={addClient} className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-gray-500">Client name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Rate / hr</label>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            type="number"
            min={0}
            placeholder="150"
            className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          Add client
        </button>
      </form>
    </Card>
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
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
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
    <Card>
      <Title>Mapping rules</Title>
      <Text>
        Evaluated top-to-bottom by priority; the first match wins. Rules you add
        from suggestions get higher priority than the seeded defaults.
      </Text>
      <div className="mt-4 space-y-1">
        {[...rules]
          .sort((a, b) => a.priority - b.priority)
          .map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-gray-100 px-3 py-2 text-sm"
            >
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                p{r.priority}
              </span>
              <span className="font-mono text-gray-700">{describe(r)}</span>
              <span className="text-gray-400">→</span>
              <span className="font-medium text-gray-900">
                {clientName(r.clientId)}
              </span>
              <span
                className={
                  r.billable
                    ? "rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700"
                    : "rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500"
                }
              >
                {r.billable ? "billable" : "non-billable"}
              </span>
              <button
                onClick={() => remove(r.id)}
                className="ml-auto text-gray-400 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          ))}
      </div>
    </Card>
  );
}
