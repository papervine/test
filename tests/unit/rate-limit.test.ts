import { describe, it, expect } from "vitest";
import {
  ASSISTANT_POLICY,
  applyHit,
  clientIp,
  evaluate,
  rateLimitKey,
  rateLimited,
  type RateLimitPolicy,
  type WindowState,
} from "@/lib/rate-limit";

const POLICY: RateLimitPolicy = { limit: 3, windowMs: 60_000 };
const T0 = 1_700_000_000_000;

/** Fold n requests in a row at the same instant, as a burst from one client would. */
function burst(n: number, now = T0, policy = POLICY): WindowState {
  let state: WindowState | null = null;
  for (let i = 0; i < n; i++) state = applyHit(state, now, policy);
  return state!;
}

describe("applyHit", () => {
  it("opens a window on the first request", () => {
    expect(applyHit(null, T0, POLICY)).toEqual({ count: 1, windowStart: T0 });
  });

  it("increments within the window without moving windowStart", () => {
    const first = applyHit(null, T0, POLICY);
    const second = applyHit(first, T0 + 30_000, POLICY);
    expect(second).toEqual({ count: 2, windowStart: T0 });
  });

  it("resets once the window has fully elapsed", () => {
    const state = burst(3);
    const next = applyHit(state, T0 + POLICY.windowMs, POLICY);
    expect(next).toEqual({ count: 1, windowStart: T0 + POLICY.windowMs });
  });

  it("does not reset one millisecond early", () => {
    const state = burst(3);
    const next = applyHit(state, T0 + POLICY.windowMs - 1, POLICY);
    expect(next.count).toBe(4);
    expect(next.windowStart).toBe(T0);
  });

  it("treats a windowStart in the future as still-open (clock skew is not a free reset)", () => {
    // Two app instances with skewed clocks, or a clock stepping backwards: `now` lands
    // before the stored windowStart. Refusing to reset here is what stops a client from
    // farming resets off skew.
    const skewed: WindowState = { count: 3, windowStart: T0 + 5_000 };
    const next = applyHit(skewed, T0, POLICY);
    expect(next).toEqual({ count: 4, windowStart: T0 + 5_000 });
  });
});

describe("evaluate", () => {
  it("allows up to and including the limit, and reports what's left", () => {
    expect(evaluate(burst(1), T0, POLICY)).toEqual({ allowed: true, remaining: 2 });
    expect(evaluate(burst(3), T0, POLICY)).toEqual({ allowed: true, remaining: 0 });
  });

  it("denies the request after the limit", () => {
    const decision = evaluate(burst(4), T0, POLICY);
    expect(decision.allowed).toBe(false);
  });

  it("reports retryAfter as the time left in the window, rounded up", () => {
    const state = burst(4);
    const decision = evaluate(state, T0 + 30_500, POLICY);
    // 60s window, 30.5s elapsed → 29.5s left → 30s.
    expect(decision).toEqual({ allowed: false, retryAfterSec: 30 });
  });

  it("never advertises a retryAfter below 1 second", () => {
    // Retry-After: 0 invites the immediate retry we're refusing. Also covers the window
    // lapsing between the store's write and this read.
    const state = burst(4);
    expect(evaluate(state, T0 + POLICY.windowMs, POLICY)).toEqual({
      allowed: false,
      retryAfterSec: 1,
    });
    expect(evaluate(state, T0 + POLICY.windowMs + 10_000, POLICY)).toEqual({
      allowed: false,
      retryAfterSec: 1,
    });
  });

  it("lets a client through again in the window after the one that refused it", () => {
    const refused = burst(4);
    expect(evaluate(refused, T0, POLICY).allowed).toBe(false);
    const later = applyHit(refused, T0 + POLICY.windowMs, POLICY);
    expect(evaluate(later, T0 + POLICY.windowMs, POLICY)).toEqual({
      allowed: true,
      remaining: 2,
    });
  });
});

describe("ASSISTANT_POLICY", () => {
  it("is the documented 20 requests per 10 minutes", () => {
    expect(ASSISTANT_POLICY).toEqual({ limit: 20, windowMs: 600_000 });
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for (the originating client)", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7",
      "x-real-ip": "10.0.0.1",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("is null when neither header is present, or they're empty", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIp(new Headers({ "x-real-ip": "   " }))).toBeNull();
  });
});

describe("rateLimitKey", () => {
  const IP = "203.0.113.7";

  it("never contains the raw IP — the table must not become a reading log", () => {
    const key = rateLimitKey("assistant:apex", IP);
    expect(key).not.toContain(IP);
    expect(key).toMatch(/^assistant:apex:[0-9a-f]{32}$/);
  });

  it("is stable for the same client and surface", () => {
    expect(rateLimitKey("assistant:apex", IP)).toBe(rateLimitKey("assistant:apex", IP));
  });

  it("separates surfaces, so one busy widget can't lock the platform's own assistant", () => {
    expect(rateLimitKey("widget:widget_abc", IP)).not.toBe(
      rateLimitKey("assistant:apex", IP),
    );
  });

  it("separates clients", () => {
    expect(rateLimitKey("assistant:apex", IP)).not.toBe(
      rateLimitKey("assistant:apex", "203.0.113.8"),
    );
  });

  it("collapses to one shared bucket with no IP (over-limits rather than under-limits)", () => {
    expect(rateLimitKey("assistant:apex", null)).toBe("assistant:apex:unknown");
  });
});

describe("rateLimited", () => {
  it("is a 429 carrying Retry-After and the shared { error, code } shape", async () => {
    const res = rateLimited(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("rate_limited");
    expect(body.error).toBeTruthy();
  });
});
