import "server-only";
import { unstable_cache } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { billingPlanVersion, billingSubscription } from "@/lib/db/app-schema";
import type { PlanEntitlements, PlanKey } from "@/lib/billing/catalog";
import { showsPoweredByBadge } from "@/lib/powered-by";

/**
 * Does this organization's docs site carry the "Powered by Papervine" badge?
 *
 * This runs on the render path of every tenant docs page, which shapes all three decisions here:
 *
 *  1. **It survives a missing database.** Single-repo mode (`PAPERVINE_CONTENT` — the CLI, the
 *     smoke gate) has no billing at all and returns false before touching the client, the same
 *     short-circuit `getSiteBySlug` makes. A throw here would 500 every docs page.
 *  2. **It fails toward HIDING.** Showing the badge on a paying Enterprise customer's
 *     white-labelled docs because of a transient DB error is a customer-visible regression of
 *     the exact thing they bought; not showing it on a Free site for a minute costs nothing.
 *     The asymmetry is the whole reason the error branch returns false rather than true.
 *  3. **It's cached for a minute.** Otherwise every page view pays two queries for an answer
 *     that changes when someone upgrades — a handful of times ever. A minute is also short
 *     enough that "I paid and the badge is still there" resolves before anyone files it.
 */
const lookup = unstable_cache(
  async (organizationId: string): Promise<boolean> => {
    try {
      const [row] = await db
        .select({
          planKey: billingPlanVersion.planKey,
          entitlements: billingPlanVersion.entitlements,
        })
        .from(billingSubscription)
        .innerJoin(
          billingPlanVersion,
          eq(billingSubscription.planVersionId, billingPlanVersion.id),
        )
        .where(eq(billingSubscription.organizationId, organizationId))
        .limit(1);

      // No billing row is the ordinary state for a legacy org, not an error: it means Free,
      // and Free carries the badge.
      if (!row) return showsPoweredByBadge({ planKey: null, features: null });

      const entitlements = row.entitlements as PlanEntitlements;
      return showsPoweredByBadge({
        planKey: row.planKey as PlanKey,
        features: entitlements?.features ?? null,
      });
    } catch (err) {
      console.warn("[powered-by] lookup failed — hiding the badge:", err);
      return false;
    }
  },
  ["powered-by-badge"],
  { revalidate: 60 },
);

export async function showsPoweredBy(organizationId: string | null): Promise<boolean> {
  if (process.env.PAPERVINE_CONTENT) return false;
  if (!organizationId) return false;
  return lookup(organizationId);
}
