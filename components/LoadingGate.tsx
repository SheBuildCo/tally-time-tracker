"use client";

import { useDashboard } from "./DashboardContext";
import type { Report } from "@/lib/report";

/**
 * Renders `children(report)` once analytics are loaded. Shows a loading
 * skeleton while fetching and a neutral message when the tracker is down or the
 * range has no data, so individual pages don't each re-implement these states.
 */
export default function LoadingGate({
  children,
}: {
  children: (report: Report) => React.ReactNode;
}) {
  const { report, loading, error, trackerUnavailable } = useDashboard();

  if (loading && !report) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  if (!report) {
    // The banner in Shell already explains tracker/errors; keep this quiet.
    if (trackerUnavailable || error) return null;
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No tracked activity in this range yet.
      </div>
    );
  }

  if (report.totalHours === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No active time recorded in this range. Once you use your apps with
        ActivityWatch running, usage will appear here.
      </div>
    );
  }

  return <>{children(report)}</>;
}
