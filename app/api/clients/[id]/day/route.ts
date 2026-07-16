import { NextResponse } from "next/server";
import { getClientDay } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// GET /api/clients/:id/day?date=YYYY-MM-DD -> one client's detail for one day.
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { searchParams } = new URL(request.url);
  const id = Number(params.id);
  const date = searchParams.get("date") ?? "";
  if (!Number.isInteger(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid id or date" }, { status: 400 });
  }
  try {
    const person = searchParams.get("personId");
    const report = await getClientDay(
      id,
      date,
      person ? Number(person) : undefined,
    );
    if (!report) {
      return NextResponse.json({ error: "unknown client" }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to build client day" },
      { status: 500 },
    );
  }
}
