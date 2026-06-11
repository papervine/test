import "server-only";
import { decryptSecret } from "./crypto";
import { getInstallationToken } from "./github-app";

// The single place that turns a site's stored credentials into a GitHub token for sync.
// Precedence: a GitHub App installation (preferred — short-lived, auto-rotating) over a
// stored fine-grained PAT; neither → undefined (a public repo, served token-less). The
// result feeds `ghHeaders(token?)` / syncSite unchanged — see src/lib/github-app.ts.
export async function repoTokenForSite(site: {
  githubInstallationId: number | null;
  repoTokenEnc: string | null;
}): Promise<string | undefined> {
  if (site.githubInstallationId != null) {
    const token = await getInstallationToken(site.githubInstallationId);
    if (token) return token;
    // App configured-but-failed (suspended/revoked install) falls through to a PAT if
    // one is also stored, else undefined → sync fails cleanly with a "can't read" error.
  }
  if (site.repoTokenEnc) return decryptSecret(site.repoTokenEnc);
  return undefined;
}
