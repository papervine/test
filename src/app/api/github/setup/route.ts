import { type NextRequest, NextResponse } from "next/server";
import { getSession, listOrganizations } from "@/lib/session";
import { recordInstallation } from "@/lib/github-installations";
import { decodeGithubFlowState } from "@/lib/github-user-auth";
import { findSite } from "@/lib/dashboard-context";
import { appOriginFor } from "@/lib/tenant-host";
import { connectHref } from "@/lib/dashboard-nav";
import { settingsHref } from "@/lib/settings-nav";

/**
 * GitHub App "Setup URL" callback (SPEC §3). After an owner installs the App, GitHub
 * redirects the browser here with ?installation_id&setup_action&state. This route lives
 * on the **app host** (unlike the webhook on the apex) because it needs the session to
 * know which org installed — and the session cookie is host-only on the app host. We tie
 * the installation to the session's org, then return to the connect page.
 */
export async function GET(req: NextRequest) {
  // This route is under /api/, which middleware passes through WITHOUT the app-host auth
  // gate — so unlike a page, it can be hit with no session. listOrganizations() throws an
  // Unauthorized APIError in that case, so guard it: any auth failure → bounce to login
  // (where the gate sends them right back here once signed in).
  // Where the install started, so we can put them back (see encodeInstallState). Decoded
  // before the session check, because it's also what makes the post-login bounce land
  // somewhere useful rather than on the dashboard root.
  const intent = decodeGithubFlowState(req.nextUrl.searchParams.get("state"));

  // This route only functions on the APP host: the Better Auth session cookie is host-only
  // there by design, so on the apex `getSession()` finds nothing and we'd bounce to a login
  // that can't help. Resolve every redirect against the app origin explicitly rather than
  // `req.url`, which is how a misconfigured Setup URL silently dumped people on the apex.
  const appOrigin =
    appOriginFor(process.env.BETTER_AUTH_URL ?? req.nextUrl.origin) ?? req.nextUrl.origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, appOrigin));

  let session: Awaited<ReturnType<typeof getSession>> = null;
  let org: Awaited<ReturnType<typeof listOrganizations>>[number] | undefined;
  try {
    session = await getSession();
    org = (await listOrganizations())?.find((o) => !intent || o.slug === intent.org) ??
      (await listOrganizations())?.[0];
  } catch {
    session = null;
  }
  if (!session || !org) {
    // Keep the whole GitHub redirect (installation_id + state) so signing in resumes the
    // install rather than losing it — otherwise the App is installed on GitHub's side with
    // nothing recorded here, which looks like the install simply didn't work.
    const resume = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    return to(`/login?redirect=${encodeURIComponent(resume)}`);
  }

  // Back where the install was started from: a hosted site's Connect to GitHub page, or the
  // add-site chooser. Rebuilt from identifiers, never from a path in the state.
  const backPath =
    intent?.site && (await findSite(org.slug, intent.site))
      ? settingsHref(org.slug, intent.site, "git")
      : connectHref(org.slug);
  const back = to(backPath);

  const idParam = req.nextUrl.searchParams.get("installation_id");
  const installationId = idParam ? Number(idParam) : NaN;
  // A "request" setup_action (org admin must approve) or a missing id has nothing to
  // store yet — just return to connect; the install webhook/next visit will catch up.
  if (!Number.isInteger(installationId)) return back;

  await recordInstallation(org.id, installationId);

  return back;
}
