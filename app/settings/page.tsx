"use client";

import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/DashboardContext";
import { Collapsible, PageHeading, Panel, PanelTitle, Pill } from "@/components/ui";
import { api } from "@/lib/client";
import { formatHours, secondsToHours } from "@/lib/format";
import type { Client, MappingRule, Person, RuleMatch } from "@/lib/types";
import { groupSuggestionsByDomain } from "@/lib/categorize";
import type { DomainGroup, RuleSuggestion } from "@/lib/categorize";

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
        <UnassignedUsagePanel
          suggestions={report?.suggestions ?? []}
          clients={clients}
          days={days}
          onCreated={async () => {
            await reload();
            refresh();
          }}
        />
        <ClientsCard clients={clients} onChange={reload} />
        <PeopleCard />
        <Collapsible
          title={<span className="font-medium text-slate-700">Advanced</span>}
          meta={
            <span className="text-xs text-slate-400">AI cleanup & mapping rules</span>
          }
        >
          <div className="space-y-4 p-4">
            <ApiKeyCard />
            <RulesCard
              rules={rules}
              clientName={clientName}
              onChange={async () => {
                await reload();
                refresh();
              }}
            />
          </div>
        </Collapsible>
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

/* ---------------- People (team members & agent tokens) ---------------- */

/**
 * Add teammates and issue each machine's agent token. The token is shown ONCE
 * on creation (it's never stored in a readable form) — copy it into that
 * machine's setup with scripts/setup-autostart.ps1.
 */
function PeopleCard() {
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(
    null,
  );

  const reload = useCallback(async () => {
    const r = await api().listPeople();
    setPeople(r.people);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api().createPerson({ name: name.trim() });
      setNewToken({ name: r.person.name, token: r.token });
      setName("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await api().deletePerson(id);
    await reload();
  }

  return (
    <Panel>
      <PanelTitle
        title="People"
        subtitle="Team members whose machines push time here. Each gets an agent token."
      />
      <div className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Teammate name"
          className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy || !name.trim()}
          className="rounded-xl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          Add person
        </button>
      </div>

      {newToken ? (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="mb-1 font-medium text-emerald-800">
            Agent token for {newToken.name} — copy it now, it won&apos;t be shown again:
          </div>
          <code className="block break-all rounded bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-emerald-200">
            {newToken.token}
          </code>
          <button
            onClick={() => setNewToken(null)}
            className="mt-2 text-xs text-emerald-700 underline-offset-2 hover:underline"
          >
            Done
          </button>
        </div>
      ) : null}

      {people.length === 0 ? (
        <p className="text-sm text-slate-400">No people yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span className="text-sm font-medium text-slate-700">{p.name}</span>
              <button
                onClick={() => remove(p.id)}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------- Unassigned usage ---------------- */

/**
 * Groups `kind:"site"` suggestions by registrable domain (e.g. mail.google.com
 * + docs.google.com collapse under one "google.com" row) so triage is one click
 * per company, not one click per subdomain. "title"/"app" kind suggestions and
 * lone-subdomain domains fall back to a flat per-suggestion row.
 */
function UnassignedUsagePanel({
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

  const { domains, other } = groupSuggestionsByDomain(suggestions);

  // priority 50: user-created mappings win over seeded defaults; a bulk
  // domain-wide assign uses 55 so a more specific per-subdomain override
  // (kept at 50) always outranks it, regardless of creation order.
  async function assignMatch(match: RuleMatch, choice: string, priority = 50) {
    const billable = choice !== "" && choice !== "internal";
    const clientId = billable ? Number(choice) : null;
    await api().createRule({ ...match, clientId, billable, priority });
    // Re-categorise the viewed range so past time for this site moves too.
    await api().resync(days);
    onCreated();
  }

  return (
    <Panel>
      <PanelTitle
        title="Unassigned usage"
        subtitle="Assign a whole domain at once, or expand to override a specific subdomain."
      />
      <div className="space-y-2">
        {domains.map((d) => (
          <DomainGroupRow
            key={d.domain}
            group={d}
            clients={clients}
            onAssignDomain={(choice) => assignMatch({ urlDomain: d.domain }, choice, 55)}
            onAssignOne={(s, choice) => assignMatch(s.match, choice)}
          />
        ))}
        {other.length > 0 && (
          <Collapsible
            title={<span className="font-medium text-slate-500">Other unassigned</span>}
            meta={
              <span className="text-xs text-slate-400">
                {other.length} item{other.length === 1 ? "" : "s"}
              </span>
            }
          >
            <div className="divide-y divide-slate-100 p-2">
              {other.map((s) => (
                <SuggestionRow
                  key={s.label}
                  suggestion={s}
                  clients={clients}
                  onAssign={(choice) => assignMatch(s.match, choice)}
                />
              ))}
            </div>
          </Collapsible>
        )}
      </div>
    </Panel>
  );
}

/** One registrable-domain group: a collapsible header + optional bulk-assign row. */
function DomainGroupRow({
  group,
  clients,
  onAssignDomain,
  onAssignOne,
}: {
  group: DomainGroup;
  clients: Client[];
  onAssignDomain: (choice: string) => Promise<void>;
  onAssignOne: (s: RuleSuggestion, choice: string) => Promise<void>;
}) {
  const single = group.suggestions.length === 1;
  return (
    <Collapsible
      title={<span className="truncate font-medium text-slate-700">{group.domain}</span>}
      meta={
        <span className="text-sm tabular-nums text-slate-500">
          {formatHours(secondsToHours(group.seconds))}
        </span>
      }
    >
      <div className="p-2">
        {!single && <BulkAssignRow clients={clients} onAssign={onAssignDomain} />}
        <div className="divide-y divide-slate-100">
          {group.suggestions.map((s) => (
            <SuggestionRow
              key={s.label}
              suggestion={s}
              clients={clients}
              onAssign={(choice) => onAssignOne(s, choice)}
            />
          ))}
        </div>
      </div>
    </Collapsible>
  );
}

/** Bulk "assign this whole domain" control. */
function BulkAssignRow({
  clients,
  onAssign,
}: {
  clients: Client[];
  onAssign: (choice: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-50/60 px-2 py-2">
      <span className="text-xs text-slate-400">Assign whole domain to</span>
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        disabled={busy}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
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
        type="button"
        disabled={busy || choice === ""}
        onClick={async () => {
          setBusy(true);
          try {
            await onAssign(choice);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {busy ? "Saving…" : "Assign all"}
      </button>
    </div>
  );
}

/** One suggestion row: label, confidence, match descriptor, and an assign control. */
function SuggestionRow({
  suggestion: s,
  clients,
  onAssign,
}: {
  suggestion: RuleSuggestion;
  clients: Client[];
  onAssign: (choice: string) => Promise<void>;
}) {
  // Pre-fill the dropdown to the client Claude suggested (when it matches one we
  // know), so a cleaned suggestion is one click to confirm.
  const [choice, setChoice] = useState(() => {
    if (s.suggestedClientName) {
      const c = clients.find(
        (x) => x.name.toLowerCase() === s.suggestedClientName!.toLowerCase(),
      );
      if (c) return String(c.id);
    }
    return "";
  });

  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
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
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
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
        disabled={choice === ""}
        onClick={() => onAssign(choice)}
        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Add rule
      </button>
    </div>
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

/** Copies `text` to the clipboard, swallowing failures (e.g. no clipboard permission). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * One-time instructions for Chrome's "Name window" step — the actual
 * attribution signal, which Tally cannot set programmatically (see
 * lib/chrome.ts). Shown once right after profile creation; manually
 * dismissible since there's no signal Tally can observe to confirm it's done.
 */
function NameWindowInstructions({
  name,
  onDismiss,
}: {
  name: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-2 w-full rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
      <p>
        Profile created and Chrome is opening. <strong>One-time step:</strong>{" "}
        in the new window, right-click an empty spot on the tab bar →{" "}
        <strong>Name window</strong> → paste (
        <span className="font-mono">{name}</span> is already copied) → OK.
      </p>
      <button
        onClick={onDismiss}
        className="mt-1.5 text-xs font-medium text-amber-700 underline hover:text-amber-900"
      >
        Got it
      </button>
    </div>
  );
}

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
  const [justCreatedName, setJustCreatedName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function copyName(name: string) {
    const ok = await copyToClipboard(name);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  }

  if (client.chromeProfileDir) {
    const name = client.chromeProfileName ?? client.name;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="good">Profile: {name}</Pill>
        <button
          disabled={busy}
          onClick={() => run(() => api().launchChromeProfile({ clientId: client.id }))}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? "Opening…" : "Open"}
        </button>
        <button
          onClick={() => copyName(name)}
          title="Copy the name to paste into Chrome's Name window dialog"
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          {copied ? "Copied ✓" : "Copy name"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const { nameToUse } = await api().createChromeProfile({ clientId: client.id });
            await copyToClipboard(nameToUse);
            setJustCreatedName(nameToUse);
            onChange();
          })
        }
        className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {busy ? "Creating…" : "Create Chrome profile"}
      </button>
      {error && <span className="text-xs text-rose-500">{error}</span>}
      {justCreatedName && (
        <NameWindowInstructions
          name={justCreatedName}
          onDismiss={() => setJustCreatedName(null)}
        />
      )}
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
