import { describe, expect, it } from "vitest";
import {
  resolveEntitlements,
  reviveBillingLookup,
  trialStatus,
  type BillingLookup,
} from "@/lib/billing/core";

// The dashboard's billing read goes through Next's data cache, which stores JSON — so a cache
// HIT hands back the lookup with its Date as an ISO string while the MISS that populated it
// hands back a real Date. The org layout calls `trialEndsAt.getTime()` on either. This pins the
// reviver that makes both shapes identical (the 500 this fixes was `getTime is not a function`
// on the second render of every dashboard page).

const ok: BillingLookup = {
  state: "ok",
  sub: {
    status: "trialing",
    trialEndsAt: new Date("2026-09-20T00:00:00.000Z"),
    entitlements: resolveEntitlements(null, new Date("2026-09-01T00:00:00.000Z")),
  },
  buckets: { trial: 0, monthly: 0, pack: 0 },
  overageEnabled: false,
};

function roundTrip(lookup: BillingLookup): BillingLookup {
  return JSON.parse(JSON.stringify(lookup)) as BillingLookup;
}

describe("reviveBillingLookup", () => {
  it("turns the JSON-serialised trial end back into a Date", () => {
    const revived = reviveBillingLookup(roundTrip(ok));
    expect(revived.state).toBe("ok");
    if (revived.state !== "ok") return;
    expect(revived.sub.trialEndsAt).toBeInstanceOf(Date);
    expect(revived.sub.trialEndsAt?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("leaves a lookup that never hit the cache untouched", () => {
    expect(reviveBillingLookup(ok)).toBe(ok);
  });

  it("passes through null trial ends and the non-ok shapes", () => {
    const paid = roundTrip({ ...ok, sub: { ...ok.sub, status: "active", trialEndsAt: null } });
    expect(reviveBillingLookup(paid)).toEqual(paid);
    expect(reviveBillingLookup({ state: "none" })).toEqual({ state: "none" });
    expect(reviveBillingLookup({ state: "error" })).toEqual({ state: "error" });
  });

  it("is what the layout's trial pill needs: trialStatus works on a cache hit", () => {
    const revived = reviveBillingLookup(roundTrip(ok));
    if (revived.state !== "ok") throw new Error("unreachable");
    const status = trialStatus(revived.sub, new Date("2026-09-10T00:00:00.000Z"));
    expect(status).toEqual({ state: "active", daysLeft: 10, endsAt: revived.sub.trialEndsAt });
  });
});
