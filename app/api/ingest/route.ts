import { NextResponse } from "next/server";
import { ingest, UnauthorizedError, ValidationError } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// POST /api/ingest -> a machine's agent pushes one day's local ActivityWatch
// events. Body: { token, day: "YYYY-MM-DD", events: UsageEvent[] }. The token
// authenticates the person; categorization + rollup happen server-side against
// the shared rules.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(ingest(body));
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (err as Error).message ?? "Ingest failed" },
      { status: 500 },
    );
  }
}
