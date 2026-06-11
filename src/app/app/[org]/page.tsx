import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/dashboard-context";
import { siteBase, connectHref } from "@/lib/dashboard-nav";

// Bare /:org has no UI — it forwards to the org's first site (oldest), or the connect
// form when the org has no site yet. requireOrg does the auth/membership gate.
export default async function OrgEntry({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { sites } = await requireOrg(orgSlug);
  const first = sites[0];
  redirect(first ? siteBase(orgSlug, first.slug) : connectHref(orgSlug));
}
