import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubInstallation } from "@/lib/db/app-schema";
import { requireOrg } from "@/lib/dashboard-context";
import { canSeeFeature } from "@/lib/features";
import { isGithubAppConfigured, installUrl } from "@/lib/github-app";
import { encodeGithubFlowState } from "@/lib/github-user-auth";
import { NewSiteChooser } from "./NewSiteChooser";

// connectRepo runs the initial repo sync inline (so the user lands on a ready site) —
// give it real headroom. 60s proved to be right AT the sync time for a big repo
// (intermittent 504s); 300 is the Fluid Compute cap on Hobby (Pro allows 800).
// createBlankSite also runs here, but it's three small writes — well inside this.
export const maxDuration = 300;

// Server shell for the add-site start-method chooser (SPEC §10.11): resolve the org, its
// GitHub App install state, and what this viewer is allowed to do, then hand it all to the
// client chooser. The edge gate (middleware) already guarantees a session here.
export default async function NewSitePage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  // Resolves the org from the ROUTE, and 404s a site in someone else's org.
  const { org, role, sites } = await requireOrg(orgSlug);
  const appConfigured = isGithubAppConfigured();

  const install = appConfigured
    ? (
        await db
          .select()
          .from(githubInstallation)
          .where(eq(githubInstallation.organizationId, org.id))
          .limit(1)
      )[0]
    : undefined;

  return (
    <NewSiteChooser
      hasSites={sites.length > 0}
      // A Papervine-hosted site is written in Studio, so someone who can't open Studio
      // shouldn't be starting one (the editor route would 404 them).
      canUseStudio={canSeeFeature("editor.workspace", role)}
      appConfigured={appConfigured}
      hasInstallation={Boolean(install)}
      installAccount={install?.accountLogin ?? null}
      // The state tells the setup callback to return here rather than guessing.
      installHref={appConfigured ? installUrl(encodeGithubFlowState({ org: orgSlug })) : null}
    />
  );
}
