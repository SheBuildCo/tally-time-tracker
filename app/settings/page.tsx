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
        actions={
          <div className="flex flex-wrap gap-2">
            <CleanupButton days={days} onDone={refresh} />
            <ResyncButton days={days} onDone={refresh} />
          </div>
        }
      />

      <div className="space-y-4">
        <UnassignedSuggestions
          suggestions={report?.suggestions ?? []}
          clients={clients}
          days={days}
          onCreated={async () => {
            await reload();
            refresh();
          }}
        />
        <ApiKeyCard />
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

function CleanupButton({ days, onDone }: { days: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      title="Use AI to clean up tab/site labels and split per-client sites (e.g. maasgroup.looplogics)"
      onClick={async () => {
        setBusy(true);
        try {
          await api().cleanup(days);
          onDone();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-xl bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
    >
      {busy ? "Cleaning…" : "Clean up titles & sites"}
    </button>
  );
}

/* ---------------- Unassigned suggestions ---------------- */

function UnassignedSuggestions({
  suggestions,
  clients,
  days,
  onCreated,
}: {
  suggestions: RuleSuggestion[];
  clients: Client[];
  days: number;
  onCreated: () => void;
}) {
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  // Pre-fill the dropdown to the client Claude suggested (when it matches one we
  // know), so a cleaned suggestion is one click to confirm.
  const prefill = (s: RuleSuggestion): string => {
    if (s.suggestedClientName) {
      const c = clients.find(
        (x) => x.name.toLowerCase() === s.suggestedClientName!.toLowerCase(),
      );
      if (c) return String(c.id);
    }
    return "";
  };
  const choiceFor = (s: RuleSuggestion) => assign[s.label] ?? prefill(s);

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
    const choice = choiceFor(s);
    const billable = choice !== "" && choice !== "internal";
    const clientId = billable ? Number(choice) : null;
    await api().createRule({
      ...s.match,
      clientId,
      billable,
      priority: 50, // user-created mappings win over seeded defaults
    });
    // Re-categorise the viewed range so past time for this site moves too.
    await api().resync(days);
    onCreated();
  }

  const visible = filter.trim()
    ? suggestions.filter((s) =>
        `${s.cleanedLabel ?? ""} ${s.label}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      )
    : suggestions;

  return (
    <Panel>
      <PanelTitle
        title="Unassigned usage"
        subtitle="Assign each to a client (or mark internal). Applies across the current range."
      />
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter sites…"
        className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400"
      />
      <div className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
        {visible.map((s) => (
          <div key={s.label} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-slate-700">
                  {s.cleanedLabel ?? s.label}
                </span>
                {typeof s.confidence === "number" && (
                  <Pill tone={s.confidence >= 0.85 ? "good" : "muted"}>
                    {Math.round(s.confidence * 100)}% sure
                  </Pill>
                )}
              </div>
              <div className="truncate text-xs text-slate-400">
                {s.cleanedLabel ? `${s.label} · ` : ""}
                {describeMatch(s)} · {formatHours(secondsToHours(s.seconds))}
              </div>
            </div>
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
              value={choiceFor(s)}
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
              disabled={choiceFor(s) === ""}
              onClick={() => createRule(s)}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate-300"
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

/* ---------------- AI cleanup key ---------------- */

function ApiKeyCard() {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setState("saving");
    try {
      await api().setApiKey(value.trim());
      setValue("");
      setState("saved");
    } catch {
      setState("idle");
    }
  }

  return (
    <Panel>
      <PanelTitle
        title="AI cleanup"
        subtitle="Paste a shared Anthropic API key to enable “Clean up titles & sites”. Stored locally on this machine; never shown again."
      />
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-slate-400">
            Anthropic API key
          </label>
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setState("idle");
            }}
            placeholder="sk-ant-…"
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={state === "saving" || !value.trim()}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Save key"}
        </button>
        {state === "saved" && (
          <span className="text-sm text-emerald-600">Saved ✓</span>
        )}
      </form>
    </Panel>
  );
}

/* ---------------- Clients ---------------- */

/** Per-client Chrome profile: create one, or launch the existing one. */
function ClientProfileControl({
  client,
  onChange,
}: {
  client: Client;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (client.chromeProfileDir) {
    return (
      <div className="flex items-center gap-2">
        <Pill tone="good">
          Profile: {client.chromeProfileName ?? client.name}
        </Pill>
        <button
          disabled={busy}
          onClick={() => run(() => api().launchChromeProfile({ clientId: client.id }))}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? "Opening…" : "Open"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            await api().createChromeProfile({ clientId: client.id });
            onChange();
          })
        }
        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {busy ? "Creating…" : "Create Chrome profile"}
      </button>
      {error && <span className="text-xs text-rose-500">{error}</span>}
    </div>
  );
}

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
      <PanelTitle
        title="Clients & Chrome profiles"
        subtitle="Give each client a Chrome profile — Tally attributes browser time by the profile it's running under (the most accurate signal). App/site rules below are the fallback."
      />
      <div className="space-y-2">
        {clients.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 font-medium text-slate-700">{c.name}</div>
            <ClientProfileControl client={c} onChange={onChange} />
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
    if (r.match.profile) parts.push(`profile = ${r.match.profile}`);
    if (r.match.app) parts.push(`app = ${r.match.app}`);
    if (r.match.urlDomain) parts.push(`site = ${r.match.urlDomain}`);
    if (r.match.titleRegex) parts.push(`title ~ /${r.match.titleRegex}/`);
    return parts.join(" · ") || "(empty)";
  }

  return (
    <Panel>
      <PanelTitle
        title="Mapping rules"
        subtitle="First match wins (lowest priority number first). Chrome-profile rules outrank site/title rules, which outrank seeded defaults."
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
