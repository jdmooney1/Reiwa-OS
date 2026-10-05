// ============================================================================
// Daily FX sync, invoked by Vercel Cron (vercel.json).
// ----------------------------------------------------------------------------
// NOT a public endpoint. Vercel sends `Authorization: Bearer $CRON_SECRET`; anything
// else - including every request when CRON_SECRET is unset - is a bare 401 that
// says nothing about why. The body of a success names currencies and dates only.
// ============================================================================
import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { runFxSync } from "@/lib/data/fx-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorizeCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const outcome = await runFxSync();
  // 502 on a failed run so it shows as a failed invocation in Vercel's cron log.
  return NextResponse.json(outcome, { status: outcome.status === "ok" ? 200 : 502 });
}
