import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { authorizeRealtime, orgChannel, siteChannel } from "@/lib/realtime";

// Private-channel auth for the live Activity feed (SPEC §10.3). pusher-js POSTs
// { socket_id, channel_name } here before subscribing to `private-site-<id>`; we only sign
// the response if the logged-in user actually belongs to the org that owns that site — the
// same membership gate as the page and the /activity poll endpoint, so one tenant can't
// watch another's realtime channel. On the app host the middleware passes /api/ through
// untouched, so the session cookie reaches us intact.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const form = await req.formData();
  const socketId = String(form.get("socket_id") ?? "");
  const channel = String(form.get("channel_name") ?? "");

  // Two channel shapes, both canonical-or-nothing: derive the id from the name and re-form,
  // rejecting anything that doesn't round-trip (no wildcard/foreign access).
  //   private-org-<id>  — billing signals (SPEC §10); the viewer must be a member of the org.
  //   private-site-<id> — the Activity feed; the viewer must be a member of the site's org.
  const orgId = channel.startsWith("private-org-") ? channel.slice("private-org-".length) : null;
  const siteId = channel.startsWith("private-site-")
    ? channel.slice("private-site-".length)
    : null;
  const canonical = orgId
    ? channel === orgChannel(orgId)
    : siteId !== null && channel === siteChannel(siteId);
  if (!socketId || !canonical) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (orgId) {
    const orgs = await listOrganizations();
    if (!orgs?.some((o) => o.id === orgId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const orgAuth = authorizeRealtime(socketId, channel);
    if (!orgAuth) return NextResponse.json({ error: "realtime_disabled" }, { status: 503 });
    return NextResponse.json(orgAuth);
  }

  // The site exists and the viewer is a member of its org — else 403 (don't leak existence).
  const [row] = await db
    .select({ organizationId: site.organizationId })
    .from(site)
    .where(eq(site.id, siteId as string))
    .limit(1);
  const orgs = row ? await listOrganizations() : null;
  if (!row || !orgs?.some((o) => o.id === row.organizationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const auth = authorizeRealtime(socketId, channel);
  // null ⇒ realtime isn't configured server-side; tell the client cleanly so it stays on
  // its poll fallback instead of retrying a broken subscription.
  if (!auth) {
    return NextResponse.json({ error: "realtime_disabled" }, { status: 503 });
  }
  return NextResponse.json(auth);
}
