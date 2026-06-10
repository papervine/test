import { headers } from "next/headers";
import { ChevronRight } from "lucide-react";
import { requireActiveSite } from "@/lib/require-active-site";
import {
  getDomainStatus,
  vercelDomainsConfigured,
  VERCEL_CNAME_TARGET,
} from "@/lib/vercel-domains";
import { DomainSetupForm } from "./DomainSetupForm";

// Concrete Domain setup surface — overrides the settings/[section] placeholder for the
// "domain" slug (a static segment wins over the dynamic one). Lets an owner map a vanity
// host (docs.acme.com) to the active site and serve it at the root or under /docs.
export default async function DomainSettingsPage() {
  const site = await requireActiveSite();
  const apexBase = ((await headers()).get("host") ?? "").replace(/^(app|www)\./, "");

  // What the customer CNAMEs to: when Vercel manages the domain, the host points at
  // Vercel's edge (cname.vercel-dns.com), not our apex — that's what gets the per-host
  // cert issued (SPEC §2). With no Vercel token (local/self-host) we fall back to the
  // apex, the path/self-host story.
  const cnameTarget = vercelDomainsConfigured() ? VERCEL_CNAME_TARGET : apexBase;

  // While a connected domain is still pending, surface Vercel's exact ownership records
  // (a TXT challenge only appears when the host/apex is already used elsewhere). Skipped
  // once verified, and a no-op (null) when Vercel isn't configured.
  const status =
    site?.customDomain && site.customDomainVerifiedAt === null
      ? await getDomainStatus(site.customDomain)
      : null;

  return (
    <div className="px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Domain setup</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Set up your custom domain</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        This domain will be assigned to your site.
      </p>

      {!site ? (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Connect a site first to set up a custom domain.
        </p>
      ) : (
        <DomainSetupForm
          initialDomain={site.customDomain ?? ""}
          initialSubpath={site.customDomainSubpath}
          verified={site.customDomainVerifiedAt !== null}
          cnameTarget={cnameTarget}
          verificationRecords={status?.verification ?? []}
        />
      )}
    </div>
  );
}
