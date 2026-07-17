import { NextResponse } from "next/server";
import { expireTrials } from "@/lib/billing/store";

// Trial-expiry sweep (SPEC §10 Billing lifecycle), driven by Vercel Cron (vercel.json).
// Bookkeeping only — entitlement enforcement never waits for this: resolveEntitlements
// already treats a past-end trial as Free, so a late/missed run can't extend anyone's
// trial. This flips status, expires unused trial credits into the ledger, and zeroes
// the trial bucket. Idempotent (expired rows leave the 'trialing' status it selects on).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same cron auth contract as /api/reconcile/domains: Vercel sends
// `Authorization: Bearer ${CRON_SECRET}`; when unset (local/dev), allow manual runs.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await expireTrials();
  return NextResponse.json({ ok: true, ...result });
}
