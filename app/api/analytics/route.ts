import { NextResponse } from "next/server";
import { buildReport } from "@/lib/report";
import { ActivityWatchError } from "@/lib/activitywatch";

export const dynamic = "force-dynamic";

// GET /api/analytics?days=7 -> full dashboard report.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = clampDays(Number(searchParams.get("days") ?? "7"));
  try {
    const report = await buildReport(days);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof ActivityWatchError) {
      return NextResponse.json(
        { error: err.message, trackerUnavailable: true },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to build report" },
      { status: 500 },
    );
  }
}

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(Math.floor(n), 90);
}
