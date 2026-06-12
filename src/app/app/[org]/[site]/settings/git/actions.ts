"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site, githubInstallation, deployment } from "@/lib/db/app-schema";
import { findSite, type SiteRow } from "@/lib/dashboard-context";
import { getSession, listOrganizations } from "@/lib/session";
import { hasDocsConfig, listBranches, normalizeDocsPath } from "@/lib/github";
import { getInstallationToken, listInstallationRepos } from "@/lib/github-app";
import { repoTokenForSite } from "@/lib/github-token";
import { runSync } from "@/lib/sync-runner";
import { syncInFlight } from "@/lib/overview";
import { siteRoute } from "@/lib/dashboard-nav";

export type SiteRef = { org: string; site: string };

// Resolve the GitHub token to read the *target* repo with. The "org" the form picked is
// an App installation (installationId) → mint its token; the "current" sentinel (null)
// means the site's existing PAT/public connection → use the stored credential. Verifies
// the installation belongs to the caller's org so one tenant can't borrow another's
// install. Returns { token } (token may be undefined for a public repo) or null if the
// chosen installation isn't theirs.
async function tokenForChoice(
  s: SiteRow,
  installationId: number | null,
): Promise<{ token: string | undefined } | null> {
  if (installationId == null) {
    return { token: await repoTokenForSite(s) };
  }
  const [install] = await db
    .select()
    .from(githubInstallation)
    .where(
      and(
        eq(githubInstallation.installationId, installationId),
        eq(githubInstallation.organizationId, s.organizationId),
      ),
    )
    .limit(1);
  if (!install) return null;
  return { token: await getInstallationToken(installationId) };
}

// Repos for the Repository dropdown when the org selection changes. Authorized by site
// ownership + (for an installation) org ownership of that install.
export async function reposForInstallation(
  ref: SiteRef,
  installationId: number,
): Promise<{ owner: string; name: string; fullName: string }[]> {
  const s = await findSite(ref.org, ref.site);
  if (!s) return [];
  const [install] = await db
    .select()
    .from(githubInstallation)
    .where(
      and(
        eq(githubInstallation.installationId, installationId),
        eq(githubInstallation.organizationId, s.organizationId),
      ),
    )
    .limit(1);
  if (!install) return [];
  return listInstallationRepos(installationId);
}

// Branches for the Branch dropdown when the repo selection changes.
export async function branchesForRepo(
  ref: SiteRef,
  installationId: number | null,
  owner: string,
  name: string,
): Promise<string[]> {
  const s = await findSite(ref.org, ref.site);
  if (!s) return [];
  const choice = await tokenForChoice(s, installationId);
  if (!choice) return [];
  return listBranches(owner, name, choice.token);
}

export type SaveGitState = { ok?: boolean; error?: string };

// Re-point the site at a repo/branch/subdirectory and re-sync. The control-plane
// counterpart to connectRepo: same validation (the docs config must exist on the chosen
// ref) and the same inline runSync so the owner sees the result in the Activity feed.
export async function saveGitSettings(
  ref: SiteRef,
  input: {
    installationId: number | null;
    owner: string;
    name: string;
    branch: string;
    docsPath: string;
  },
): Promise<SaveGitState> {
  const s = await findSite(ref.org, ref.site);
  const org = (await listOrganizations())?.find((o) => o.slug === ref.org);
  if (!s || !org) return { error: "Not found." };

  const owner = input.owner.trim();
  const name = input.name.trim();
  const branch = input.branch.trim();
  const docsPath = normalizeDocsPath(input.docsPath);
  if (!owner || !name) return { error: "Choose a repository." };
  if (!branch) return { error: "Choose a branch." };

  const choice = await tokenForChoice(s, input.installationId);
  if (!choice) return { error: "That GitHub organization isn't connected." };

  // Don't kick off a second sync onto the same storage prefix while one's in flight
  // (the same guard resyncSite uses — there's no advisory lock yet, SPEC §3/§10.3).
  const [building] = await db
    .select({ createdAt: deployment.createdAt })
    .from(deployment)
    .where(and(eq(deployment.siteId, s.id), eq(deployment.status, "building")))
    .orderBy(desc(deployment.createdAt))
    .limit(1);
  if (syncInFlight(building?.createdAt.getTime() ?? null)) {
    return { error: "A sync is already in progress — give it a moment." };
  }

  if (!(await hasDocsConfig(owner, name, branch, choice.token, docsPath))) {
    const where = docsPath ? `in ${docsPath}/ of` : "at the root of";
    return { error: `No docs.json or mint.json ${where} ${owner}/${name}@${branch}.` };
  }

  // Persist the new source. installationId set → App-backed (syncs mint installation
  // tokens); null keeps the existing PAT/public connection. We don't touch repoTokenEnc:
  // a PAT stays as a fallback even when an installation is chosen (repoTokenForSite
  // prefers the installation), matching connectRepo's precedence.
  const [updated] = await db
    .update(site)
    .set({
      repoOwner: owner,
      repoName: name,
      branch,
      docsPath,
      githubInstallationId: input.installationId,
      updatedAt: new Date(),
    })
    .where(eq(site.id, s.id))
    .returning();

  const session = await getSession();

  try {
    await runSync(updated, {
      actorUserId: session?.user.id ?? null,
      trigger: "manual",
    });
  } catch (e) {
    console.error(`[git-settings] runSync threw for site ${s.id}`, e);
  }

  revalidatePath(siteRoute(org.slug, s.slug));
  return { ok: true };
}
