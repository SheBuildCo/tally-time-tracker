// Shared UI primitives — one calm, consistent card/metric style used everywhere,
// matching the soft pastel reference design (white rounded cards, big slate
// numbers, muted captions).

"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/format";
import type { SiteGroup as SiteGroupData } from "@/lib/group";
import type { Client } from "@/lib/types";

/** Pastel chart palette (Tremor colour names — used by retained Tremor charts). */
export const CHART = {
  billable: "violet",
  nonBillable: "sky",
  accent: "cyan",
  series: ["violet", "sky", "cyan", "emerald", "amber", "rose"],
} as const;

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-slate-700">{title}</h2>
      {subtitle ? (
        <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function PageHeading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A KPI tile: small label, large bold value, optional delta caption. `good`
 * tints the value/caption emerald (e.g. billable), `warn` amber (e.g. unassigned).
 */
export function StatCard({
  label,
  value,
  caption,
  tone = "default",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "default" | "good" | "warn";
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-500"
        : "text-slate-800";
  return (
    <Panel className="!p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-2 text-4xl font-bold tracking-tight ${valueColor}`}>
        {value}
      </div>
      {caption ? (
        <div className="mt-1 text-xs text-slate-400">{caption}</div>
      ) : null}
    </Panel>
  );
}

/** Small rounded pill used for billable / non-billable tags. */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "muted";
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "muted"
        ? "bg-slate-100 text-slate-400"
        : "bg-brand-soft text-brand-strong";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

/** Empty / informational state inside a panel. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Panel>
      <div className="py-8 text-center text-sm text-slate-400">{children}</div>
    </Panel>
  );
}

/**
 * Lightweight expandable row (no Radix). A button header with a rotating chevron
 * over a conditionally-rendered body. Grouping + expandable is the app's default
 * for taming long lists ("when in doubt, group it").
 */
export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-slate-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">{title}</div>
        {meta ? <div className="flex items-center gap-2">{meta}</div> : null}
      </button>
      {open ? <div className="border-t border-slate-100">{children}</div> : null}
    </div>
  );
}

/**
 * A site-first expandable group: the site/host leads, the specific tabs/chats
 * are revealed on expand. Unassigned groups are rendered muted (never an amber
 * alarm) — this is where the "de-emphasise unassigned" rule is centralised.
 */
export function SiteGroup({
  group,
  clients,
  onAssign,
}: {
  group: SiteGroupData;
  /** When provided (with onAssign), shows an inline "assign to client" row. */
  clients?: Client[];
  onAssign?: (clientId: number | null) => Promise<void> | void;
}) {
  const unassigned = group.topClientId === null;
  return (
    <Collapsible
      title={
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate font-medium",
              unassigned ? "text-slate-500" : "text-slate-700",
            )}
          >
            {group.site}
          </span>
          {!unassigned ? (
            <span className="shrink-0 text-xs text-slate-400">
              {group.topClient}
            </span>
          ) : (
            <Pill tone="muted">unassigned</Pill>
          )}
        </div>
      }
      meta={
        <>
          <span className="text-sm tabular-nums text-slate-500">
            {formatHours(group.hours)}
          </span>
          {group.billableHours > 0 ? (
            <Pill tone="good">{formatHours(group.billableHours)}</Pill>
          ) : (
            <Pill tone="muted">—</Pill>
          )}
        </>
      }
    >
      {clients && onAssign ? (
        <AssignRow
          clients={clients}
          defaultClientId={group.topClientId}
          onAssign={onAssign}
        />
      ) : null}
      <ul className="divide-y divide-slate-50">
        {group.items.map((item, i) => (
          <li
            key={`${item.label}-${i}`}
            className="flex items-center gap-3 px-4 py-2 pl-11"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
              {item.label}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-slate-400">
              {formatHours(item.hours)}
            </span>
            {item.billableHours > 0 ? (
              <Pill tone="good">{formatHours(item.billableHours)}</Pill>
            ) : (
              <Pill tone="muted">—</Pill>
            )}
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

/** Inline "assign this site to a client" control shown inside a SiteGroup. */
function AssignRow({
  clients,
  defaultClientId,
  onAssign,
}: {
  clients: Client[];
  defaultClientId: number | null;
  onAssign: (clientId: number | null) => Promise<void> | void;
}) {
  const [choice, setChoice] = useState<string>(
    defaultClientId !== null ? String(defaultClientId) : "",
  );
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (choice === "") return;
    setBusy(true);
    try {
      await onAssign(choice === "internal" ? null : Number(choice));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 bg-slate-50/60 px-4 py-2 pl-11">
      <span className="text-xs text-slate-400">Assign to</span>
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
        onClick={assign}
        disabled={busy || choice === ""}
        className="rounded-lg bg-brand px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {busy ? "Saving…" : "Assign"}
      </button>
    </div>
  );
}
