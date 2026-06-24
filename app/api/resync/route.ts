import { NextResponse } from "next/server";
import { resync } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// POST /api/resync?days=30 -> re-ingest the range applying current rules.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const result = await resync(Number(searchParams.get("days") ?? "7"));
    return NextResponse.json({
      ok: true,
      trackerAvailable: result.trackerAvailable,
      rows: result.rows.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Resync failed" },
      { status: 500 },
    );
  }
}
