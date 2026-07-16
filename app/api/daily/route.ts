import { NextResponse } from "next/server";
import { getDaily } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// GET /api/daily?days=7 -> Daily Totals table rows (per day, per client).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const person = searchParams.get("personId");
    return NextResponse.json(
      await getDaily(
        Number(searchParams.get("days") ?? "7"),
        person ? Number(person) : undefined,
      ),
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to build daily report" },
      { status: 500 },
    );
  }
}
