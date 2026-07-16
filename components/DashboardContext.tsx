"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/client";
import type { Report } from "@/lib/report";
import type { Person } from "@/lib/types";

interface DashboardState {
  report: Report | null;
  loading: boolean;
  error: string | null;
  trackerAvailable: boolean;
  days: number;
  setDays: (d: number) => void;
  /** People available to filter by; empty until loaded. */
  people: Person[];
  /** Selected person to scope views to, or undefined for the whole team. */
  personId: number | undefined;
  setPersonId: (id: number | undefined) => void;
  refresh: () => void;
  /** Bumps on every refresh so per-page views can re-fetch in lockstep. */
  refreshKey: number;
}

const DashboardCtx = createContext<DashboardState | null>(null);

export const RANGE_OPTIONS = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackerAvailable, setTrackerAvailable] = useState(true);
  const [days, setDays] = useState(7);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState<number | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Load the team roster once so the person selector can offer "All team" plus
  // each teammate. Harmless (empty) on a single-person instance.
  useEffect(() => {
    let cancelled = false;
    api()
      .listPeople()
      .then((r) => {
        if (!cancelled) setPeople(r.people);
      })
      .catch(() => {
        /* selector just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh whenever the user actually looks at the app (window focus /
  // tab becomes visible) and on a light interval while it stays visible, so a
  // long-lived window doesn't show frozen "today" numbers. Throttled so the
  // focus + visibilitychange double-fire on alt-tab collapses to one fetch.
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    const POLL_MS = 60_000;
    const THROTTLE_MS = 2_000;
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAutoRefresh.current < THROTTLE_MS) return;
      lastAutoRefresh.current = now;
      refresh();
    };
    const onVisibility = () => refreshIfVisible();
    const onFocus = () => refreshIfVisible();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(refreshIfVisible, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api()
      .getAnalytics(days, personId)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setTrackerAvailable(data.trackerAvailable);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load analytics");
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, personId, nonce]);

  const value = useMemo<DashboardState>(
    () => ({
      report,
      loading,
      error,
      trackerAvailable,
      days,
      setDays,
      people,
      personId,
      setPersonId,
      refresh,
      refreshKey: nonce,
    }),
    [report, loading, error, trackerAvailable, days, people, personId, refresh, nonce],
  );

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
