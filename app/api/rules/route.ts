import { NextResponse } from "next/server";
import { addRule, getRules, ValidationError } from "@/lib/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRules());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    return NextResponse.json(addRule(body), { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
