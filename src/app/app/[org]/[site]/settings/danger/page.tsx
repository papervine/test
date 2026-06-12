import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { DangerZone } from "./DangerZone";

// Concrete Danger zone surface — overrides the settings/[section] placeholder for the
// "danger" slug (SPEC §10.5). Irreversible deletes: the site (the incumbent's "deployment")
// and the whole organization. requireSite gates org membership; the role decides which
// sections show (owner/admin → site, owner → organization), and the actions re-check it.
export default async function DangerSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { role } = await requireSite(orgSlug, siteSlug);

  const isAdmin = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  return (
    <div className="px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Danger zone</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Danger zone</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Irreversible actions. Deleting a site or organization cannot be undone.
      </p>

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
