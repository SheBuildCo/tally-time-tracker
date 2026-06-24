import { NextResponse } from "next/server";
import { createClient, listClients } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ clients: listClients() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rate = Number(body.billableRate ?? 0);
  const client = createClient(
    body.name.trim(),
    Number.isFinite(rate) ? rate : 0,
    typeof body.color === "string" ? body.color : undefined,
  );
  return NextResponse.json({ client }, { status: 201 });
}
