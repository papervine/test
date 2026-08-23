import { eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { githubInstallation } from "@/lib/db/app-schema";
import { requireSite } from "@/lib/dashboard-context";
import {
  isGithubAppConfigured,
  installUrl,
  listInstallationRepos,
  type InstallRepo,
} from "@/lib/github-app";
import { listBranches } from "@/lib/github";
import { repoTokenForSite } from "@/lib/github-token";
import { isNativeSite } from "@/lib/site-source";
import { isUserAuthConfigured, encodeGithubFlowState } from "@/lib/github-user-auth";
import { GitSettingsForm } from "./GitSettingsForm";
import { ConnectToGitHubForm } from "./ConnectToGitHubForm";

// saveGitSettings re-syncs inline, like connectRepo — give the route the same headroom
// so a big repo's first re-point doesn't 504. See settings/git/actions.ts.
export const maxDuration = 300;

// Concrete Git settings surface — overrides the settings/[section] placeholder for the
// "git" slug (a static segment wins over the dynamic one). Lets an owner re-point the
// site at a different org/repo/branch/subdirectory and re-deploy (hosted docs platforms' Git settings).
export default async function GitSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; site: string }>;
  // The one-click flow returns here from GitHub with ?connected= or ?error= (see
  // api/github/user-auth/callback) — a redirect can't carry state any other way.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const search = await searchParams;
  const { org, site } = await requireSite(orgSlug, siteSlug);

  const appConfigured = isGithubAppConfigured();

  // The org's GitHub App installations back the "GitHub organization" dropdown and the
  // "Installed organizations" list. Each install's repos are fetched in parallel (one
  // GitHub call each) for the tag list + the initial Repository dropdown.
  const installs = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.organizationId, org.id));

  // Each installation's repos back the Repository dropdown in both branches below (one
  // GitHub call per installation, fetched in parallel).
  const reposByInstall = new Map<number, InstallRepo[]>(
    await Promise.all(
      installs.map(
        async (i) => [i.installationId, await listInstallationRepos(i.installationId)] as const,
      ),
    ),
  );

  // A Papervine-hosted site has no repo to configure — this page is where it gets one
  // (SPEC §10.11). Nav keeps the "Git settings" item for both kinds precisely so this is
  // findable.
  if (isNativeSite(site)) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
          <span>Settings</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-[var(--fg)]">Git settings</span>
        </nav>
        <ConnectToGitHubForm
          siteRef={{ org: orgSlug, site: siteSlug }}
          siteName={site.name}
          suggestedRepoName={site.slug}
          appConfigured={appConfigured}
          canCreateRepo={isUserAuthConfigured()}
          installHref={
            appConfigured
              ? installUrl(encodeGithubFlowState({ org: orgSlug, site: siteSlug }))
              : null
          }
          installations={installs.map((i) => ({
            installationId: i.installationId,
            accountLogin: i.accountLogin,
            repos: (reposByInstall.get(i.installationId) ?? []).map((r) => ({
              owner: r.owner,
              name: r.name,
              fullName: r.fullName,
            })),
          }))}
          notice={{
            connected: typeof search.connected === "string" ? search.connected : undefined,
            error: typeof search.error === "string" ? search.error : undefined,
          }}
        />
      </div>
    );
  }

  // The currently-selected source. A site connected by PAT/public has no installationId;
  // represent it with the "current" sentinel (null) so its owner/repo stay editable.
  const selectedInstallationId = site.githubInstallationId;
  const initialRepos = selectedInstallationId
    ? (reposByInstall.get(selectedInstallationId) ?? [])
    : [];

  // Branches for the saved repo, so the Branch dropdown is populated on first paint.
  // repoTokenForSite resolves the right credential (installation token > PAT > none).
  const initialBranches =
    site.repoOwner && site.repoName
      ? await listBranches(site.repoOwner, site.repoName, await repoTokenForSite(site))
      : [];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Git settings</span>
      </nav>

      <GitSettingsForm
        siteRef={{ org: orgSlug, site: siteSlug }}
        appConfigured={appConfigured}
        installHref={
          appConfigured ? installUrl(encodeGithubFlowState({ org: orgSlug, site: siteSlug })) : null
        }
        installations={installs.map((i) => ({
          installationId: i.installationId,
          accountLogin: i.accountLogin,
          repos: (reposByInstall.get(i.installationId) ?? []).map((r) => ({
            owner: r.owner,
            name: r.name,
            fullName: r.fullName,
          })),
        }))}
        saved={{
          installationId: selectedInstallationId,
          owner: site.repoOwner ?? "",
          name: site.repoName ?? "",
          branch: site.branch,
          docsPath: site.docsPath,
        }}
        initialRepos={initialRepos.map((r) => ({
          owner: r.owner,
          name: r.name,
          fullName: r.fullName,
        }))}
        initialBranches={initialBranches}
        status={site.status}
      />
    </div>
  );
}
