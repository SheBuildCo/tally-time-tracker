import { NextResponse } from "next/server";
import { deleteClient, updateClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const fields: Record<string, unknown> = {};
  if (typeof body.name === "string") fields.name = body.name.trim();
  if (body.billableRate !== undefined) fields.billableRate = Number(body.billableRate);
  if (typeof body.color === "string") fields.color = body.color;
  const client = updateClient(id, fields);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ client });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deleteClient(id);
  return NextResponse.json({ ok: true });
}
