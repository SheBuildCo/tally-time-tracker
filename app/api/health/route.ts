import { NextResponse } from "next/server";
import { AW_BASE_URL, isAvailable } from "@/lib/activitywatch";

export const dynamic = "force-dynamic";

// Reports whether the local ActivityWatch tracker is reachable so the UI can
// show a clear "tracker not running" state instead of failing silently.
export async function GET() {
  const available = await isAvailable();
  return NextResponse.json({ available, awBaseUrl: AW_BASE_URL });
}
