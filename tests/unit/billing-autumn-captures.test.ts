// The adapter against REAL SDK responses. tests/unit/fixtures/autumn/*.json are verbatim
// captures from `autumn-js` 1.2 (customer with the trial attached, a Free customer, the plan
// list), scrubbed of identifying values and nothing else. They are camelCase, because that is
// what the SDK returns — and that is the whole point of this file: the hand-written fixtures in
// billing-autumn.test.ts are in Autumn's DOCUMENTED snake_case, which the SDK never sends.
// Those tests passed for as long as the adapter read `plan_id` from a payload that carried
// `planId`, and production read "no trial end, no overage, add-on = plan" from every customer.
//
// So each capture is run through the boundary normaliser first, exactly as autumn.ts does,
// and one test pins that the raw payload WITHOUT it reads wrong — if the SDK ever starts
// returning snake_case, that test fails and the normaliser can go.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorizeAiDecision, trialStatus } from "@/lib/billing/core";
import { snakeCaseKeys } from "@/lib/billing/autumn-keys";
import { lookupFromCustomer, type AutumnCustomer, type AutumnPlan } from "@/lib/billing/autumn";
import { offersFromPlans, packsFromPlans } from "@/lib/billing/summary";

const FIXTURES = new URL("./fixtures/autumn/", import.meta.url);
function capture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")) as T;
}

const rawTrial = capture<Record<string, unknown>>("sdk-customer-trial.json");
const rawFree = capture<Record<string, unknown>>("sdk-customer-free.json");
const rawPlans = capture<{ list: Record<string, unknown>[] }>("sdk-plans.json");

const trial = snakeCaseKeys<AutumnCustomer>(rawTrial);
const free = snakeCaseKeys<AutumnCustomer>(rawFree);
const plans = snakeCaseKeys<AutumnPlan[]>(rawPlans.list);

const now = new Date("2026-09-02T00:00:00Z");

function ok(lookup: ReturnType<typeof lookupFromCustomer>) {
  if (lookup.state !== "ok") throw new Error(`expected ok, got ${lookup.state}`);
  return lookup;
}

describe("a real SDK customer on the Pro trial", () => {
  it("reads as TRIALING with the trial end and the one-off credit grant", () => {
    const { sub, buckets, overageEnabled } = ok(lookupFromCustomer(trial));
    // Autumn says `status: "active"` + `trialEndsAt`; our core only knows a trial as
    // "trialing". Both fields the raw payload hid are asserted here: the status translation
    // and the camelCase `trialEndsAt` the adapter used to read as undefined.
    expect(rawTrial.subscriptions).toMatchObject([{ status: "active" }]);
    expect(sub.status).toBe("trialing");
    expect(sub.trialEndsAt).toEqual(new Date(1790909202512));
    expect(buckets.monthly).toBe(10_000);
    expect(overageEnabled).toBe(false);
  });

  it("is a live trial to trialStatus — the banner, the 'Trial ends' copy, the expiry backstop", () => {
    const { sub } = ok(lookupFromCustomer(trial));
    const status = trialStatus(sub, new Date(1788400000000)); // a day into the trial
    expect(status.state).toBe("active");
    if (status.state === "active") expect(status.daysLeft).toBe(30);
    // And once the clock passes the end, the core collapses it rather than trusting a stale read.
    expect(trialStatus(sub, new Date(1790909202512 + 1)).state).toBe("expired");
  });

  it("grants every Pro-trial feature and the Pro limits", () => {
    const { entitlements } = ok(lookupFromCustomer(trial)).sub;
    expect(entitlements.sites).toBe(10);
    expect(entitlements.editors).toBe(-1); // unlimited
    expect(entitlements.analyticsRetentionDays).toBe(365);
    const f = entitlements.features;
    expect(f.assistant).toBe(true);
    expect(f.writerAgent).toBe(true);
    expect(f.workflows).toBe(true);
    expect(f.sso).toBe(true);
    expect(f.rbac).toBe(true);
    expect(f.previewDeployments).toBe(true);
    expect(f.adminApis).toBe(true);
    expect(f.insights).toBe(true);
    // Not in the trial (Enterprise-only), and must read false, not undefined.
    expect(f.scim).toBe(false);
    expect(f.whiteLabel).toBe(false);
  });

  it("lets the assistant run, metered", () => {
    expect(authorizeAiDecision(lookupFromCustomer(trial), "assistant", now)).toEqual({
      allowed: true,
      metered: true,
    });
  });
});

describe("a real SDK customer on Free", () => {
  it("matches the hand-written Free expectations", () => {
    const { sub, buckets } = ok(lookupFromCustomer(free));
    expect(sub.status).toBe("active");
    expect(sub.trialEndsAt).toBeNull();
    expect(buckets.monthly).toBe(250);
    expect(sub.entitlements.sites).toBe(1);
    expect(sub.entitlements.editors).toBe(5);
    expect(sub.entitlements.analyticsRetentionDays).toBe(7);
    expect(sub.entitlements.features.writerAgent).toBe(true);
    expect(sub.entitlements.features.assistant).toBe(false);
  });
});

describe("the normaliser is load-bearing", () => {
  it("the raw SDK payload, un-normalised, loses the trial end (why autumn.ts converts first)", () => {
    // If this ever fails because the raw payload now reads correctly, the SDK has switched to
    // snake_case and snakeCaseKeys can be retired. Until then it is the one thing between a
    // correct build and a silently wrong one.
    const lookup = lookupFromCustomer(rawTrial as AutumnCustomer);
    expect(ok(lookup).sub.trialEndsAt).toBeNull();
  });
});

describe("the real catalog", () => {
  it("folds annual variants into their base plan's card, ordered by monthly price", () => {
    const offers = offersFromPlans(plans);
    expect(offers.map((o) => o.planKey)).toEqual(["team", "pro"]);
    const [team, pro] = offers;
    expect(team.monthlyCents).toBe(6500);
    expect(team.yearlyCents).toBe(66000);
    expect(team.annualPlanKey).toBe("team_annual");
    expect(team.credits).toBe(1000);
    expect(pro.monthlyCents).toBe(25000);
    expect(pro.yearlyCents).toBe(240000);
    expect(pro.annualPlanKey).toBe("pro_annual");
  });

  it("does not offer Free, the trial, Enterprise or the packs as plan cards", () => {
    const keys = offersFromPlans(plans).map((o) => o.planKey);
    for (const notACard of ["free", "pro_trial", "enterprise", "pack_5k", "pack_25k"]) {
      expect(keys).not.toContain(notACard);
    }
  });

  it("lists the one-off credit packs, cheapest first", () => {
    const packs = packsFromPlans(plans);
    expect(packs.map((p) => p.key)).toEqual(["pack_5k", "pack_25k"]);
    expect(packs[0]).toMatchObject({ credits: 5000, priceCents: 3500 });
  });
});
