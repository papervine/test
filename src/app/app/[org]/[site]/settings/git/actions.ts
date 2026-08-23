"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { site, githubInstallation, deployment } from "@/lib/db/app-schema";
import { findSite, type SiteRow } from "@/lib/dashboard-context";
import { getSession, listOrganizations } from "@/lib/session";
import {
  hasDocsConfig,
  listBranches,
  normalizeDocsPath,
  fetchRepo,
  getRef,
  listRepoTree,
} from "@/lib/github";
import { repoEmptiness } from "@/lib/git-conversion";
import { getInstallationToken, listInstallationRepos } from "@/lib/github-app";
import { repoTokenForSite } from "@/lib/github-token";
import { runSync } from "@/lib/sync-runner";
import { syncInFlight } from "@/lib/overview";
import { isNativeSite } from "@/lib/site-source";
import { handOverToGit, type HandoverResolution } from "@/lib/git-handover";
import { isUserAuthConfigured, userAuthorizeUrl, encodeGithubFlowState } from "@/lib/github-user-auth";
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
  // Re-pointing is for a site that ALREADY has a repo. A hosted site has none, and
  // attaching one here would leave sourceKind='native' while runSync overwrote its storage
  // prefix from git — mixing provenance and destroying the drafts that were the source of
  // truth. Use `convertToGit` below, which commits the content over first.
  if (isNativeSite(s)) {
    return { error: "This site is hosted by Papervine — use “Connect to GitHub” instead." };
  }

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

export type RepoHandoverCheck = {
  branches: string[];
  defaultBranch: string;
  /** Empty enough to adopt with no decision needed — see repoEmptiness. */
  empty: boolean;
  /** What's in the way, phrased for the person reading it. Only when `empty` is false. */
  reason?: string;
  /**
   * Does the repo carry a docs.json/mint.json? Decides whether "the repository wins" is even
   * offerable: adopting a repo with no config leaves the site with no docs.json, and the
   * render path THROWS rather than degrading.
   */
  hasDocsConfig: boolean;
};

/**
 * Inspect one repo for the hosted → Git hand-over: its branches AND whether it's empty
 * enough to adopt, in a single round trip.
 *
 * Combined deliberately. Picking a repo is the moment to learn "this one already has docs",
 * not after filling in a branch and pressing Connect — and both answers come from the same
 * two GitHub calls, so splitting them would just double the latency.
 */
export async function inspectRepoForHandover(
  ref: SiteRef,
  installationId: number | null,
  owner: string,
  name: string,
): Promise<RepoHandoverCheck | { error: string }> {
  const s = await findSite(ref.org, ref.site);
  if (!s) return { error: "Not found." };
  const choice = await tokenForChoice(s, installationId);
  if (!choice?.token) {
    return { error: "Papervine needs write access to that repository — install the GitHub App on it." };
  }
  const token = choice.token;

  const repo = await fetchRepo(owner, name, token);
  if (!repo) return { error: `Can't read ${owner}/${name}.` };

  // No head on the default branch = a repo with no commits at all, the emptiest case.
  const base = await getRef(owner, name, repo.defaultBranch, token);
  const tree = base ? await listRepoTree(owner, name, repo.defaultBranch, token) : null;
  const emptiness = repoEmptiness(tree);

  const branches = await listBranches(owner, name, token);
  // Only worth asking when the repo has something in it — an empty repo needs no decision.
  const config = emptiness.empty
    ? false
    : await hasDocsConfig(owner, name, repo.defaultBranch, token, "");
  return {
    // A repo with no commits has no branches yet; offer the default so the select isn't empty.
    branches: branches.length > 0 ? branches : [repo.defaultBranch],
    defaultBranch: repo.defaultBranch,
    empty: emptiness.empty,
    ...(emptiness.empty ? {} : { reason: emptiness.reason }),
    hasDocsConfig: config,
  };
}

export type ConvertToGitState = {
  ok?: boolean;
  error?: string;
  /** The repo isn't empty and no side was chosen — ask, don't fail. */
  needsResolution?: boolean;
  /** Branch the hosted content was parked on, when the repository won. */
  backedUpTo?: string;
};

/**
 * Take a Papervine-hosted site onto Git (SPEC §10.11) when the owner made the empty repo
 * themselves. The one-click variant (which creates the repo first, via a user access token)
 * lives in api/github/user-auth/callback; both then run the same `handOverToGit`.
 */
export async function convertToGit(
  ref: SiteRef,
  input: {
    installationId: number | null;
    owner: string;
    name: string;
    branch?: string;
    docsPath?: string;
    /** Which side wins when the repo isn't empty. Omitted → the server asks, never guesses. */
    resolution?: HandoverResolution;
  },
): Promise<ConvertToGitState> {
  const s = await findSite(ref.org, ref.site);
  const org = (await listOrganizations())?.find((o) => o.slug === ref.org);
  if (!s || !org) return { error: "Not found." };

  const owner = input.owner.trim();
  const name = input.name.trim();
  if (!owner || !name) return { error: "Choose a repository." };

  const choice = await tokenForChoice(s, input.installationId);
  if (!choice) return { error: "That GitHub organization isn't connected." };
  // Every write needs credentials; without them the git calls fail deep with an opaque 401.
  // Surface the real reason up front (mirrors publishDraft's token check).
  if (!choice.token) {
    return {
      error:
        "Papervine needs write access to that repository. Install the GitHub App on it (or " +
        "add an access token) and try again.",
    };
  }

  const session = await getSession();
  const res = await handOverToGit(s, {
    owner,
    name,
    branch: input.branch,
    docsPath: normalizeDocsPath(input.docsPath ?? ""),
    token: choice.token,
    actorUserId: session?.user.id ?? null,
    installationId: input.installationId,
    resolution: input.resolution,
  });
  if (!res.ok) {
    // needsResolution means "the repo isn't empty and nobody chose" — the client turns that
    // into the which-source-wins prompt rather than showing it as a failure.
    return { error: res.error, ...(res.needsResolution ? { needsResolution: true } : {}) };
  }

  revalidatePath(siteRoute(org.slug, s.slug));
  return { ok: true, ...(res.backedUpTo ? { backedUpTo: res.backedUpTo } : {}) };
}

/**
 * Start the one-click flow: we create the repository, then hand the content over.
 *
 * Returns a URL for the client to navigate to rather than redirecting, because the target is
 * github.com — and because a server `redirect()` from the app host is the documented rewrite
 * trap (CLAUDE.md). The repo name and site ride along in an encrypted `state`; the callback
 * re-checks authorization from the session regardless.
 */
export async function startRepoCreation(
  ref: SiteRef,
  input: { repo: string; private: boolean },
): Promise<{ authorizeUrl?: string; error?: string }> {
  const s = await findSite(ref.org, ref.site);
  if (!s) return { error: "Not found." };
  if (!isNativeSite(s)) return { error: "This site is already connected to a repository." };
  if (!isUserAuthConfigured()) {
    return {
      error:
        "This deployment can't create repositories for you — an operator needs to set " +
        "GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET. Create an empty repo yourself instead.",
    };
  }

  // GitHub's own rule: letters, digits, dots, hyphens and underscores.
  const repo = input.repo.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) {
    return {
      error: "Repository names can only contain letters, numbers, dots, hyphens and underscores.",
    };
  }

  const url = userAuthorizeUrl(
    encodeGithubFlowState({
      org: ref.org,
      site: ref.site,
      repo,
      private: input.private,
    }),
  );
  if (!url) return { error: "Couldn't start GitHub authorization." };
  return { authorizeUrl: url };
}
