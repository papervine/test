import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { GeneralForm } from "./GeneralForm";

// Concrete General surface — overrides the settings/[section] placeholder for the "general"
// slug. v1 edits the site's display name (the label shown across the dashboard — switcher +
// breadcrumb; SPEC §10). The slug (URL id) and the rendered docs title (from the repo's
// docs.json) are deliberately not editable here.
export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { site, role } = await requireSite(orgSlug, siteSlug);
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">General</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">General</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Basic settings for this site.
      </p>

      <GeneralForm siteRef={{ org: orgSlug, site: siteSlug }} name={site.name} canManage={canManage} />
    </div>
  );
}
