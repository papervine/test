import { type NextRequest } from "next/server";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { createConnectSession } from "@/lib/integrations/nango";
import { isConnectableProvider } from "@/lib/integrations/catalog";

/**
 * Mint a Nango Connect session token for the dashboard's connector gallery (SPEC §10.2).
 *
 * On the **app host** and session-authed: connecting a source grants the agent live read
 * access to an org's Google Drive, so this is owner/admin only — the same bar the Agent
 * surface itself sits behind. The provider is validated against our own catalog before
 * Nango ever sees it, and named again as `allowed_integrations` on the session, so a
 * tampered client can neither pick an arbitrary integration nor widen the one we chose.
 */
export async function POST(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) return Response.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    org?: string;
    provider?: string;
  } | null;
  const provider = body?.provider;
  const orgSlug = body?.org;
  if (!provider || !orgSlug) {
    return Response.json({ error: "Missing org or provider." }, { status: 400 });
  }
  if (!isConnectableProvider(provider)) {
    return Response.json({ error: "Unknown connector." }, { status: 400 });
  }

  const org = (await listOrganizations().catch(() => []))?.find((o) => o.slug === orgSlug);
  if (!org) return Response.json({ error: "No such organization." }, { status: 404 });

  const role = await getMemberRole(org.id, session.user.id);
  if (role !== "owner" && role !== "admin") {
    return Response.json({ error: "Only owners and admins can connect sources." }, { status: 403 });
  }

  const result = await createConnectSession({
    provider,
    organizationId: org.id,
    userId: session.user.id,
    userEmail: session.user.email,
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: 502 });
  return Response.json({ token: result.token });
}
