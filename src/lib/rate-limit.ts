// Per-visitor rate limiting for the PUBLIC AI endpoints (SPEC §8.6/§8.7).
//
// Pure and dependency-light (just node:crypto), like agent-session.ts, so the decision
// logic unit-tests without a DB. The Postgres-backed counter lives in rate-limit-store.ts;
// this file is the part worth being certain about.
//
// Why this exists: /api/assistant and /api/widget/{id}/chat are the only surfaces where an
// unauthenticated stranger spends our model budget. The widget's origin allowlist stops
// OTHER sites embedding a customer's widget, but it does nothing about the same visitor
// asking two hundred questions from an allowed page — and the apex assistant (record null)
// is deliberately unmetered, so billing never pushes back on it either.

import { createHash } from "node:crypto";
import { firstForwardedIp } from "./agent-session";

export type RateLimitPolicy = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

/** One counter row: how many hits so far, and when the current window opened. */
export type WindowState = { count: number; windowStart: number };

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number };

/**
 * 20 questions per 10 minutes, per client, per surface.
 *
 * A real reader asks a handful of questions in a sitting, so this is several times normal
 * use and won't be felt; it still caps one abusive client at ~120 answers/hour of model
 * spend on any single surface. Deliberately generous rather than tight — the first
 * limiter in this codebase should stop the pathological case, not produce support tickets.
 */
export const ASSISTANT_POLICY: RateLimitPolicy = { limit: 20, windowMs: 10 * 60_000 };

/**
 * Fold one request into the counter. A fixed window (reset wholesale once `windowMs` has
 * elapsed) rather than a sliding log: it's a single atomic upsert of two columns instead of
 * a timestamp array per client. The known weakness is a client landing 2×limit across a
 * window boundary — at 20/10min that's 40 answers in a burst, still far below anything
 * worth a more expensive algorithm.
 *
 * A `windowStart` in the future (clock skew between app instances, or a clock stepping
 * backwards) is treated as "window has not elapsed", so skew can never hand out a free reset.
 */
export function applyHit(
  prev: WindowState | null,
  now: number,
  policy: RateLimitPolicy,
): WindowState {
  if (!prev || now - prev.windowStart >= policy.windowMs) {
    return { count: 1, windowStart: now };
  }
  return { count: prev.count + 1, windowStart: prev.windowStart };
}

/**
 * Judge a counter that has already had the current request folded in (so `count === limit`
 * is the last ALLOWED request, and `limit + 1` is the first refusal).
 */
export function evaluate(
  state: WindowState,
  now: number,
  policy: RateLimitPolicy,
): RateLimitDecision {
  if (state.count <= policy.limit) {
    return { allowed: true, remaining: policy.limit - state.count };
  }
  const msLeft = state.windowStart + policy.windowMs - now;
  // Never advertise 0 (or a negative, if the window lapsed between the write and here):
  // Retry-After: 0 invites an immediate retry, which is the behavior we're refusing.
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(msLeft / 1000)) };
}

/**
 * The requesting client's IP: the first hop of X-Forwarded-For (the originating client;
 * everything after it is proxy chain), falling back to X-Real-IP. Null locally, where
 * neither header is set — see rateLimitKey for what that means.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = firstForwardedIp(headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

/**
 * The counter key. The IP is HASHED, never stored: this table would otherwise be a log of
 * which IP read which docs site, which is exactly the kind of record we don't want to keep
 * (and `rate_limit` rows outlive a request, unlike the analytics path's in-memory use).
 *
 * `surface` scopes the count — `widget:{widgetId}`, `assistant:{siteId}`, `assistant:apex`
 * — so one busy office NAT on a customer's widget can't lock that visitor out of the
 * platform's own docs assistant, and one noisy tenant can't consume another's allowance.
 *
 * With no IP (local dev, or a deployment that strips the headers) every client collapses to
 * one `unknown` bucket. That's the safe direction — it over-limits rather than under-limits
 * — and it never happens on Vercel, which always sets X-Forwarded-For.
 */
export function rateLimitKey(surface: string, ip: string | null): string {
  if (!ip) return `${surface}:unknown`;
  return `${surface}:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

/**
 * The refusal. Shaped like the other AI-route errors ({ error, code }) so the widget script
 * and the in-docs Assistant, which both surface `body.error` for any non-2xx, show the
 * message in the conversation with no client change.
 *
 * `message` exists because this is no longer only used by the AI routes: the default talks
 * about asking questions, which is nonsense on a form that takes an email address, and the
 * refusal is read by the person who hit it.
 */
export function rateLimited(
  retryAfterSec: number,
  message = "You've asked a lot of questions in a short time — give it a minute and try again.",
): Response {
  return Response.json(
    { error: message, code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
