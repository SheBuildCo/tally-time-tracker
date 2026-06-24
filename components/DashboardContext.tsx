"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Report } from "@/lib/report";

interface DashboardState {
  report: Report | null;
  loading: boolean;
  error: string | null;
  trackerUnavailable: boolean;
  days: number;
  setDays: (d: number) => void;
  refresh: () => void;
}

const DashboardCtx = createContext<DashboardState | null>(null);

export const RANGE_OPTIONS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackerUnavailable, setTrackerUnavailable] = useState(false);
  const [days, setDays] = useState(7);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTrackerUnavailable(false);
    fetch(`/api/analytics?days=${days}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Failed to load analytics");
          setTrackerUnavailable(!!data.trackerUnavailable);
          setReport(null);
          return;
        }
        setReport(data as Report);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Network error");
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
      trackerUnavailable,
      days,
      setDays,
      refresh,
    }),
    [report, loading, error, trackerUnavailable, days, refresh],
  );

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
