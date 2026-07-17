import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/dashboard-context";
import { settingsHref } from "@/lib/settings-nav";
import { connectHref } from "@/lib/dashboard-nav";

// Billing moved into site Settings (SPEC §10 Billing) — `/:org/:site/settings/billing`
// (plan) + `.../settings/usage` (credits). This org-level path is kept as a stable
// redirect so old bookmarks AND the Stripe return URLs (billing actions still build
// `${base}/:org/billing`, org-level being the right scope for an org-level subscription)
// always resolve to the real surface. Redirects to the first site's Billing; an org with
// no site yet goes to Connect (nothing to bill against until a site exists — the trial is
// already active regardless). This is a genuine app-host route, so a server redirect() is
// fine (nothing to Host-rewrite here — the target is another app-host path).
export default async function OrgBillingRedirect({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { sites } = await requireOrg(orgSlug);
  const first = sites[0];
  redirect(
    first ? settingsHref(orgSlug, first.slug, "billing") : connectHref(orgSlug),
  );
}
