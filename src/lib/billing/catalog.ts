// Typed view over the billing catalog (catalog.json — the single editable config for
// plans/credits/prices/rates; see its $comment). This module validates the JSON at load
// so a bad edit fails typecheck/tests, not production checkout. Pure and DB-free on
// purpose: the render path's billing fallbacks (no-DB smoke constraint) import from here.
import rawCatalog from "./catalog.json";

// Feature gates a plan can switch. Core product surfaces (git sync, auth, custom domain,
// MCP, playground, editor, search, analytics) are deliberately NOT here — they are never
// plan-gated (the anti-incumbent wedge; _private/pricing-plan.md).
export type PlanFeatureKey =
  | "assistant"
  | "writerAgent"
  | "workflows"
  | "sso"
  | "rbac"
  | "previewDeployments"
  | "adminApis"
  | "insights"
  | "scim"
  // Not a capability but the absence of one: hides the "Powered by Papervine" badge on this
  // org's docs sites. An entitlement rather than a hardcoded plan check so moving it down a
  // tier is a catalog edit and a republish (see showsPoweredByBadge).
  | "whiteLabel";

export const PLAN_FEATURE_KEYS: readonly PlanFeatureKey[] = [
  "assistant",
  "writerAgent",
  "workflows",
  "sso",
  "rbac",
  "previewDeployments",
  "adminApis",
  "insights",
  "scim",
  "whiteLabel",
] as const;

// Scale limits. -1 = custom/unlimited (Enterprise).
export type PlanEntitlements = {
  sites: number;
  editors: number;
  analyticsRetentionDays: number;
  features: Record<PlanFeatureKey, boolean>;
};

export type PlanKey = "free" | "team" | "pro" | "enterprise" | "trial";

export type CatalogPlan = {
  key: PlanKey;
  name: string;
  blurb: string;
  // Shown on the pricing page / purchasable. `trial` is listed:false — it's a lifecycle
  // state every new org passes through, not a plan anyone picks.
  listed: boolean;
  sort: number;
  includedMonthlyCredits: number;
  // Retail overage in cents per 1,000 credits (800 = $0.008/credit). null = overage not
  // offered on this plan (Free has no purchase path; Enterprise negotiates).
  overageCentsPerThousandCredits: number | null;
  entitlements: PlanEntitlements;
};

export type CatalogPrice = {
  planKey: PlanKey;
  interval: "month" | "year";
  // For interval:"year" this is the per-YEAR amount (what Stripe charges), not the
  // advertised per-month figure — display math lives in the UI.
  unitAmountCents: number;
  currency: string;
};

export type CreditPack = {
  key: string;
  name: string;
  credits: number;
  priceCents: number;
};

// Credits per 1M tokens by model-id prefix (longest prefix wins), `default` fallback.
export type CreditRate = { inPer1M: number; outPer1M: number };
export type CreditRateTable = {
  version: number;
  default: CreditRate;
  models: Record<string, CreditRate>;
};

export type BillingCatalog = {
  // `representsPlanKey` = the listed tier the trial's all-features grant is equivalent
  // to (Pro). The billing UI badges that tier's card "Trialing until <date>" so a
  // trialing user sees which plan they're sampling.
  trial: {
    days: number;
    credits: number;
    planKey: PlanKey;
    representsPlanKey: PlanKey;
  };
  plans: CatalogPlan[];
  prices: CatalogPrice[];
  creditPacks: CreditPack[];
  creditRates: CreditRateTable;
};

// --- validation (no zod dependency here: the shape is small and the errors should name
// the catalog file, since a human just edited it) ---

function fail(msg: string): never {
  throw new Error(`billing/catalog.json invalid: ${msg}`);
}

function isPosInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

export function parseCatalog(raw: unknown): BillingCatalog {
  const c = raw as BillingCatalog;
  if (!c || !Array.isArray(c.plans) || c.plans.length === 0) fail("no plans");
  const keys = new Set<string>();
  for (const p of c.plans) {
    if (!p.key) fail("plan missing key");
    if (keys.has(p.key)) fail(`duplicate plan key ${p.key}`);
    keys.add(p.key);
    if (!isPosInt(p.includedMonthlyCredits))
      fail(`${p.key}: includedMonthlyCredits must be a non-negative integer`);
    if (
      p.overageCentsPerThousandCredits !== null &&
      !isPosInt(p.overageCentsPerThousandCredits)
    )
      fail(`${p.key}: overageCentsPerThousandCredits must be null or a non-negative integer`);
    const e = p.entitlements;
    if (!e || typeof e !== "object") fail(`${p.key}: missing entitlements`);
    for (const dim of ["sites", "editors", "analyticsRetentionDays"] as const) {
      const v = e[dim];
      if (!(isPosInt(v) || v === -1)) fail(`${p.key}: entitlements.${dim} must be int >= 0 or -1`);
    }
    for (const f of PLAN_FEATURE_KEYS) {
      if (typeof e.features?.[f] !== "boolean")
        fail(`${p.key}: entitlements.features.${f} must be boolean`);
    }
  }
  for (const k of ["free", "team", "pro", "enterprise", "trial"]) {
    if (!keys.has(k)) fail(`missing required plan ${k}`);
  }
  if (!c.trial || !isPosInt(c.trial.days) || !isPosInt(c.trial.credits))
    fail("trial.days/credits must be non-negative integers");
  if (!keys.has(c.trial.planKey)) fail(`trial.planKey ${c.trial.planKey} not a plan`);
  if (!keys.has(c.trial.representsPlanKey))
    fail(`trial.representsPlanKey ${c.trial.representsPlanKey} not a plan`);
  for (const pr of c.prices ?? []) {
    if (!keys.has(pr.planKey)) fail(`price for unknown plan ${pr.planKey}`);
    if (pr.interval !== "month" && pr.interval !== "year")
      fail(`price interval must be month|year`);
    if (!isPosInt(pr.unitAmountCents) || pr.unitAmountCents === 0)
      fail(`price for ${pr.planKey}/${pr.interval}: unitAmountCents must be a positive integer`);
  }
  const packKeys = new Set<string>();
  for (const pk of c.creditPacks ?? []) {
    if (!pk.key || packKeys.has(pk.key)) fail(`credit pack key missing/duplicate`);
    packKeys.add(pk.key);
    if (!isPosInt(pk.credits) || pk.credits === 0) fail(`${pk.key}: credits must be positive`);
    if (!isPosInt(pk.priceCents) || pk.priceCents === 0)
      fail(`${pk.key}: priceCents must be positive`);
  }
  const r = c.creditRates;
  if (!r || !isPosInt(r.version) || r.version === 0) fail("creditRates.version must be >= 1");
  const rateOk = (x: CreditRate | undefined) =>
    x && isPosInt(x.inPer1M) && isPosInt(x.outPer1M);
  if (!rateOk(r.default)) fail("creditRates.default missing/invalid");
  for (const [model, rate] of Object.entries(r.models ?? {})) {
    if (!rateOk(rate)) fail(`creditRates.models['${model}'] invalid`);
  }
  return c;
}

// Validated at module load: an invalid catalog should fail fast everywhere (typecheck
// can't see into JSON values; this can).
export const CATALOG: BillingCatalog = parseCatalog(rawCatalog);

export function catalogPlan(key: PlanKey): CatalogPlan {
  const plan = CATALOG.plans.find((p) => p.key === key);
  if (!plan) throw new Error(`billing catalog missing plan ${key}`); // unreachable post-parse
  return plan;
}

// The DB-free fallback: when no database is reachable (single-repo mode, smoke tests) or
// an org predates billing, entitlement checks resolve against Free. Never throw from a
// missing billing row — that's the "never let billing 500 a docs page" rule.
export const FREE_ENTITLEMENTS: PlanEntitlements = catalogPlan("free").entitlements;
