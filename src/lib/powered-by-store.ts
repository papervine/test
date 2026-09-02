import "server-only";
import { unstable_cache } from "next/cache";
import { lookupOrg } from "@/lib/billing/autumn";
import { showsPoweredByBadge } from "@/lib/powered-by";

/**
 * Does this organization's docs site carry the "Powered by Papervine" badge?
 *
 * This runs on the render path of every tenant docs page, which shapes all three decisions here:
 *
 *  1. **It survives a missing billing backend.** Single-repo mode (`PAPERVINE_CONTENT` — the CLI,
 *     the smoke gate) has no billing at all and returns false before any lookup; an unconfigured
 *     `AUTUMN_SECRET_KEY` resolves to Free without a network call. A throw here would 500 every
 *     docs page.
 *  2. **It fails toward HIDING.** Showing the badge on a paying Enterprise customer's
 *     white-labelled docs because of a transient outage is a customer-visible regression of the
 *     exact thing they bought; not showing it on a Free site for a minute costs nothing. The
 *     asymmetry is the whole reason the error branch returns false rather than true.
 *  3. **It's cached for a minute.** Otherwise every page view pays a round trip to Autumn for an
 *     answer that changes when someone upgrades — a handful of times ever. Now that the lookup
 *     leaves the building, this cache is load-bearing rather than a nicety: it is what keeps a
 *     third-party API off the critical path of rendering someone's docs. A minute is also short
 *     enough that "I paid and the badge is still there" resolves before anyone files it.
 */
const lookup = unstable_cache(
  async (organizationId: string): Promise<boolean> => {
    const billing = await lookupOrg(organizationId);

    // Rule 2. `lookupOrg` already swallowed and warned; "error" reaching here means we do not
    // know what this org bought, and the safe unknown is to hide.
    if (billing.state === "error") return false;

    // No billing state is the ordinary condition for a legacy org, not an error: it means Free,
    // and Free carries the badge.
    if (billing.state === "none") {
      return showsPoweredByBadge({ planKey: null, features: null });
    }

    // Autumn always answers with a complete flag set, so `whiteLabel` is a real boolean and
    // `showsPoweredByBadge`'s legacy planKey fallback never fires. It stays because the function
    // is shared and pure, not because this caller can reach it.
    return showsPoweredByBadge({
      planKey: null,
      features: billing.sub.entitlements.features,
    });
  },
  ["powered-by-badge"],
  { revalidate: 60 },
);

export async function showsPoweredBy(organizationId: string | null): Promise<boolean> {
  if (process.env.PAPERVINE_CONTENT) return false;
  if (!organizationId) return false;
  return lookup(organizationId);
}
