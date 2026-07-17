import { NextResponse } from "next/server";
import { removeRule, ValidationError } from "@/lib/handlers";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    return NextResponse.json(await removeRule(Number(params.id)));
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
