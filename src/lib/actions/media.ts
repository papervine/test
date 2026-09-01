"use server";

import { gateEditor } from "@/lib/editor-gate";
import { findOpenSession, listDraftFiles, upsertDraftFile } from "@/lib/draft-store";
import { checkoutBranch } from "@/lib/authoring-core";
import type { SiteRow } from "@/lib/dashboard-context";
import { headObject, listKeys, presignPut } from "@/lib/storage";
import { mimeForPath } from "@/lib/sync-plan";
import { liveContentPrefix } from "@/lib/revisions";
import {
  UPLOAD_KINDS,
  draftAssetKey,
  mergeMediaListing,
  uploadTargetPath,
  validateUpload,
  type UploadKind,
} from "@/lib/media-upload";

// Uploading media from Studio into the site's own object storage, and listing what's already
// there. Server-action front-end over the same draft buffer everything else writes to — an upload
// is an edit, so it shows in the change list, reverts per-file, and goes live only on Publish.
//
// Three calls rather than one, because the bytes never pass through this app: `requestUpload`
// signs a URL, the browser PUTs to storage directly (a Route Handler's body cap is a few MB —
// less than one video), and `finalizeUpload` confirms the object landed before recording it.
// Recording first would leave a phantom change for an upload that failed halfway.

export type MediaUploadTicket = { uploadUrl: string; path: string; contentType: string };

/**
 * Open the session up front, through the same checkout everything else uses (it stamps the deploy
 * branch head for the publish-time divergence check, and skips GitHub for a hosted site). An
 * upload can be the FIRST edit someone makes on a page, and a checkout that only happened on text
 * save would leave the bytes with no session to belong to.
 */
async function sessionFor(site: SiteRow, branch: string, userId: string): Promise<string> {
  const open = await findOpenSession(site.id, branch);
  if (open) return open.id;
  const { sessionId } = await checkoutBranch(site, { actorUserId: userId, branchName: branch });
  return sessionId;
}

export async function requestMediaUpload(input: {
  orgSlug: string;
  siteSlug: string;
  branch: string;
  kind: UploadKind;
  filename: string;
  size: number;
}): Promise<MediaUploadTicket | { error: string }> {
  const { orgSlug, siteSlug, branch, kind, filename, size } = input;
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;

  // Re-validated server-side. The dialog checks the same rules for a fast answer, but the client
  // is the one place these can't be enforced — and the signature we're about to hand out is a
  // write capability into the site's storage.
  const check = validateUpload(kind, filename, size);
  if ("error" in check) return check;

  const sessionId = await sessionFor(gate.site, branch, gate.userId);
  const taken = await existingMediaPaths(gate.site, sessionId);
  const path = uploadTargetPath(kind, filename, taken);
  if (!path) return { error: "That file type isn't supported here." };

  // The content type is signed into the URL, so the upload can't land as something else — an
  // .mp4 key served as text/html would be an XSS vector on the tenant's own domain.
  const contentType = mimeForPath(path);
  const uploadUrl = await presignPut(draftAssetKey(sessionId, path), contentType);
  return { uploadUrl, path, contentType };
}

export async function finalizeMediaUpload(input: {
  orgSlug: string;
  siteSlug: string;
  branch: string;
  kind: UploadKind;
  path: string;
}): Promise<{ ok: true; path: string } | { error: string }> {
  const { orgSlug, siteSlug, branch, kind, path } = input;
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;

  // Confirm the path is one we would have issued, not one the caller invented: this writes a
  // draft_file row, and the row is what publish later copies.
  const spec = UPLOAD_KINDS[kind];
  if (!path.startsWith(`${spec.dir}/`) || path.includes("..")) {
    return { error: "That upload path isn't valid." };
  }

  const session = await findOpenSession(gate.site.id, branch);
  if (!session) return { error: "No open edit session for this branch." };

  const head = await headObject(draftAssetKey(session.id, path));
  if (!head) return { error: "The upload didn't complete — try again." };
  if (head.size > spec.maxBytes) return { error: "That file is over the size limit." };

  // content stays empty: `binary` says the bytes are in storage, not in Postgres.
  await upsertDraftFile({ sessionId: session.id, path, content: "", binary: true });
  return { ok: true, path };
}

/** Everything the picker can offer: published assets plus anything uploaded in this session. */
export async function listSiteMedia(input: {
  orgSlug: string;
  siteSlug: string;
  branch: string;
  kind: UploadKind;
}): Promise<{ files: string[] } | { error: string }> {
  const { orgSlug, siteSlug, branch, kind } = input;
  const gate = await gateEditor(orgSlug, siteSlug);
  if ("error" in gate) return gate;

  const session = await findOpenSession(gate.site.id, branch);
  const published = await publishedPaths(gate.site);
  const draft = session
    ? (await listDraftFiles(session.id)).map((f) => ({ path: f.path, deleted: f.deleted }))
    : [];
  return { files: mergeMediaListing(kind, published, draft) };
}

/** Just the shape the prefix helper needs — the gate hands us a full SiteRow. */
type MediaSite = { id: string; liveRevisionId: string | null };

async function publishedPaths(site: MediaSite): Promise<string[]> {
  const prefix = liveContentPrefix(site);
  return (await listKeys(prefix)).map((k) => k.slice(prefix.length));
}

/** Paths already in use, so a new upload gets a suffix instead of overwriting one. */
async function existingMediaPaths(site: MediaSite, sessionId: string): Promise<string[]> {
  const published = await publishedPaths(site);
  const draft = (await listDraftFiles(sessionId)).map((f) => f.path);
  return [...published, ...draft];
}
