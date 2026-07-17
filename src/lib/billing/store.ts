// Effectful billing layer — the thin executor around the pure core (billing/core.ts).
// Reads/writes the billing tables; every entry point is defensive the same way
// track.ts is: BILLING MUST NEVER BREAK THE PRODUCT SURFACE IT METERS. Lookups
// distinguish "no billing row" (gate to Free) from "DB error" (fail open, warn) —
// see BillingLookup in core.ts.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  billingPlanVersion,
  billingSubscription,
  creditBalance,
  creditLedger,
  creditRateVersion,
  usageEvent,
} from "@/lib/db/app-schema";
import { CATALOG, type CreditRateTable, type PlanEntitlements } from "./catalog";
import {
  authorizeAiDecision,
  planDebits,
  rateTokensToCredits,
  trialEndDate,
  type AiAuthorization,
  type BillingLookup,
  type BucketKey,
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

async function latestPlanVersionId(planKey: string): Promise<string | null> {
  const [row] = await db
    .select({ id: billingPlanVersion.id })
    .from(billingPlanVersion)
    .where(eq(billingPlanVersion.planKey, planKey))
    .orderBy(desc(billingPlanVersion.version))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Start the 30-day all-features trial for a new org (SPEC §10 Billing lifecycle).
 * Called from the afterCreateOrganization auth hook. Idempotent (PK conflict = already
 * started) and non-fatal: if the catalog was never synced or the DB write fails, the
 * org simply resolves to Free until support intervenes — org creation is never blocked.
 */
export async function startTrial(organizationId: string): Promise<void> {
  try {
    const planVersionId = await latestPlanVersionId(CATALOG.trial.planKey);
    if (!planVersionId) {
      console.warn("[billing] no trial plan version in DB (run billing:sync) — org starts on Free");
      return;
    }
    const now = new Date();
    const endsAt = trialEndDate(now);
    const inserted = await db
      .insert(billingSubscription)
      .values({
        organizationId,
        planVersionId,
        status: "trialing",
        trialEndsAt: endsAt,
      })
      .onConflictDoNothing()
      .returning({ organizationId: billingSubscription.organizationId });
    if (inserted.length === 0) return; // already started (hook re-fire / race)
    await db.insert(creditLedger).values({
      id: randomUUID(),
      organizationId,
      delta: CATALOG.trial.credits,
      kind: "grant_trial",
      bucket: "trial",
      expiresAt: endsAt,
      reason: "30-day trial grant",
    });
    await db
      .insert(creditBalance)
      .values({ organizationId, trialCredits: CATALOG.trial.credits })
      .onConflictDoUpdate({
        target: creditBalance.organizationId,
        set: { trialCredits: CATALOG.trial.credits, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn("[billing] startTrial failed (org will resolve to Free):", err);
  }
}

/** One read joining subscription + pinned plan version + balance into the pure core's
 *  lookup shape. 'none' = org has no billing row (Free); 'error' = DB trouble (fail open). */
export async function getBillingLookup(organizationId: string): Promise<BillingLookup> {
  try {
    const [row] = await db
      .select({
        status: billingSubscription.status,
        trialEndsAt: billingSubscription.trialEndsAt,
        overageEnabled: billingSubscription.overageEnabled,
        entitlements: billingPlanVersion.entitlements,
      })
      .from(billingSubscription)
      .innerJoin(
        billingPlanVersion,
        eq(billingSubscription.planVersionId, billingPlanVersion.id),
      )
      .where(eq(billingSubscription.organizationId, organizationId))
      .limit(1);
    if (!row) return { state: "none" };
    const [bal] = await db
      .select()
      .from(creditBalance)
      .where(eq(creditBalance.organizationId, organizationId))
      .limit(1);
    return {
      state: "ok",
      sub: {
        status: row.status as "trialing" | "active" | "past_due" | "canceled",
        trialEndsAt: row.trialEndsAt,
        entitlements: row.entitlements as PlanEntitlements,
      },
      buckets: {
        trial: bal?.trialCredits ?? 0,
        monthly: bal?.monthlyCredits ?? 0,
        pack: bal?.packCredits ?? 0,
      },
      overageEnabled: row.overageEnabled,
    };
  } catch (err) {
    console.warn("[billing] lookup failed — failing open:", err);
    return { state: "error" };
  }
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

    const lookup = await getBillingLookup(input.organizationId);
    if (lookup.state !== "ok") return; // unmetered org (error already warned)
    const plan = planDebits(lookup.buckets, credits, {
      overageEnabled: lookup.overageEnabled,
    });
    // Even a hard-cap "refusal" here debits nothing but the answer already streamed
    // (pre-check raced a drain) — we absorb it; the next pre-check refuses cleanly.
    if (!plan.allowed || plan.debits.length === 0) return;

    const balanceColumn: Record<BucketKey, "trialCredits" | "monthlyCredits" | "packCredits"> = {
      trial: "trialCredits",
      monthly: "monthlyCredits",
      pack: "packCredits",
    };
    await db.insert(creditLedger).values(
      plan.debits.map((d) => ({
        id: randomUUID(),
        organizationId: input.organizationId,
        delta: -d.amount,
        kind: "usage",
        bucket: d.bucket,
        usageEventId,
      })),
    );
    for (const d of plan.debits) {
      const col = balanceColumn[d.bucket];
      await db
        .update(creditBalance)
        .set({
          [col]: sql`${creditBalance[col]} - ${d.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalance.organizationId, input.organizationId));
    }
  } catch (err) {
    console.warn("[billing] recordAiUsage failed (charge dropped):", err);
  }
}

/**
 * Trial-expiry sweep (cron; idempotent). Entitlement enforcement doesn't wait for this
 * — resolveEntitlements already treats a past-end trial as Free — so this is the
 * bookkeeping half: flip status, expire the unused trial credits into the ledger,
 * zero the trial bucket. Also finalizes lapsed NON-Stripe cancellations (seed /
 * support-granted plans that chose "downgrade to Free"): Stripe-backed subs get this
 * from the subscription.deleted webhook, but nothing upstream fires for a sub Stripe
 * never knew about, so the sweep is their period-end biller.
 */
export async function expireTrials(
  now = new Date(),
): Promise<{ expired: number; canceled: number }> {
  const rows = await db
    .select({
      organizationId: billingSubscription.organizationId,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.status, "trialing"),
        lt(billingSubscription.trialEndsAt, now),
      ),
    );
  for (const { organizationId } of rows) {
    const [bal] = await db
      .select()
      .from(creditBalance)
      .where(eq(creditBalance.organizationId, organizationId))
      .limit(1);
    const remaining = Math.max(0, bal?.trialCredits ?? 0);
    if (remaining > 0) {
      await db.insert(creditLedger).values({
        id: randomUUID(),
        organizationId,
        delta: -remaining,
        kind: "expiry",
        bucket: "trial",
        reason: "trial ended",
      });
    }
    await db
      .update(creditBalance)
      .set({ trialCredits: 0, updatedAt: now })
      .where(eq(creditBalance.organizationId, organizationId));
    await db
      .update(billingSubscription)
      .set({ status: "canceled", updatedAt: now })
      .where(eq(billingSubscription.organizationId, organizationId));
  }

  // Lapsed non-Stripe cancellations → canceled + expire the monthly bucket (the
  // webhook-path twin of handleSubscriptionDeleted).
  const lapsed = await db
    .select({ organizationId: billingSubscription.organizationId })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.status, "active"),
        eq(billingSubscription.cancelAtPeriodEnd, true),
        isNull(billingSubscription.stripeSubscriptionId),
        lt(billingSubscription.currentPeriodEnd, now),
      ),
    );
  for (const { organizationId } of lapsed) {
    const [bal] = await db
      .select()
      .from(creditBalance)
      .where(eq(creditBalance.organizationId, organizationId))
      .limit(1);
    const remainder = bal?.monthlyCredits ?? 0;
    if (remainder !== 0) {
      await db.insert(creditLedger).values({
        id: randomUUID(),
        organizationId,
        delta: -remainder,
        kind: "expiry",
        bucket: "monthly",
        reason: "plan canceled (period end)",
      });
      await db
        .update(creditBalance)
        .set({ monthlyCredits: 0, updatedAt: now })
        .where(eq(creditBalance.organizationId, organizationId));
    }
    await db
      .update(billingSubscription)
      .set({ status: "canceled", cancelAtPeriodEnd: false, updatedAt: now })
      .where(eq(billingSubscription.organizationId, organizationId));
  }
  return { expired: rows.length, canceled: lapsed.length };
}
