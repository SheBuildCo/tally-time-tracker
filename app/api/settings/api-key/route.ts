import { NextResponse } from "next/server";
import { setApiKey, ValidationError } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// POST /api/settings/api-key { value } -> store the shared Anthropic API key.
// Write-only: there is no GET, so the key is never read back to the renderer.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { value?: unknown };
    return NextResponse.json(await setApiKey(body.value));
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    return NextResponse.json(
      { error: (err as Error).message ?? "Failed to save key" },
      { status },
    );
  }
}
