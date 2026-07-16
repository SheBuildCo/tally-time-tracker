"use client";

import { useDashboard } from "./DashboardContext";

/**
 * Download the current client breakdown as CSV — the raw material for the
 * weekly/monthly client recap. Respects the active scope (whole team or the
 * selected person) and date range, since it exports exactly what's on screen.
 */
export default function ExportButton() {
  const { report, days, people, personId } = useDashboard();

  function scopeLabel(): string {
    if (personId === undefined) return "All team";
    return people.find((p) => p.id === personId)?.name ?? `Person ${personId}`;
  }

  function toCsv(): string {
    if (!report) return "";
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push(`# Tally export`);
    lines.push(`# Scope,${esc(scopeLabel())}`);
    lines.push(`# Range,${esc(report.range.start)} to ${esc(report.range.end)} (${days}d)`);
    lines.push("");
    lines.push(["Client", "Active hours", "Billable hours", "Billable value"].join(","));
    for (const c of report.clients) {
      lines.push(
        [esc(c.name), c.hours, c.billableHours, c.amount].join(","),
      );
    }
    lines.push("");
    lines.push(
      ["Total", report.totalHours, report.billableHours, report.billableAmount].join(","),
    );
    return lines.join("\n");
  }

  function download() {
    const csv = toCsv();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const scope = scopeLabel().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.href = url;
    a.download = `tally-${scope}-${report?.range.start}_${report?.range.end}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      disabled={!report || report.clients.length === 0}
      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export CSV
    </button>
  );
}
