"use server";

import { revalidatePath } from "next/cache";
import { siteRoute } from "@/lib/dashboard-nav";
import { findSite, type SiteRow } from "@/lib/dashboard-context";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";
import {
  checkoutBranch,
  saveDraft,
  publishDraft,
  discardSession,
  resolvePagePath,
  type PublishResult,
} from "@/lib/authoring-core";

// Server-action front-end to the authoring backend — the human editor's write path. The
// editing agent / authoring MCP call the SAME authoring-core functions (Phase 4), so both
// edit one draft buffer. Auth + the editor feature gate happen here at the edge; core
// assumes an already-authorized SiteRow.

type Gate = { site: SiteRow; userId: string } | { error: string };

// Resolve + authorize the site for an editor action, enforcing the editor feature gate
// (defense-in-depth — the route layout gates the URL, this gates the mutation).
async function gateEditor(orgSlug: string, siteSlug: string): Promise<Gate> {
  const session = await getSession();
  if (!session) return { error: "You're signed out." };
  const org = (await listOrganizations())?.find((o) => o.slug === orgSlug);
  if (!org) return { error: "Organization not found." };
  const role = await getMemberRole(org.id, session.user.id);
  if (!canSeeFeature("editor.workspace", role)) return { error: "The editor isn't enabled for your role." };
  const site = await findSite(orgSlug, siteSlug);
  if (!site) return { error: "Site not found." };
  return { site, userId: session.user.id };
}

export async function checkoutBranchAction(
  orgSlug: string,
  siteSlug: string,
  branchName?: string,
): Promise<{ branch: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const { branch } = await checkoutBranch(gate.site, { actorUserId: gate.userId, branchName });
  revalidatePath(siteRoute(orgSlug, siteSlug, "editor"));
  return { branch };
}

/** Load a page's current draft-aware MDX + its repo-relative path, for the editor pane. */
export async function readDraftPageAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  slug: string,
): Promise<{ path: string; markdown: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const { path, raw } = await resolvePagePath(gate.site, branch, slug);
  return { path, markdown: raw ?? "" };
}

export async function saveDraftAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  path: string,
  content: string,
  deleted = false,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  await saveDraft(gate.site, branch, path, content, { deleted, actorUserId: gate.userId });
  return { ok: true };
}

export async function publishDraftAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  mode: "commit" | "pr",
  message?: string,
): Promise<PublishResult> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return { ok: false, error: gate.error };
  const result = await publishDraft(gate.site, branch, { mode, message, actorUserId: gate.userId });
  if (result.ok) revalidatePath(siteRoute(orgSlug, siteSlug));
  return result;
}

export async function discardSessionAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
): Promise<{ ok: boolean } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const result = await discardSession(gate.site, branch);
  revalidatePath(siteRoute(orgSlug, siteSlug, "editor"));
  return result;
}
