"use client";

import Nav from "./Nav";
import { RANGE_OPTIONS, useDashboard } from "./DashboardContext";

function RangePicker() {
  const { days, setDays } = useDashboard();
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.days}
          onClick={() => setDays(opt.days)}
          className={[
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            days === opt.days
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TrackerBanner() {
  const { trackerUnavailable, error } = useDashboard();
  if (!trackerUnavailable && !error) return null;
  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {trackerUnavailable ? (
        <>
          <strong>ActivityWatch isn&apos;t reachable.</strong> Start the tracker
          (aw-qt) on this machine so Tally can read your usage. See{" "}
          <code>docs/SETUP.md</code>.
        </>
      ) : (
        <>Couldn&apos;t load analytics: {error}</>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-5 md:flex">
        <div className="px-3 pb-6">
          <div className="text-lg font-bold tracking-tight text-gray-900">
            Tally
          </div>
          <div className="text-xs text-gray-400">time → billables</div>
        </div>
        <Nav />
        <div className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-gray-400">
          Tracking runs automatically via ActivityWatch. You only set the
          client mapping rules.
        </div>
      </aside>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="md:hidden text-lg font-bold text-gray-900">
              Tally
            </div>
            <div className="ml-auto">
              <RangePicker />
            </div>
          </div>
          <TrackerBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
