import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// GET /api/analytics?days=7 -> full dashboard report (serves persisted history;
// `trackerAvailable` flags whether ActivityWatch could be reached for live days).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const report = await getAnalytics(Number(searchParams.get("days") ?? "7"));
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to build report" },
      { status: 500 },
    );
  }
}
