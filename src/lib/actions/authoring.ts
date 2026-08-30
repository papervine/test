"use server";

import matter from "gray-matter";
import { revalidatePath } from "next/cache";
import { getPageVersionContent, listPageVersions } from "@/lib/page-history-store";
import { upsertDraftFile } from "@/lib/draft-store";
import { siteRoute } from "@/lib/dashboard-nav";
import { gateEditor } from "@/lib/editor-gate";
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
import type { PublishMode } from "@/lib/publish-mode";
import { isPagePath, pathToSlug } from "@/lib/draft-source";
import {
  addGroup,
  addPageToGroup,
  addTab,
  IMPLICIT_TAB_NAME,
  movePage,
  navPageSlugs,
  newPageContent,
  newPageSlug,
  reorderGroup,
} from "@/lib/nav-edit";

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

/**
 * The Version history panel's list, for one page (SPEC §10.11).
 *
 * PUBLISH-level history: one entry per publish that changed this page. Dates are returned as
 * epoch millis rather than Date objects — a server action's return value crosses the RSC
 * boundary, and grouping them by day is the client's job (`groupVersionsByDay`), against the
 * client's own clock.
 */
export async function listPageVersionsAction(
  orgSlug: string,
  siteSlug: string,
  path: string,
): Promise<{ versions: { id: string; at: number; authorName: string | null; isCurrent: boolean }[] } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const rows = await listPageVersions(gate.site.id, path);
  return {
    versions: rows.map((r) => ({
      id: r.id,
      at: r.publishedAt.getTime(),
      authorName: r.authorName,
      isCurrent: r.isCurrent,
    })),
  };
}

/** One version's MDX, for previewing it before restoring. */
export async function readPageVersionAction(
  orgSlug: string,
  siteSlug: string,
  versionId: string,
): Promise<{ markdown: string; at: number } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const found = await getPageVersionContent(gate.site.id, versionId);
  // Null is a real state for a Git-backed site whose token has expired or whose repo has been
  // disconnected — the row is ours, the bytes are theirs.
  if (!found) return { error: "That version's content could not be loaded." };
  return { markdown: found.content, at: found.publishedAt.getTime() };
}

/**
 * Restore a version — into the DRAFT, not straight to the live site.
 *
 * Deliberately not a publish. On a Git-backed site history can't be rewritten, so a "rollback"
 * would have to be a new commit anyway; making it a draft edit means the same thing happens on
 * both kinds of site, the author sees what they're about to ship, and Publish stays the one
 * action that changes what readers see.
 */
export async function restorePageVersionAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  path: string,
  versionId: string,
): Promise<{ markdown: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const found = await getPageVersionContent(gate.site.id, versionId);
  if (!found) return { error: "That version's content could not be loaded." };

  const session = await checkoutBranch(gate.site, { actorUserId: gate.userId, branchName: branch });
  await upsertDraftFile({ sessionId: session.sessionId, path, content: found.content });
  revalidatePath(siteRoute(orgSlug, siteSlug, "editor"));
  return { markdown: found.content };
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

// ── The nav tree's "+" menu: New page / Add existing page / New group ────────────────────
// Each is read docs.json → mutate via the pure helpers in nav-edit.ts → saveDraft, the same
// shape as saveGroupSettingsAction. Both the page file and the docs.json edit land in the SAME
// draft session, so an unpublished new page is a single reviewable/revertable unit.

/** Parse the draft's docs.json, or report why not. */
async function readDraftConfig(
  site: Parameters<typeof saveDraft>[0],
  branch: string,
): Promise<{ config: unknown } | { error: string }> {
  const raw = await resolveDraftFile(site, branch, "docs.json");
  try {
    return { config: JSON.parse(raw ?? "{}") };
  } catch {
    return { error: "docs.json isn't valid JSON." };
  }
}

const writeConfig = (
  site: Parameters<typeof saveDraft>[0],
  branch: string,
  config: unknown,
  userId: string,
) => saveDraft(site, branch, "docs.json", JSON.stringify(config, null, 2) + "\n", { actorUserId: userId });

/**
 * Create a page and list it in `group`. The slug is derived from the title and de-duplicated
 * against what the nav already references, so two "Overview" pages don't collide.
 */
export async function createPageAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  group: string,
  title: string,
): Promise<{ ok: true; slug: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const trimmed = title.trim();
  if (!trimmed) return { error: "Give the page a title." };

  const read = await readDraftConfig(gate.site, branch);
  if ("error" in read) return read;
  const slug = newPageSlug(trimmed, navPageSlugs(read.config));

  if (!addPageToGroup(read.config, group, slug)) {
    return { error: `Couldn't add the page to "${group}".` };
  }
  // Page first, then docs.json: a nav entry pointing at a file that doesn't exist yet is the
  // one ordering that renders broken (the same reason native publish writes pages before config).
  const { path } = await resolvePagePath(gate.site, branch, slug);
  await saveDraft(gate.site, branch, path, newPageContent(trimmed), { actorUserId: gate.userId });
  await writeConfig(gate.site, branch, read.config, gate.userId);
  return { ok: true, slug };
}

/** List an existing page in `group` — for pages that exist as files but aren't in the nav. */
export async function addPageToNavAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  group: string,
  slug: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const read = await readDraftConfig(gate.site, branch);
  if ("error" in read) return read;
  if (!addPageToGroup(read.config, group, slug)) {
    return { error: "That page is already in this group." };
  }
  await writeConfig(gate.site, branch, read.config, gate.userId);
  return { ok: true };
}

/** Create an empty navigation group, optionally nested under `parent`. */
export async function createGroupAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  name: string,
  parent?: string,
): Promise<{ ok: true; group: string } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the group a name." };
  const read = await readDraftConfig(gate.site, branch);
  if ("error" in read) return read;
  if (!addGroup(read.config, trimmed, parent)) {
    return { error: `There's already a group called "${trimmed}".` };
  }
  await writeConfig(gate.site, branch, read.config, gate.userId);
  return { ok: true, group: trimmed };
}

/**
 * Create a navigation tab. On a site that has no tabs yet this RESTRUCTURES the navigation —
 * existing top-level groups move into an implicit first tab, because `tabs` and top-level
 * `groups` are alternatives and buildNav would otherwise stop reading the root entirely.
 * `converted` says whether that happened, so the UI can report it.
 */
export async function createTabAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  name: string,
): Promise<{ ok: true; tab: string; converted: boolean } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the tab a name." };
  const read = await readDraftConfig(gate.site, branch);
  if ("error" in read) return read;
  const res = addTab(read.config, trimmed);
  if (!res.ok) {
    return {
      error:
        trimmed === IMPLICIT_TAB_NAME
          ? `“${IMPLICIT_TAB_NAME}” is the name given to your existing navigation — pick another.`
          : `There's already a tab called "${trimmed}".`,
    };
  }
  await writeConfig(gate.site, branch, read.config, gate.userId);
  return { ok: true, tab: trimmed, converted: res.converted };
}

/**
 * Reorder the navigation by drag-and-drop: move a page entry, or slide a group among its
 * siblings. One action for both so a drop is a single round trip and a single docs.json write.
 */
export async function moveNavItemAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  move:
    | { kind: "page"; from: { group: string; index: number }; to: { group: string; index: number } }
    | { kind: "group"; group: string; toIndex: number },
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;
  const read = await readDraftConfig(gate.site, branch);
  if ("error" in read) return read;

  const moved =
    move.kind === "page"
      ? movePage(read.config, move.from, move.to)
      : reorderGroup(read.config, move.group, move.toIndex);
  // A refusal means the tree the browser dragged from no longer matches docs.json — someone
  // else moved it, or the draft changed under us. Say so instead of writing a guess.
  if (!moved) return { error: "That item moved — reload and try again." };

  await writeConfig(gate.site, branch, read.config, gate.userId);
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

/**
 * `mode` is what the UI *proposes*; the server decides. A Papervine-hosted site has no repo,
 * so `publishDraft` dispatches to the storage publisher and ignores the mode entirely —
 * which is why "native" is accepted here rather than rejected (the button sends whatever
 * `publishModeFor` gave it), and why a stale client asking for a PR on a hosted site still
 * does the right thing instead of erroring.
 */
export async function publishDraftAction(
  orgSlug: string,
  siteSlug: string,
  branch: string,
  mode: PublishMode,
  message?: string,
): Promise<PublishResult> {
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return { ok: false, error: gate.error };
  // Narrow back to the Git modes for the Git path; 'native' never reaches it (publishDraft
  // dispatches on the site row first), and a Git site defaults to the safe non-PR action.
  const gitMode = mode === "pr" ? "pr" : "commit";
  const result = await publishDraft(gate.site, branch, {
    mode: gitMode,
    message,
    actorUserId: gate.userId,
  });
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
