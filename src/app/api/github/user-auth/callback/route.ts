import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubInstallation } from "@/lib/db/app-schema";
import { findSite } from "@/lib/dashboard-context";
import { getSession, listOrganizations } from "@/lib/session";
import { getInstallationToken } from "@/lib/github-app";
import { recordInstallation } from "@/lib/github-installations";
import { decodeGithubFlowState, exchangeUserCode, createUserRepo } from "@/lib/github-user-auth";
import { handOverToGit } from "@/lib/git-handover";
import { appOriginFor } from "@/lib/tenant-host";
import { connectHref } from "@/lib/dashboard-nav";
import { settingsHref } from "@/lib/settings-nav";

/**
 * The GitHub App's **Callback URL** (SPEC §3, §10.11) — and it serves TWO flows, because an
 * App only has one:
 *
 *  1. **Installing the App.** With "request user authorization during installation" enabled,
 *     GitHub sends the installer here (`installation_id` + `setup_action=install`) rather than
 *     to the Setup URL. So this route has to record the installation, or the App ends up
 *     installed on GitHub's side with nothing stored here — indistinguishable from a failure.
 *  2. **One-click repo creation.** `POST /user/repos` needs a *user* access token (documented
 *     Administration: write, UAT only — an installation token cannot), so the owner authorizes
 *     the App to act as them, and we create the repo and hand the site's content over.
 *
 * Which one it is comes from the state's `repo` field, not the URL. The user token is used
 * within this request and never stored: it can create repositories, and one call needs it.
 *
 * Lives under /api/, which middleware passes through WITHOUT the app-host auth gate, so it can
 * be hit with no session — hence the explicit guard.
 */
export const maxDuration = 300;

// The push needs a token that can WRITE to the brand-new repo. A user access token only
// reaches repositories the installation covers, so a repo created seconds ago is only covered
// when the App was installed with "All repositories". Prefer the installation token (the
// durable credential later syncs use), then fall back to the user token.
async function writeToken(
  organizationId: string,
  userToken: string,
): Promise<{ token: string; installationId: number | null }> {
  const [install] = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.organizationId, organizationId))
    .limit(1);
  if (install) {
    const minted = await getInstallationToken(install.installationId);
    if (minted) return { token: minted, installationId: install.installationId };
  }
  return { token: userToken, installationId: null };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const state = decodeGithubFlowState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  const installParam = url.searchParams.get("installation_id");
  const installationId = installParam ? Number(installParam) : NaN;

  // This route only works on the APP host: the session cookie is host-only there by design,
  // so resolve redirects against the app origin rather than `req.url` — a Callback URL set to
  // the apex would otherwise silently strand people on the marketing site.
  const appOrigin =
    appOriginFor(process.env.BETTER_AUTH_URL ?? req.nextUrl.origin) ?? req.nextUrl.origin;
  const to = (path: string, params: Record<string, string> = {}) => {
    const target = new URL(path, appOrigin);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    return NextResponse.redirect(target);
  };

  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession();
  } catch {
    session = null;
  }
  if (!session) {
    // Keep the whole GitHub redirect so signing in RESUMES the flow — otherwise the App is
    // installed on GitHub's side with nothing recorded here.
    const resume = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    return to("/login", { redirect: resume });
  }

  // Authorization comes from the session, never from `state`.
  const orgs = await listOrganizations();
  const org = orgs?.find((o) => !state || o.slug === state.org) ?? orgs?.[0];
  if (!org) return to("/");

  // Where to land: back where the flow started, rebuilt from identifiers (never a path in
  // the state, so this can't become an open redirect).
  const backPath =
    state?.site && (await findSite(org.slug, state.site))
      ? settingsHref(org.slug, state.site, "git")
      : connectHref(org.slug);

  // (1) An install arrived — store it regardless of which flow this is. Doing this before the
  // repo work matters: it's what makes the App usable at all, and the create step below can
  // then mint an installation token for the push.
  if (Number.isInteger(installationId)) {
    await recordInstallation(org.id, installationId);
  }

  // Not the one-click flow — this was just an install. Nothing to create.
  if (!state?.repo) {
    return Number.isInteger(installationId)
      ? to(backPath, { installed: "1" })
      : to(backPath);
  }

  if (!code) {
    // They cancelled on GitHub's authorize screen.
    return to(backPath, { error: "Authorization was cancelled — no repository was created." });
  }

  const site = state.site ? await findSite(org.slug, state.site) : null;
  if (!site) return to(backPath, { error: "That site no longer exists." });

  const exchanged = await exchangeUserCode(code);
  if ("error" in exchanged) return to(backPath, { error: exchanged.error });

  const created = await createUserRepo(exchanged.token, {
    name: state.repo,
    private: Boolean(state.private),
    description: `Documentation for ${site.name}, published with Papervine.`,
  });
  if ("error" in created) return to(backPath, { error: created.error });

  const write = await writeToken(org.id, exchanged.token);
  const handed = await handOverToGit(site, {
    owner: created.owner,
    name: created.name,
    branch: created.defaultBranch,
    token: write.token,
    actorUserId: session.user.id,
    installationId: write.installationId,
  });
  if (!handed.ok) {
    // The repo exists but the content didn't land. Say both, or a retry just hits
    // "repository already exists" with no explanation.
    return to(backPath, {
      error:
        `Created ${created.owner}/${created.name}, but couldn't push your content: ${handed.error} ` +
        `Install the Papervine GitHub App on that repository, then use the manual option.`,
    });
  }

  return to(backPath, { connected: `${created.owner}/${created.name}` });
}
