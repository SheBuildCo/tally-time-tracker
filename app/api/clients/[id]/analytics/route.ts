import { NextResponse } from "next/server";
import { getClientReport } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// GET /api/clients/:id/analytics?days=7 -> one client's breakdown.
// Optional ?day=YYYY-MM-DD scopes to a single day (used by the Daily table).
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { searchParams } = new URL(request.url);
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const days = Number(searchParams.get("days") ?? "7");
    const report = await getClientReport(id, days);
    if (!report) {
      return NextResponse.json({ error: "unknown client" }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to build client report" },
      { status: 500 },
    );
  }
}
