// Effectful half of the rate limiter — the Postgres counter behind the pure decision core
// in rate-limit.ts. Same defensive posture as billing/store.ts: THE LIMITER MUST NEVER
// TAKE DOWN THE SURFACE IT PROTECTS. A DB error fails OPEN (warn + allow), because the
// failure mode of guessing wrong in the other direction is "nobody can use the assistant".
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ASSISTANT_POLICY,
  clientIp,
  evaluate,
  rateLimitKey,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "./rate-limit";

/**
 * Count this request against `surface` and decide whether to serve it.
 *
 * The increment is ONE atomic statement. Read-then-write would let two concurrent requests
 * from the same client both read `count: 19` and both write 20 — exactly the burst a
 * limiter exists to stop — so the window reset is expressed as a CASE inside the UPDATE
 * rather than as a branch in application code. (applyHit() in rate-limit.ts is the same
 * rule in TypeScript, and is what the unit tests pin; keep the two in step.)
 *
 * No-DB modes (PAPERVINE_CONTENT single-repo preview, the smoke gate) short-circuit before
 * touching the client, like getSiteBySlug — a rendered path must survive a missing DB.
 */
export async function checkRateLimit(
  surface: string,
  req: Request,
  policy: RateLimitPolicy = ASSISTANT_POLICY,
): Promise<RateLimitDecision> {
  if (process.env.PAPERVINE_CONTENT) return { allowed: true, remaining: policy.limit };

  const key = rateLimitKey(surface, clientIp(req.headers));
  const now = new Date();
  const cutoff = new Date(now.getTime() - policy.windowMs);
  // ISO strings with an explicit cast, not Date objects: `db.execute` hands parameters straight
  // to the driver without drizzle's column-aware serializer, and postgres-js rejects a bare Date
  // there ("The string argument must be of type string… Received an instance of Date"). Because
  // this store fails OPEN, that error surfaced as "the limiter silently does nothing" rather
  // than as a crash — caught only by the e2e that asserts a 429 actually arrives.
  // `.replace("Z", "")` because the column is a naive `timestamp` (the convention across this
  // schema): feeding it a UTC-marked literal would make Postgres apply the server's TimeZone on
  // the way in. Every value written here is UTC, and the epoch is read back explicitly below,
  // so the two sides can't disagree.
  const nowSql = now.toISOString().replace("Z", "");
  const cutoffSql = cutoff.toISOString().replace("Z", "");

  try {
    // Return the window start as epoch MILLIS rather than a timestamp: a naive `timestamp` read
    // back through the driver becomes a Date interpreted in the process's local zone, which
    // would shift retryAfter by the UTC offset. `extract(epoch …)` is a number, so there is
    // nothing left to misinterpret.
    const rows = (await db.execute(sql`
      INSERT INTO rate_limit (key, count, window_start)
      VALUES (${key}, 1, ${nowSql}::timestamp)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limit.window_start <= ${cutoffSql}::timestamp THEN 1 ELSE rate_limit.count + 1 END,
        window_start = CASE WHEN rate_limit.window_start <= ${cutoffSql}::timestamp THEN ${nowSql}::timestamp ELSE rate_limit.window_start END
      RETURNING count, (extract(epoch from window_start) * 1000)::bigint AS window_start_ms
    `)) as unknown as Array<{ count: number | string; window_start_ms: number | string }>;

    const row = rows[0];
    if (!row) return { allowed: true, remaining: policy.limit };

    return evaluate(
      { count: Number(row.count), windowStart: Number(row.window_start_ms) },
      now.getTime(),
      policy,
    );
  } catch (err) {
    console.warn("[rate-limit] store failed — failing open:", err);
    return { allowed: true, remaining: policy.limit };
  }
}
