"use client";

import { useDashboard } from "./DashboardContext";
import { EmptyState } from "./ui";
import type { Report } from "@/lib/report";

/**
 * Renders `children(report)` once analytics are loaded. Shows a soft loading
 * skeleton while fetching and a neutral message when there's no data, so pages
 * don't each re-implement these states.
 */
export default function LoadingGate({
  children,
}: {
  children: (report: Report) => React.ReactNode;
}) {
  const { report, loading, error } = useDashboard();

  if (loading && !report) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl bg-white/60 ring-1 ring-slate-100"
          />
        ))}
      </div>
    );
  }

  if (!report) {
    if (error) return null; // banner in Shell explains it
    return <EmptyState>No tracked activity yet.</EmptyState>;
  }

  if (report.totalHours === 0) {
    return (
      <EmptyState>
        No active time recorded in this range. Once you use your apps with
        ActivityWatch running, usage will appear here.
      </EmptyState>
    );
  }

  return <>{children(report)}</>;
}
