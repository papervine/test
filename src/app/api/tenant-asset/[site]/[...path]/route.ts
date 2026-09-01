import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { getSiteBySlug } from "@/lib/tenant";
import { getObjectBytes } from "@/lib/storage";
import { getSession, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";
import { findOpenSession } from "@/lib/draft-store";
import { draftAssetKey } from "@/lib/media-upload";
import { mimeForPath } from "@/lib/sync-plan";
import { isServableAssetPath, liveContentPrefix } from "@/lib/revisions";

// Streams a tenant's static assets from object storage (SPEC §3.1 model C).
// Reached via the middleware tenant-host rewrite of /img/… → /api/tenant-asset/{slug}/…
//
// One route serves two audiences, because Studio and the draft preview render the tenant's real
// MDX and therefore ask for assets at the tenant's real URLs. An asset uploaded in the editor
// isn't published yet, so it only exists under the session's draft prefix — an editor that
// couldn't see it would show a broken player for everything you just added.
//
// The split is authorization, not a separate URL: a reader gets published bytes only, and the
// draft lookup is reached exclusively by someone who could open the editor for this site. The
// cookie-presence check comes first so reader traffic — which carries no session cookie — pays
// nothing at all for a branch it can never take.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ site: string; path: string[] }> },
) {
  const { site, path } = await params;
  const record = await getSiteBySlug(site);
  if (!record) return new NextResponse("Not found", { status: 404 });

  const relPath = path.join("/");
  // Sidecars (`.manifest.json`, `.dimensions.json`) are bookkeeping that happens to sit in the
  // content tree, and a reader has no business fetching them by URL — this is the one surface
  // that turns a storage key into a public GET, so the filter belongs here.
  if (!isServableAssetPath(relPath)) return new NextResponse("Not found", { status: 404 });
  const draft = getSessionCookie(req) ? await draftBytes(record, relPath) : null;
  const obj = draft ?? (await getObjectBytes(`${liveContentPrefix(record)}${relPath}`));
  if (!obj) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(obj.body, {
    headers: {
      "content-type": obj.contentType ?? mimeForPath(relPath),
      // Draft bytes are per-editor and change as they re-upload, so they must not be cached by
      // anything in front of us — and must never land in a shared cache a reader could hit.
      "cache-control": draft ? "private, no-store" : "public, max-age=300",
    },
  });
}

type SiteRecord = NonNullable<Awaited<ReturnType<typeof getSiteBySlug>>>;

/** The unpublished copy, if the requester is allowed to see this site's drafts and one exists. */
async function draftBytes(record: SiteRecord, relPath: string) {
  const session = await getSession();
  if (!session) return null;
  const role = await getMemberRole(record.organizationId, session.user.id);
  if (!canSeeFeature("editor.workspace", role)) return null;
  const editSession = await findOpenSession(record.id, record.branch);
  if (!editSession) return null;
  return getObjectBytes(draftAssetKey(editSession.id, relPath));
}
