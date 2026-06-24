// Shared UI primitives — one calm, consistent card/metric style used everywhere,
// matching the soft pastel reference design (white rounded cards, big slate
// numbers, muted captions).

import type { ReactNode } from "react";

/** Pastel chart palette (Tremor colour names). */
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
        : "bg-violet-50 text-violet-600";
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
