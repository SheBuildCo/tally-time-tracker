import { NextResponse } from "next/server";
import { health } from "@/lib/handlers";

export const dynamic = "force-dynamic";

// Reports whether the local ActivityWatch tracker is reachable so the UI can
// show a clear "tracker not running" state instead of failing silently.
export async function GET() {
  return NextResponse.json(await health());
}
