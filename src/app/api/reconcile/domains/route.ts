import { isDevLike } from "@/lib/env";
import { NextResponse } from "next/server";
import { reconcileDomainRemovals } from "@/lib/domain-reconcile";

// Reconcile loop for durable custom-domain deletion (SPEC §2): drains the `domain_removal`
// tombstones, retrying the Vercel detach until it confirms. Driven by Vercel Cron (see the
// `crons` entry in vercel.json). Idempotent and safe to run on any schedule — the inline detach
// in `releaseDomain` already handles the happy path, so this is the durability safety net.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set. Require it
// in production so the endpoint isn't a public lever on our Vercel API quota; when unset
// (local/dev), allow it so the loop is runnable by hand.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isDevLike();
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await reconcileDomainRemovals();
  return NextResponse.json({ ok: true, ...result });
}
