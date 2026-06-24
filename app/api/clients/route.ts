import { NextResponse } from "next/server";
import { addClient, getClients, ValidationError } from "@/lib/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getClients());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(addClient(body), { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
