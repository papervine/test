import { notFound } from "next/navigation";
import { getMemberRole, getSession, listOrganizations } from "@/lib/session";
import { canSeeFeature, type FeatureKey } from "@/lib/features";

// Real access control for the Automate section (SPEC §10.2) — the AppRail hides the nav
// links, but that's cosmetic; this 404s the URLs for anyone who can't see them. The
// section is reachable if the viewer can see at least one of its features, so flipping a
// single feature to "everyone" in src/lib/features.ts opens the section without touching
// this file. (Per-page divergence — one surface public while another stays admin — would
// add the matching gate to that page.)
const AUTOMATE_FEATURES: FeatureKey[] = [
  "automate.workflows",
  "automate.agent",
  "automate.assistant",
];

export default async function AutomateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) notFound();

  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0] ?? null;
  const role = activeOrg
    ? await getMemberRole(activeOrg.id, session.user.id)
    : null;

  if (!AUTOMATE_FEATURES.some((f) => canSeeFeature(f, role))) notFound();

  return <>{children}</>;
}
