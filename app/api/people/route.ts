import { NextResponse } from "next/server";
import { addPerson, getPeople, ValidationError } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// GET /api/people -> team members (no tokens).
export async function GET() {
  return NextResponse.json(getPeople());
}

// POST /api/people { name } -> create a teammate; returns their agent token ONCE.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(addPerson(body), { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
