// Purchase conversion payload for Google Ads (our acquisition measurement, SPEC §10 Billing).
//
// Pure on purpose: the decision "is this a purchase, and what was it worth" is the whole
// feature, and it is decided from data the page already has (the plan the customer just
// bought + Autumn's own prices). No DB, no network, no `window` — so it is unit-tested rather
// than verified by spending money in a browser.
//
// Why an EVENT and not a URL rule. Google's guided setup offers "count a visit to this page",
// which fails here twice over: the Stripe return lands on `/{org}/billing`, a route that
// redirects (a 307 runs no tag, and Next drops the query on the hop), and a page-visit
// conversion carries no amount, so a $65 plan and a $250 plan and a refresh all look alike.
// Ad spend is only measurable against revenue, so the event carries the price.
//
// `transactionId` is what makes a reload harmless: Google dedupes on it, so the same checkout
// reported twice counts once. It is minted per checkout in the billing action and travels back
// in the return URL, which means it is stable for that purchase and unique across purchases.
import type { CreditPackOffer, PlanOffer } from "./summary";

export type PurchaseConversion = {
  /** `AW-<id>/<label>` — Google's own addressing for one conversion action. */
  sendTo: string;
  /** Major units, as Google expects (dollars, not cents). */
  value: number;
  currency: string;
  transactionId: string;
};

export type ConversionInput = {
  /** VERCEL_ENV. The tag itself only renders on production (see the root layout), so the
   *  payload has to agree: computing one anywhere else would mean reporting a purchase into
   *  an account whose tag never loaded, and would let the two gates drift apart silently. */
  vercelEnv: string | undefined;
  /** NEXT_PUBLIC_GOOGLE_ADS_ID — absent on self-hosts, forks, previews and local dev. */
  conversionId: string | undefined;
  /** NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL — the action's own id within that account. */
  label: string | undefined;
  /** The plan or pack id the customer just attached. */
  planId: string | undefined;
  transactionId: string | undefined;
  offers: PlanOffer[];
  packs: CreditPackOffer[];
};

/** The price of what was bought, in cents, or null if this id isn't a priced purchase. */
export function purchaseValueCents(
  planId: string,
  offers: PlanOffer[],
  packs: CreditPackOffer[],
): number | null {
  const pack = packs.find((p) => p.key === planId);
  if (pack) return pack.priceCents > 0 ? pack.priceCents : null;

  for (const offer of offers) {
    // Autumn models an annual plan as its own plan linked to the monthly one, so the id that
    // comes back can be either. Bill the conversion at what was actually charged: a year up
    // front is a year's revenue, not a month's.
    if (offer.annualPlanKey === planId) return positive(offer.yearlyCents);
    if (offer.planKey === planId) return positive(offer.monthlyCents ?? offer.yearlyCents);
  }
  return null;
}

// A zero price is not a price. `free` is a real offer with `monthlyCents: 0`, and `??` reads
// that as a value rather than an absence — so without this, attaching Free would resolve to a
// $0 purchase and report a conversion for someone who bought nothing.
function positive(cents: number | undefined): number | null {
  return typeof cents === "number" && cents > 0 ? cents : null;
}

/**
 * The event to fire, or null when there is nothing to report — which is the common case and
 * must stay silent: no ad account configured (every self-hoster, every fork, every preview),
 * an unknown plan id, or a free/trial attach, which is not a purchase no matter what the
 * redirect says.
 */
export function purchaseConversion(input: ConversionInput): PurchaseConversion | null {
  const { vercelEnv, conversionId, label, planId, transactionId } = input;
  if (vercelEnv !== "production") return null;
  if (!conversionId || !label || !planId || !transactionId) return null;

  const cents = purchaseValueCents(planId, input.offers, input.packs);
  if (cents === null || cents <= 0) return null;

  return {
    sendTo: `${conversionId}/${label}`,
    value: cents / 100,
    currency: "USD",
    transactionId,
  };
}
