import { ChevronRight } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { requireSite } from "@/lib/dashboard-context";
import { getMemberRole, listOrganizations } from "@/lib/session";
import { destinationOptions, type TransferOption } from "@/lib/transfer-site";
import { DangerZone } from "./DangerZone";
import { TransferSite } from "./TransferSite";

// Concrete Danger zone surface — overrides the settings/[section] placeholder for the
// "danger" slug (SPEC §10.5). Transfer + irreversible deletes: move the site to another
// org the user administers, delete the site (the incumbent's "deployment"), or delete the whole
// organization. requireSite gates org membership; the role decides which sections show
// (owner/admin → transfer + site delete, owner → organization delete), and the actions
// re-check it.
export default async function DangerSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { session, org, role } = await requireSite(orgSlug, siteSlug);

  const isAdmin = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  // Where this site could go: ALL the user's other orgs, flagged eligible when they're
  // owner/admin there — ineligible ones render disabled with the reason instead of being
  // hidden (hiding read as "you aren't in any other org"). Roles are fetched here (async)
  // so destinationOptions stays pure; only computed for users who can transfer at all.
  let destinations: TransferOption[] = [];
  if (isAdmin) {
    const orgs = (await listOrganizations()) ?? [];
    const withRoles = await Promise.all(
      orgs.map(async (o) => ({
        id: o.id,
        slug: o.slug,
        name: o.name,
        role: await getMemberRole(o.id, session.user.id),
      })),
    );
    destinations = destinationOptions(withRoles, org.id);
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Danger zone</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Danger zone</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Irreversible actions. Deleting a site or organization cannot be undone.
      </p>

      {isAdmin && (
        <div className="mt-8 max-w-2xl">
          <TransferSite
            siteRef={{ org: orgSlug, site: siteSlug }}
            siteSlug={siteSlug}
            destinations={destinations}
          />
          <Separator className="mt-10" />
        </div>
      )}

      <DangerZone
        siteRef={{ org: orgSlug, site: siteSlug }}
        siteSlug={siteSlug}
        orgSlug={orgSlug}
        canDeleteSite={isAdmin}
        canDeleteOrg={isOwner}
      />
    </div>
  );
}
