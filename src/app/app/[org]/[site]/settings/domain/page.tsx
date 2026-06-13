import { headers } from "next/headers";
import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { getDomainStatus, customDomainCnameTarget } from "@/lib/vercel-domains";
import { DomainSetupForm } from "./DomainSetupForm";

// Concrete Domain setup surface — overrides the settings/[section] placeholder for the
// "domain" slug (a static segment wins over the dynamic one). Lets an owner map a vanity
// host (docs.acme.com) to the site in the URL and serve it at the root or under /docs.
export default async function DomainSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { site } = await requireSite(orgSlug, siteSlug);
  const apexBase = ((await headers()).get("host") ?? "").replace(/^(app|www)\./, "");

  // What the customer CNAMEs to — operator's branded host (CUSTOM_DOMAIN_CNAME_TARGET) if
  // set, else the raw Vercel edge when Vercel-managed, else the apex (self-host). See
  // customDomainCnameTarget / SPEC §2 for the precedence and the Phase 2 indirection seam.
  const cnameTarget = customDomainCnameTarget(apexBase);

  // While a connected domain is still pending, surface Vercel's exact ownership records
  // (a TXT challenge only appears when the host/apex is already used elsewhere). Skipped
  // once verified, and a no-op (null) when Vercel isn't configured.
  const status =
    site.customDomain && site.customDomainVerifiedAt === null
      ? await getDomainStatus(site.customDomain)
      : null;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Domain setup</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Set up your custom domain</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This domain will be assigned to your site.
      </p>

      <DomainSetupForm
        siteRef={{ org: orgSlug, site: siteSlug }}
        initialDomain={site.customDomain ?? ""}
        initialSubpath={site.customDomainSubpath}
        verified={site.customDomainVerifiedAt !== null}
        cnameTarget={cnameTarget}
        verificationRecords={status?.verification ?? []}
      />
    </div>
  );
}
