import { headers } from "next/headers";
import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { auth } from "@/lib/auth";
import { MembersForm, type MemberRow, type InviteRow } from "./MembersForm";

// Concrete Members surface — overrides the settings/[section] placeholder for the "members"
// slug. Members are ORG-scoped (SPEC §10): we list every member + pending invitation of the
// site's organization, and an owner/admin can invite/remove. Data + permissions are owned by
// Better Auth's organization plugin (auth.api.*); this page just reads the lists and hands
// them to the client form.
export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { org, role, session } = await requireSite(orgSlug, siteSlug);
  const canManage = role === "owner" || role === "admin";
  const hdrs = await headers();

  let members: MemberRow[] = [];
  let invites: InviteRow[] = [];
  try {
    const list = await auth.api.listMembers({
      query: { organizationId: org.id },
      headers: hdrs,
    });
    members = (list.members ?? []).map((m) => ({
      id: m.id,
      email: m.user?.email ?? "(unknown)",
      role: m.role,
      joinedAt: new Date(m.createdAt).toISOString(),
      isSelf: m.userId === session.user.id,
    }));
  } catch {
    members = [];
  }
  try {
    const all = await auth.api.listInvitations({
      query: { organizationId: org.id },
      headers: hdrs,
    });
    invites = (all ?? [])
      .filter((i) => i.status === "pending")
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role ?? "member",
        expiresAt: new Date(i.expiresAt).toISOString(),
      }));
  } catch {
    invites = [];
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Members</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Team members</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Invite teammates to your organization and manage who has access.
      </p>

      <MembersForm
        siteRef={{ org: orgSlug, site: siteSlug }}
        members={members}
        invites={invites}
        canManage={canManage}
        viewerRole={role}
      />
    </div>
  );
}
