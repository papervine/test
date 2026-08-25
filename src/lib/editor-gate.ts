import "server-only";
import { findSite, type SiteRow } from "@/lib/dashboard-context";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";

// The editor's authorization edge, shared by every server-action front-end to the authoring
// backend (actions/authoring.ts, actions/media.ts) and by the draft-asset route.
//
// Deliberately NOT exported from a "use server" module: everything a `"use server"` file exports
// becomes a callable endpoint, and this returns a whole SiteRow. Keeping it in a plain server-only
// module means both action files can share one gate without publishing it as an action.

export type Gate = { site: SiteRow; userId: string; userName: string } | { error: string };

/**
 * Resolve + authorize the site for an editor action, enforcing the editor feature gate
 * (defense-in-depth — the route layout gates the URL, this gates the mutation).
 */
export async function gateEditor(orgSlug: string, siteSlug: string): Promise<Gate> {
  const session = await getSession();
  if (!session) return { error: "You're signed out." };
  const org = (await listOrganizations())?.find((o) => o.slug === orgSlug);
  if (!org) return { error: "Organization not found." };
  const role = await getMemberRole(org.id, session.user.id);
  if (!canSeeFeature("editor.workspace", role)) return { error: "The editor isn't enabled for your role." };
  const site = await findSite(orgSlug, siteSlug);
  if (!site) return { error: "Site not found." };
  return { site, userId: session.user.id, userName: session.user.name ?? "Editor" };
}
