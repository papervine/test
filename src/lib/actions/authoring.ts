"use server";

import matter from "gray-matter";
import { revalidatePath } from "next/cache";
import { siteRoute } from "@/lib/dashboard-nav";
import { findSite, type SiteRow } from "@/lib/dashboard-context";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";
import { mintCollabToken } from "@/lib/collab-token";
import {
  checkoutBranch,
  saveDraft,
  publishDraft,
  discardSession,
  resolvePagePath,
  resolveBasePage,
  resolveDraftFile,
  listSessionChanges,
  revertDraftFile,
  type PublishResult,
  type SessionChange,
} from "@/lib/authoring-core";
import { isPagePath, pathToSlug } from "@/lib/draft-source";

// Frontmatter keys the Page settings panel manages (docs.json-compatible). Booleans are only
// written when true; strings/arrays only when non-empty — keeping frontmatter clean.
type PageMeta = Record<string, unknown>;

function cleanMeta(data: PageMeta): PageMeta {
  const out: PageMeta = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === "" || v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Recursively find a docs.json navigation group object by its `group` name (returns the live
// reference so the caller can mutate it in place).
function findGroupNode(node: unknown, name: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findGroupNode(child, name);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.group === name) return obj;
    for (const value of Object.values(obj)) {
      const found = findGroupNode(value, name);
      if (found) return found;
    }
  }
  return null;
}

// Server-action front-end to the authoring backend — the human editor's write path. The
// editing agent / authoring MCP call the SAME authoring-core functions (Phase 4), so both
// edit one draft buffer. Auth + the editor feature gate happen here at the edge; core
// assumes an already-authorized SiteRow.

type Gate = { site: SiteRow; userId: string; userName: string } | { error: string };

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
  return { site, userId: session.user.id, userName: session.user.name ?? "Editor" };
}

/**
 * Mint a short-lived token for the collaborative editing socket (apps/collab). Runs the full
 * editor gate, then binds the token to exactly one room (`${siteId}:${branch}:${path}`) so the
 * socket service — which can't see the session — authorizes purely on the signed room claim.
 * Returns `{ disabled: true }` when collab isn't configured (no secret): the client then falls
 * back to same-browser BroadcastChannel sync, never an error.
 */
export async function mintCollabTokenAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  path: string,
): Promise<{ token: string; room: string } | { disabled: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const room = `${gate.site.id}:${branch}:${path}`;
  const token = await mintCollabToken({ room, userId: gate.userId, name: gate.userName });
  if (!token) return { disabled: true };
  return { token, room };
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

/** Load a page's published (base) MDX — for the editor's diff view (draft vs live). */
export async function readBasePageAction(
  orgSlug: string,
  siteSlug: string,
  slug: string,
): Promise<{ markdown: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const { raw } = await resolveBasePage(gate.site, slug);
  return { markdown: raw ?? "" };
}

/** Read a page's frontmatter (for the Page settings panel). */
export async function readPageMetaAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  slug: string,
): Promise<{ path: string; data: PageMeta } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const { path, raw } = await resolvePagePath(gate.site, branch, slug);
  return { path, data: matter(raw ?? "").data as PageMeta };
}

/** Write a page's frontmatter (Page settings), preserving the body. */
export async function savePageMetaAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  slug: string,
  data: PageMeta,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const { path, raw } = await resolvePagePath(gate.site, branch, slug);
  const parsed = matter(raw ?? "");
  const clean = cleanMeta(data);
  const next = Object.keys(clean).length ? matter.stringify(parsed.content, clean) : parsed.content;
  await saveDraft(gate.site, branch, path, next, { actorUserId: gate.userId });
  return { ok: true };
}

/** Delete a page (tombstone in the draft; publish carries the removal to git). */
export async function deletePageAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  slug: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const { path } = await resolvePagePath(gate.site, branch, slug);
  await saveDraft(gate.site, branch, path, "", { deleted: true, actorUserId: gate.userId });
  return { ok: true };
}

/** Read a docs.json navigation group's settings (for the Group settings panel). */
export async function readGroupSettingsAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  group: string,
): Promise<{ settings: PageMeta } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const raw = await resolveDraftFile(gate.site, branch, "docs.json");
  try {
    const config = JSON.parse(raw ?? "{}");
    const node = findGroupNode(config.navigation ?? config, group);
    return { settings: (node as PageMeta) ?? {} };
  } catch {
    return { settings: {} };
  }
}

// Remove a navigation group (by `group` name) from its containing array in docs.json.
function removeGroupNode(node: unknown, name: string): boolean {
  if (Array.isArray(node)) {
    const i = node.findIndex((c) => c && typeof c === "object" && (c as Record<string, unknown>).group === name);
    if (i >= 0) {
      node.splice(i, 1);
      return true;
    }
    return node.some((c) => removeGroupNode(c, name));
  }
  if (node && typeof node === "object") {
    return Object.values(node).some((v) => removeGroupNode(v, name));
  }
  return false;
}

/** Delete a docs.json navigation group. */
export async function deleteGroupAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  group: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const raw = await resolveDraftFile(gate.site, branch, "docs.json");
  let config: unknown;
  try {
    config = JSON.parse(raw ?? "{}");
  } catch {
    return { error: "docs.json isn't valid JSON." };
  }
  if (!removeGroupNode((config as Record<string, unknown>).navigation ?? config, group)) {
    return { error: "Group not found in docs.json." };
  }
  await saveDraft(gate.site, branch, "docs.json", JSON.stringify(config, null, 2) + "\n", {
    actorUserId: gate.userId,
  });
  return { ok: true };
}

/** Patch a docs.json navigation group in place (Group settings). `patch.group` renames it. */
export async function saveGroupSettingsAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  group: string,
  patch: PageMeta,
): Promise<{ ok: true; group: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const raw = await resolveDraftFile(gate.site, branch, "docs.json");
  let config: unknown;
  try {
    config = JSON.parse(raw ?? "{}");
  } catch {
    return { error: "docs.json isn't valid JSON." };
  }
  const node = findGroupNode((config as Record<string, unknown>).navigation ?? config, group);
  if (!node) return { error: "Group not found in docs.json." };
  for (const [key, value] of Object.entries(patch)) {
    if (value === "" || value === null || value === undefined || value === false) delete node[key];
    else node[key] = value;
  }
  await saveDraft(gate.site, branch, "docs.json", JSON.stringify(config, null, 2) + "\n", {
    actorUserId: gate.userId,
  });
  return { ok: true, group: (patch.group as string) || group };
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

// Mirrors packages/renderer/lib/nav.ts's private titleFromSlug — not exported there (a
// renderer internal), so duplicated here for this one display-only fallback rather than
// widening that package's public surface for a single caller.
function titleFromSlug(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type SessionChangeRow = { path: string; status: SessionChange["status"]; title: string };

/** The Publish panel's "N file changes" list — every draft in the session, with a
 *  display title (frontmatter title/sidebarTitle, falling back to the slug) and its
 *  added/modified/deleted status against the published content. */
export async function listSessionChangesAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
): Promise<SessionChangeRow[] | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const changes = await listSessionChanges(gate.site, branch);
  return changes.map((c) => {
    if (!isPagePath(c.path)) return { path: c.path, status: c.status, title: c.path };
    const fm = c.content ? (matter(c.content).data as PageMeta) : {};
    const title = (fm.sidebarTitle as string) || (fm.title as string) || titleFromSlug(pathToSlug(c.path));
    return { path: c.path, status: c.status, title };
  });
}

/** Revert one file's draft (Publish panel's per-file revert icon). */
export async function revertFileAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  path: string,
): Promise<{ ok: boolean } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const result = await revertDraftFile(gate.site, branch, path);
  revalidatePath(siteRoute(orgSlug, siteSlug, "editor"));
  return result;
}
