import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invitation, organization } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { AcceptInvite } from "./AcceptInvite";

// Accept-invitation surface (SPEC §10). Lives on the app host with /login + /signup (the (auth)
// shell) and keeps its bare URL via the middleware passthrough. We read the invitation from the
// DB directly so we can show the org name even to a signed-OUT invitee (the id is an unguessable
// token they were sent) — the ACCEPT itself goes through Better Auth, which enforces that the
// invitee is signed in with the matching email and creates the membership. `force-dynamic`
// because it reads searchParams + the session cookie per request.
export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) return <AcceptInvite state="invalid" />;

  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      orgName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, id))
    .limit(1);

  // Gone / already handled / expired → a single "no longer valid" state (don't leak which).
  if (!row || row.status !== "pending" || new Date(row.expiresAt).getTime() < Date.now()) {
    return <AcceptInvite state="invalid" />;
  }

  const session = await getSession();
  const sessionEmail = session?.user.email ?? null;
  const state = !session
    ? "anon"
    : sessionEmail?.toLowerCase() === row.email.toLowerCase()
      ? "ready"
      : "mismatch";

  return (
    <AcceptInvite
      state={state}
      id={row.id}
      inviteEmail={row.email}
      orgName={row.orgName}
      sessionEmail={sessionEmail}
    />
  );
}
