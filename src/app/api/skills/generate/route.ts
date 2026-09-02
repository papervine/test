import { isDevLike } from "@/lib/env";
import { NextResponse } from "next/server";
import { sweepSkillGeneration } from "@/lib/skill-generate";

// The skill.md generation sweep (SPEC §9.1), driven by Vercel Cron (vercel.json).
//
// Hourly rather than on publish: a publish only sets `skill_stale_at`, and this decides. That
// collapses an afternoon of twenty commits into one model call, and keeps generation off the
// path where someone is waiting for their site to go live.
//
// A missed run costs nothing permanent — the flag stays set and the next run picks the site up,
// which is why this is a sweep over state rather than a queue of events.
//
// This route only DECIDES. The generation itself is a Trigger.dev task, one run per site, so a
// corpus-reading model call never has to fit inside a serverless budget shared with nine others.
// Hence the modest maxDuration: what happens here is a query and a fan-out of enqueues.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Same cron auth contract as the other sweeps: Vercel sends
// `Authorization: Bearer ${CRON_SECRET}`; when unset (local/dev), allow manual runs.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isDevLike();
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const result = await sweepSkillGeneration();
  return NextResponse.json(result);
}
