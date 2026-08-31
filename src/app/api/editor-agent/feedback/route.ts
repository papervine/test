import { findSite } from "@/lib/dashboard-context";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";
import { logEvent } from "@/lib/track";
import { parseFeedbackBody } from "@/lib/agent-feedback";

/**
 * Good/Bad response ratings for the editing agent (SPEC §9.2). Same auth gate as
 * /api/editor-agent (this is the same surface), then one analytics_event row:
 * type='feedback', status='up'|'down', path='/editor-agent' (distinguishes editor-agent
 * ratings from any future reader-widget feedback in the same table), query=the user ask
 * the rated reply answered, sessionId=the chat id so ratings group per conversation.
 */
export async function POST(req: Request) {
  const { org, site, ...rest } = (await req.json().catch(() => ({}))) as {
    org?: string;
    site?: string;
  } & Record<string, unknown>;
  if (!org || !site) return Response.json({ error: "Missing org/site." }, { status: 400 });

  const feedback = parseFeedbackBody(rest);
  if (!feedback) return Response.json({ error: "Malformed feedback." }, { status: 400 });

  const session = await getSession();
  if (!session) return Response.json({ error: "Signed out." }, { status: 401 });
  const organization = (await listOrganizations())?.find((o) => o.slug === org);
  if (!organization) return Response.json({ error: "Org not found." }, { status: 404 });
  const role = await getMemberRole(organization.id, session.user.id);
  if (!canSeeFeature("editor.workspace", role)) {
    return Response.json({ error: "Editor not enabled." }, { status: 403 });
  }
  const siteRow = await findSite(org, site);
  if (!siteRow) return Response.json({ error: "Site not found." }, { status: 404 });

  // logEvent is fire-and-forget by design (warn, don't throw) — a failed insert must not
  // surface as a broken thumbs button.
  await logEvent({
    siteId: siteRow.id,
    type: "feedback",
    path: "/editor-agent",
    query: feedback.question ?? null,
    status: feedback.rating,
    sessionId: feedback.chatId ?? null,
  });
  return Response.json({ ok: true });
}
