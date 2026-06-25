"use client";

// Dashboard visuals (Recharts via the shadcn ChartContainer). Client breakdown
// leads; "unassigned" is always painted with the muted grey token, never amber.

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { formatCurrency, formatHours } from "@/lib/format";
import type { ClientSummary } from "@/lib/analytics";

const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const UNASSIGNED = "var(--chart-unassigned)";

export interface HoursDatum {
  name: string;
  value: number;
  unassigned?: boolean;
}

function truncate(v: string): string {
  return v.length > 20 ? `${v.slice(0, 19)}…` : v;
}

function ValueTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; payload?: { name?: string } }>;
  kind: "hours" | "currency";
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = p.payload?.name ?? p.name ?? "";
  const val = Number(p.value ?? 0);
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-slate-700">{name}</div>
      <div className="text-slate-500">
        {kind === "currency" ? formatCurrency(val) : formatHours(val)}
      </div>
    </div>
  );
}

function NoData() {
  return (
    <div className="flex h-60 items-center justify-center text-sm text-slate-400">
      Nothing to chart yet.
    </div>
  );
}

/** Donut of where the billable value sits, by client (falls back to hours). */
export function ClientValueDonut({ clients }: { clients: ClientSummary[] }) {
  const useValue = clients.some((c) => c.amount > 0);
  const data = clients
    .map((c) => ({
      name: c.name,
      value: useValue ? c.amount : c.hours,
      unassigned: c.clientId === null,
    }))
    .filter((d) => d.value > 0)
    // unassigned slice always last
    .sort(
      (a, b) =>
        Number(a.unassigned) - Number(b.unassigned) || b.value - a.value,
    );

  if (data.length === 0) return <NoData />;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative">
      <ChartContainer config={{}} className="mx-auto aspect-square max-h-72">
        <PieChart>
          <Tooltip
            content={<ValueTooltip kind={useValue ? "currency" : "hours"} />}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d, i) => (
              <Cell
                key={d.name}
                fill={d.unassigned ? UNASSIGNED : SERIES[i % SERIES.length]}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xs text-slate-400">
          {useValue ? "Billable value" : "Billable hours"}
        </div>
        <div className="text-2xl font-bold tracking-tight text-slate-800">
          {useValue ? formatCurrency(total) : formatHours(total)}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bar list of hours by name (clients or sites). */
export function HoursBars({ data }: { data: HoursDatum[] }) {
  if (data.length === 0) return <NoData />;
  return (
    <ChartContainer config={{}} className="aspect-auto h-72 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12 }}
          tickFormatter={truncate}
        />
        <Tooltip
          cursor={{ fill: "rgba(15,23,42,0.04)" }}
          content={<ValueTooltip kind="hours" />}
        />
        <Bar dataKey="value" radius={4} barSize={16}>
          {data.map((d) => (
            <Cell
              key={d.name}
              fill={d.unassigned ? UNASSIGNED : "var(--chart-1)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
