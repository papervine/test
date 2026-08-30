import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { waitlistEntry } from "@/lib/db/app-schema";
import { checkRateLimit } from "@/lib/rate-limit-store";
import { rateLimited, type RateLimitPolicy } from "@/lib/rate-limit";
import { isHoneypotTripped, parseWaitlistSubmission } from "@/lib/waitlist";

/**
 * Waitlist signups from the marketing home.
 *
 * Public and unauthenticated by definition — the people using it don't have accounts — so it
 * carries the two defences that surface needs: a per-IP rate limit and a honeypot field.
 *
 * Re-submitting the same address is a SUCCESS, not a conflict. Someone who forgets they signed
 * up and does it again should be told they're on the list, not handed an error; the unique
 * index makes that an upsert rather than a second row. A re-submission can only ADD to what we
 * know: a new note replaces an older one, but leaving the box empty the second time keeps the
 * first answer rather than erasing it, and the source is never overwritten with nothing — the
 * page someone first arrived on is attribution we can't recover once it's gone.
 */

/** Tighter than the assistant's: a person joins a waitlist once, not twenty times an hour. */
const WAITLIST_POLICY: RateLimitPolicy = { limit: 5, windowMs: 10 * 60_000 };

/** What a bot is told, and what a real person is told, are deliberately identical. */
const ok = () => Response.json({ ok: true });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Enter your email address." }, { status: 400 });
  }

  // Before the limiter, so a bot filling every field doesn't also burn the window for whoever
  // shares its IP.
  if (isHoneypotTripped(body)) return ok();

  const limit = await checkRateLimit("waitlist", req, WAITLIST_POLICY);
  if (!limit.allowed) {
    return rateLimited(
      limit.retryAfterSec,
      "That's a lot of signups from one place — give it a minute and try again.",
    );
  }

  const parsed = parseWaitlistSubmission(body);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  // Only the fields they actually filled in this time, so a second visit can't blank out the
  // first. `createdAt` is never touched either: it records when they first asked, which is the
  // order the list should be worked through.
  const update = {
    ...(parsed.value.note !== null ? { note: parsed.value.note } : {}),
    ...(parsed.value.source !== null ? { source: parsed.value.source } : {}),
  };

  try {
    const insert = db.insert(waitlistEntry).values({ id: randomUUID(), ...parsed.value });
    // An empty `set` is not a no-op upsert — drizzle emits `ON CONFLICT DO UPDATE SET` with
    // nothing after it, which Postgres rejects as a syntax error, and it builds that clause even
    // on the FIRST insert. So an email with no note and no source (a bare API call; the form
    // always sends a source) 500'd every time until this branch existed.
    await (Object.keys(update).length > 0
      ? insert.onConflictDoUpdate({ target: waitlistEntry.email, set: update })
      : insert.onConflictDoNothing({ target: waitlistEntry.email }));
  } catch (err) {
    // The one failure a visitor can't do anything about. Logged with the error and answered
    // with a message that tells them their address wasn't lost by suggesting the other route.
    console.error("[waitlist] insert failed", err);
    return Response.json(
      { ok: false, error: "Something went wrong on our end — try again, or email hello@papervine.io." },
      { status: 500 },
    );
  }

  return ok();
}
