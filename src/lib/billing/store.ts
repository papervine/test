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
import { creditRateVersion, usageEvent } from "@/lib/db/app-schema";
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
  return lookupOrg(organizationId);
}

/** Gate an AI request. `metered:false` means "let it run but don't try to debit"
 *  (platform docs, DB error, or a Free-plan feature that happens to be ungated). */
export async function authorizeAi(
  organizationId: string,
  feature: AiFeature,
): Promise<AiAuthorization> {
  const lookup = await getBillingLookup(organizationId);
  return authorizeAiDecision(lookup, feature, new Date());
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
