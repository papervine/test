"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { siteRoute } from "@/lib/dashboard-nav";
import { parseInviteEmails } from "@/lib/invite-emails";

// Members are ORG-scoped (the member/invitation tables key on organizationId, SPEC §10), but
// the surface lives under the site shell at /:org/:site/settings/members like every settings
// page. Actions resolve org.id from the URL's org slug and gate on org membership/role; the
// site slug is only routing context. Better Auth (organization plugin) owns the data + also
// re-checks permissions server-side — these actions add a friendly gate + error mapping and a
// shareable accept link (no email infra yet; the sendInvitationEmail seam in auth.ts is ready
// for Resend later).

export type SiteRef = { org: string; site: string };

export type InviteOutcome = {
  email: string;
  status: "sent" | "already-member" | "already-invited" | "error";
  /** The shareable accept link, present when status === "sent". */
  link?: string;
  /** A friendly message when status === "error". */
  message?: string;
};

export type InviteState = {
  ok?: boolean;
  error?: string;
  results?: InviteOutcome[];
  invalid?: string[];
  truncated?: boolean;
};

export type MembersActionState = { ok?: boolean; error?: string };

const membersPath = (ref: SiteRef) => siteRoute(ref.org, ref.site, "settings/members");

/** Resolve the org for this request and confirm the caller is an owner/admin of it. */
async function requireOrgAdmin(
  ref: SiteRef,
): Promise<{ orgId: string; userId: string } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "Not signed in." };
  const org = (await listOrganizations())?.find((o) => o.slug === ref.org);
  if (!org) return { error: "No active organization." };
  const role = await getMemberRole(org.id, session.user.id);
  if (role !== "owner" && role !== "admin") {
    return { error: "Only an owner or admin can manage members." };
  }
  return { orgId: org.id, userId: session.user.id };
}

/** The app-host accept link for an invitation. Built from the request Host (the dashboard action
 *  always runs on the app host — app.papervine.io / app.localhost:3000), so it points readers at
 *  the right control-plane origin without a hardcoded domain. */
async function acceptLinkFor(invitationId: string): Promise<string> {
  const host = (await headers()).get("host") ?? "app.papervine.io";
  const proto = host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https";
  return `${proto}://${host}/accept-invite?id=${invitationId}`;
}

// Better Auth throws an APIError carrying a `.body.code`; map the ones an admin can hit to
// per-email outcomes instead of failing the whole batch.
function inviteOutcomeFromError(email: string, err: unknown): InviteOutcome {
  const code =
    (err as { body?: { code?: string } })?.body?.code ??
    (err instanceof Error ? err.message : "");
  if (code.includes("ALREADY_A_MEMBER")) return { email, status: "already-member" };
  if (code.includes("ALREADY_INVITED")) return { email, status: "already-invited" };
  if (code.includes("INVITATION_LIMIT") || code.includes("MEMBERSHIP_LIMIT")) {
    return { email, status: "error", message: "Invite or member limit reached." };
  }
  console.error(`[members] invite failed for ${email}`, err);
  return { email, status: "error", message: "Couldn’t send this invite." };
}

/** Invite one or more addresses (the textarea value) as `member`s of the org. */
export async function inviteMembers(ref: SiteRef, raw: string): Promise<InviteState> {
  const gate = await requireOrgAdmin(ref);
  if ("error" in gate) return { error: gate.error };

  const { emails, invalid, truncated } = parseInviteEmails(raw);
  if (emails.length === 0) {
    return { error: "Enter at least one valid email address.", invalid };
  }

  const hdrs = await headers();
  const results: InviteOutcome[] = [];
  for (const email of emails) {
    try {
      const invitation = await auth.api.createInvitation({
        body: { email, role: "member", organizationId: gate.orgId },
        headers: hdrs,
      });
      results.push({ email, status: "sent", link: await acceptLinkFor(invitation.id) });
    } catch (err) {
      results.push(inviteOutcomeFromError(email, err));
    }
  }

  revalidatePath(membersPath(ref));
  return { ok: true, results, invalid, truncated };
}

/** Revoke a pending invitation. */
export async function cancelInvite(
  ref: SiteRef,
  invitationId: string,
): Promise<MembersActionState> {
  const gate = await requireOrgAdmin(ref);
  if ("error" in gate) return { error: gate.error };
  try {
    await auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  } catch (err) {
    console.error(`[members] cancel invite ${invitationId} failed`, err);
    return { error: "Couldn’t cancel that invitation." };
  }
  revalidatePath(membersPath(ref));
  return { ok: true };
}

/** Remove a member from the org. Better Auth rejects removing the last owner / yourself where
 *  appropriate; we surface that rather than guess the rule. */
export async function removeMember(
  ref: SiteRef,
  memberIdOrEmail: string,
): Promise<MembersActionState> {
  const gate = await requireOrgAdmin(ref);
  if ("error" in gate) return { error: gate.error };
  try {
    await auth.api.removeMember({
      body: { memberIdOrEmail, organizationId: gate.orgId },
      headers: await headers(),
    });
  } catch (err) {
    const code = (err as { body?: { code?: string } })?.body?.code ?? "";
    console.error(`[members] remove ${memberIdOrEmail} failed`, err);
    return {
      error: code.includes("NOT_ALLOWED")
        ? "You can’t remove this member."
        : "Couldn’t remove that member.",
    };
  }
  revalidatePath(membersPath(ref));
  return { ok: true };
}
