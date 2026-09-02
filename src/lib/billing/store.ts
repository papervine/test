// Effectful billing layer — the thin executor around the pure core (billing/core.ts) and
// the Autumn adapter (billing/autumn.ts). Every entry point is defensive the same way
// track.ts is: BILLING MUST NEVER BREAK THE PRODUCT SURFACE IT METERS.
//
// What is left here after Autumn took the catalog is the part that is genuinely ours: the
// AI gate, and the rating + usage record behind it. Autumn holds the balance; `usage_event`
// holds which feature spent it, which is what the usage chart reads and what calibrates
// the credit rates.
import "server-only";
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { creditRateVersion, usageEvent } from "@/lib/db/app-schema";
import { unlockDecision, type UnlockableSurface, type UnlockDecision } from "./unlock";
import { type CreditRateTable } from "./catalog";
import {
  attachPlan,
  autumnConfigured,
  ensureCustomer,
  lookupOrg,
  trackCredits,
  TRIAL_PLAN_ID,
} from "./autumn";
import {
  authorizeAiDecision,
  rateTokensToCredits,
  type AiAuthorization,
  type BillingLookup,
  type PlanFeatureKey,
  reviveBillingLookup,
} from "./core";

export type { AiAuthorization } from "./core";

// Re-exported so callers (routes) name features off one type.
export type AiFeature = Extract<PlanFeatureKey, "assistant" | "writerAgent" | "workflows">;

// Buyer-facing operation recorded on usage_event rows, keyed by gate feature.
const USAGE_FEATURE: Record<AiFeature, string> = {
  assistant: "assistant",
  writerAgent: "writer",
  workflows: "workflow",
};

/**
 * Start the 30-day Pro trial for a new org (SPEC §10 Billing lifecycle). Called from the
 * afterCreateOrganization auth hook. Two steps in Autumn: create the customer (which
 * auto-enables Free, so the org has a floor even if the second step fails) then attach the
 * limited-time `pro_trial` plan, which expires on its own and drops them back to Free.
 *
 * Idempotent and non-fatal, exactly as before: with no billing backend, or on any failure,
 * the org simply resolves to Free. Creating an organization is never blocked by billing.
 */
export async function startTrial(
  organizationId: string,
  identity: { name?: string | null; email?: string | null } = {},
): Promise<void> {
  if (!autumnConfigured()) return;
  // Name and email are what make the customer findable in Autumn's dashboard (customers are
  // keyed by our opaque org id). A record created without them is a bare id — which is how
  // the first GitHub-signup org arrived, and why the hook now passes them.
  const created = await ensureCustomer({ organizationId, ...identity });
  if (!created) return; // already warned
  await attachPlan({ organizationId, planId: TRIAL_PLAN_ID });
}

/** One read into the pure core's lookup shape. Autumn is the source of truth (SPEC §10);
 *  'none' = no billing state (Free), 'error' = backend trouble (fail open). The mapping and
 *  every defensive branch live in ./autumn — this stays a one-liner so the seam is obvious. */
export async function getBillingLookup(organizationId: string): Promise<BillingLookup> {
  return cachedLookup(organizationId);
}

/** The cache tag the Autumn webhook revalidates when an org's plan or balances change. */
export function billingCacheTag(organizationId: string): string {
  return `billing:${organizationId}`;
}

// Dashboard reads are cached for a minute per org and dropped the instant Autumn tells us
// something changed (the webhook revalidates the tag). Two layers on purpose: React's request
// cache dedupes the layout's read and the page's read within one render — the unlock gate
// added a second call per page, and this folds it back to one — and Next's data cache spans
// requests. A failed lookup is NOT cached (it throws out of the cached function and is caught
// here), so an outage clears with the next request rather than sticking for a minute. The AI
// gate (`authorizeAi`) deliberately does not use this: that is an authorization on a metered
// call, and a stale "allowed" is money.
const STALE_LOOKUP_ERROR = "__billing_lookup_error__";
const cachedLookup = cache(async (organizationId: string): Promise<BillingLookup> => {
  const read = unstable_cache(
    async () => {
      const lookup = await lookupOrg(organizationId);
      if (lookup.state === "error") throw new Error(STALE_LOOKUP_ERROR);
      return lookup;
    },
    ["billing-lookup", organizationId],
    { revalidate: 60, tags: [billingCacheTag(organizationId)] },
  );
  try {
    // The cache hands back JSON, so the Date inside is a string on a hit (but a Date on the
    // miss that populated it) — normalise both ways. This bit on the first render: the org
    // layout's `trialStatus` calls `trialEndsAt.getTime()`.
    return reviveBillingLookup(await read());
  } catch (err) {
    if (err instanceof Error && err.message === STALE_LOOKUP_ERROR) return { state: "error" };
    throw err;
  }
});

/** Gate an AI request. `metered:false` means "let it run but don't try to debit"
 *  (platform docs, DB error, or a Free-plan feature that happens to be ungated). */
export async function authorizeAi(
  organizationId: string,
  feature: AiFeature,
): Promise<AiAuthorization> {
  // Live, never cached — see cachedLookup for why. `configured` is threaded through the
  // same way getUnlock does it, so the gate and the dashboard's lock agree about an
  // install with no billing backend (see authorizeAiDecision); skipping the lookup when
  // there's nothing to look up also spares a pointless round trip.
  const configured = autumnConfigured();
  const lookup = configured ? await lookupOrg(organizationId) : { state: "none" as const };
  return authorizeAiDecision(lookup, feature, new Date(), configured);
}

/** Human-facing refusal messages, shared by every AI route so copy can't drift. */
export function aiRefusalResponse(code: "upgrade_required" | "out_of_credits"): Response {
  const message =
    code === "upgrade_required"
      ? "AI features aren't included in this site's current plan."
      : "This organization is out of AI credits for the period.";
  return Response.json({ error: message, code }, { status: 402 });
}

export type AiUsageInput = {
  organizationId: string;
  siteId?: string | null;
  feature: AiFeature;
  model: string;
  tokensIn: number;
  tokensOut: number;
  requestId?: string | null;
};

/**
 * Meter one finished AI operation: rate tokens -> credits (latest published rate
 * table), record the usage event, debit buckets in consumption order, update the
 * balance cache. Fire-and-forget from stream callbacks — a metering failure warns and
 * drops the charge (we absorb the cost) rather than surfacing an error post-answer.
 * Concurrency note: the balance read/debit isn't serialized, so two simultaneous
 * answers can overshoot a bucket slightly; the ledger stays truthful and the next
 * pre-check sees the negative balance — acceptable v1 drift, revisit with SELECT FOR
 * UPDATE if packs make precision matter.
 */
export async function recordAiUsage(input: AiUsageInput): Promise<void> {
  try {
    const [rate] = await db
      .select()
      .from(creditRateVersion)
      .orderBy(desc(creditRateVersion.version))
      .limit(1);
    // No published rate table -> no basis to charge; log the tokens anyway (rateVersion
    // 0 marks "unrated") so calibration data still accumulates.
    const table = (rate?.rates ?? null) as CreditRateTable | null;
    const credits = table
      ? rateTokensToCredits(
          { tokensIn: input.tokensIn, tokensOut: input.tokensOut, model: input.model },
          table,
        )
      : 0;

    const usageEventId = randomUUID();
    await db.insert(usageEvent).values({
      id: usageEventId,
      organizationId: input.organizationId,
      siteId: input.siteId ?? null,
      feature: USAGE_FEATURE[input.feature],
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      credits,
      rateVersion: rate?.version ?? 0,
      requestId: input.requestId ?? null,
    });
    if (credits === 0) return;

    // Autumn owns the balance and the bucket ordering; we own the rating and the story of
    // WHICH feature spent the credit (usage_event above, which backs the usage chart).
    await trackCredits({
      organizationId: input.organizationId,
      credits,
      feature: USAGE_FEATURE[input.feature],
      siteId: input.siteId ?? null,
      model: input.model,
    });
  } catch (err) {
    console.warn("[billing] recordAiUsage failed (charge dropped):", err);
  }
}

/**
 * Should a plan-gated dashboard surface show its unlock state instead of its controls?
 * The rule lives in ./unlock (pure, unit-tested); this just feeds it the two facts only the
 * server knows: whether a billing backend is configured at all, and the org's lookup.
 */
export async function getUnlock(
  organizationId: string,
  surface: UnlockableSurface,
): Promise<UnlockDecision> {
  const configured = autumnConfigured();
  const lookup = configured ? await getBillingLookup(organizationId) : { state: "none" as const };
  return unlockDecision({ configured, lookup, surface, now: new Date() });
}
