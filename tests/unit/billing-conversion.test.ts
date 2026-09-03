import { describe, expect, it } from "vitest";
import { purchaseConversion, purchaseValueCents } from "@/lib/billing/conversion";
import type { CreditPackOffer, PlanOffer } from "@/lib/billing/summary";

// What a purchase is worth, decided from the same offers the billing page renders. The value
// is the whole point: a conversion without one tells Google that a $65 plan, a $250 plan and a
// page refresh are the same event, which is exactly what makes ad spend unmeasurable.

// Mirrors the real catalog, so a reader can check these numbers against Autumn: Team is the
// $65 tier and Pro the $250 one, annual is billed as a year, packs are one-off.
const OFFERS: PlanOffer[] = [
  { planKey: "team", planName: "Team", blurb: "", monthlyCents: 6500, annualPlanKey: "team_annual", yearlyCents: 66000 },
  { planKey: "pro", planName: "Pro", blurb: "", monthlyCents: 25000, annualPlanKey: "pro_annual", yearlyCents: 240000 },
  { planKey: "free", planName: "Free", blurb: "", monthlyCents: 0 },
] as unknown as PlanOffer[];

const PACKS: CreditPackOffer[] = [
  { key: "pack_5k", name: "5,000 credits", credits: 5000, priceCents: 3500 },
  { key: "pack_free", name: "Comped", credits: 100, priceCents: 0 },
];

const CONFIGURED = {
  vercelEnv: "production",
  conversionId: "AW-965112998",
  label: "hWfJCNynhe0cEKbpmcwD",
  transactionId: "chk_123",
  offers: OFFERS,
  packs: PACKS,
};

describe("purchaseValueCents", () => {
  it("prices a monthly plan", () => {
    expect(purchaseValueCents("pro", OFFERS, PACKS)).toBe(25000);
  });

  it("prices the annual variant at the year, not the month", () => {
    // Autumn models annual as its own plan linked to the monthly one; billing a year's
    // purchase as one month would understate revenue by an order of magnitude.
    expect(purchaseValueCents("pro_annual", OFFERS, PACKS)).toBe(240000);
  });

  it("prices a credit pack", () => {
    expect(purchaseValueCents("pack_5k", OFFERS, PACKS)).toBe(3500);
  });

  it("has no price for a free plan, a comped pack, or an id it doesn't know", () => {
    expect(purchaseValueCents("free", OFFERS, PACKS)).toBe(null);
    expect(purchaseValueCents("pack_free", OFFERS, PACKS)).toBe(null);
    expect(purchaseValueCents("enterprise", OFFERS, PACKS)).toBe(null);
  });
});

describe("purchaseConversion", () => {
  it("addresses the conversion action and reports dollars", () => {
    expect(purchaseConversion({ ...CONFIGURED, planId: "pro" })).toEqual({
      sendTo: "AW-965112998/hWfJCNynhe0cEKbpmcwD",
      value: 250,
      currency: "USD",
      transactionId: "chk_123",
    });
  });

  it("reports a pack purchase too", () => {
    expect(purchaseConversion({ ...CONFIGURED, planId: "pack_5k" })?.value).toBe(35);
  });

  it("stays silent with no ad account configured — every self-host, fork and preview", () => {
    expect(purchaseConversion({ ...CONFIGURED, conversionId: undefined, planId: "pro" })).toBe(null);
    expect(purchaseConversion({ ...CONFIGURED, label: undefined, planId: "pro" })).toBe(null);
  });

  it("stays silent anywhere but production, because that is where the tag loads", () => {
    // A preview deployment carries the same env vars. Reporting from one would put purchases
    // in the ad account that no ad click could ever have produced.
    expect(purchaseConversion({ ...CONFIGURED, vercelEnv: "preview", planId: "pro" })).toBe(null);
    expect(purchaseConversion({ ...CONFIGURED, vercelEnv: undefined, planId: "pro" })).toBe(null);
  });

  it("stays silent when nothing was actually bought", () => {
    expect(purchaseConversion({ ...CONFIGURED, planId: "free" })).toBe(null);
    expect(purchaseConversion({ ...CONFIGURED, planId: undefined })).toBe(null);
  });

  it("stays silent without a transaction id, since a reload could then double-count", () => {
    expect(purchaseConversion({ ...CONFIGURED, transactionId: undefined, planId: "pro" })).toBe(
      null,
    );
  });
});
