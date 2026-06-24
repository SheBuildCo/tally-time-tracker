"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/client";
import type { Report } from "@/lib/report";

interface DashboardState {
  report: Report | null;
  loading: boolean;
  error: string | null;
  trackerAvailable: boolean;
  days: number;
  setDays: (d: number) => void;
  refresh: () => void;
}

const DashboardCtx = createContext<DashboardState | null>(null);

export const RANGE_OPTIONS = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
];

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackerAvailable, setTrackerAvailable] = useState(true);
  const [days, setDays] = useState(7);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api()
      .getAnalytics(days)
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
  }, [days, nonce]);

  const value = useMemo<DashboardState>(
    () => ({
      report,
      loading,
      error,
      trackerAvailable,
      days,
      setDays,
      refresh,
    }),
    [report, loading, error, trackerAvailable, days, refresh],
  );

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
