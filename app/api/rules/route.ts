import { NextResponse } from "next/server";
import { createRule, listRules, type RuleInput } from "@/lib/db";
import type { RuleMatch } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rules: listRules() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const match: RuleMatch = {};
  if (typeof body.app === "string" && body.app.trim()) match.app = body.app.trim();
  if (typeof body.titleRegex === "string" && body.titleRegex.trim())
    match.titleRegex = body.titleRegex.trim();
  if (typeof body.urlDomain === "string" && body.urlDomain.trim())
    match.urlDomain = body.urlDomain.trim().toLowerCase();

  if (!match.app && !match.titleRegex && !match.urlDomain) {
    return NextResponse.json(
      { error: "a rule needs at least one of app, titleRegex or urlDomain" },
      { status: 400 },
    );
  }

  const input: RuleInput = {
    match,
    clientId:
      body.clientId === null || body.clientId === undefined
        ? null
        : Number(body.clientId),
    project: typeof body.project === "string" ? body.project : null,
    billable: body.billable !== false,
    priority: Number.isFinite(Number(body.priority))
      ? Number(body.priority)
      : 100,
  };

  const rule = createRule(input);
  return NextResponse.json({ rule }, { status: 201 });
}
