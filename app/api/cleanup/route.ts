import { NextResponse } from "next/server";
import { cleanup } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// POST /api/cleanup?days=30&force=1 -> enrich unassigned hosts/titles via Claude,
// cache the results, and auto-apply confident attributions as rules.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const result = await cleanup(Number(searchParams.get("days") ?? "7"), {
      force: searchParams.get("force") === "1",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Cleanup failed" },
      { status: 500 },
    );
  }
}
