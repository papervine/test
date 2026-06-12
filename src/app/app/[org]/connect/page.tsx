import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubInstallation } from "@/lib/db/app-schema";
import { listOrganizations } from "@/lib/session";
import { isGithubAppConfigured, installUrl } from "@/lib/github-app";
import ConnectForm from "./ConnectForm";

// connectRepo runs the initial repo sync inline (so the user lands on a ready site) —
// give it real headroom. 60s proved to be right AT the sync time for a big repo
// (intermittent 504s); 300 is the Fluid Compute cap on Hobby (Pro allows 800).
export const maxDuration = 300;

// Server shell: resolve the org's GitHub App install state, then hand it to the client
// form. The edge gate (middleware) already guarantees a session here, so this only runs
// for an authenticated user.
export default async function ConnectRepoPage() {
  const org = (await listOrganizations())?.[0];
  const appConfigured = isGithubAppConfigured();

  const install =
    appConfigured && org
      ? (
          await db
            .select()
            .from(githubInstallation)
            .where(eq(githubInstallation.organizationId, org.id))
            .limit(1)
        )[0]
      : undefined;

  return (
    <ConnectForm
      appConfigured={appConfigured}
      hasInstallation={Boolean(install)}
      installAccount={install?.accountLogin ?? null}
      // state = org id, so the setup callback can correlate the install back to this org.
      installHref={appConfigured && org ? installUrl(org.id) : null}
    />
  );
}
