"use client";

import Nav from "./Nav";
import { RANGE_OPTIONS, useDashboard } from "./DashboardContext";

/** Reference-style labelled dropdown for the date range. */
function RangeSelect() {
  const { days, setDays } = useDashboard();
  return (
    <label className="flex flex-col">
      <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        Date range
      </span>
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100"
      >
        {RANGE_OPTIONS.map((opt) => (
          <option key={opt.days} value={opt.days}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TrackerBanner() {
  const { trackerAvailable, error, loading } = useDashboard();
  if (loading) return null;
  if (error) {
    return (
      <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        Couldn&apos;t load analytics: {error}
      </div>
    );
  }
  if (!trackerAvailable) {
    return (
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        <strong>ActivityWatch isn&apos;t running.</strong> Showing saved history —
        start the tracker (aw-qt) to capture today&apos;s activity. See{" "}
        <code>docs/SETUP.md</code>.
      </div>
    );
  }
  return null;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-[var(--canvas)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-violet-600 text-sm font-bold text-white">
              T
            </div>
            <div className="text-lg font-bold tracking-tight text-slate-800">
              Tally
            </div>
          </div>
          <div className="hidden md:block">
            <Nav />
          </div>
          <div className="ml-auto">
            <RangeSelect />
          </div>
          <div className="w-full md:hidden">
            <Nav />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <TrackerBanner />
        {children}
      </main>
    </div>
  );
}
