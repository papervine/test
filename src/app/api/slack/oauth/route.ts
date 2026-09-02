import { type NextRequest, NextResponse } from "next/server";
import { getSession, listOrganizations } from "@/lib/session";
import { decodeSlackInstallState, exchangeSlackCode } from "@/lib/slack";
import { recordSlackInstall } from "@/lib/slack-workspaces";
import { findSite } from "@/lib/dashboard-context";
import { appOriginFor } from "@/lib/tenant-host";
import { siteHref } from "@/lib/dashboard-nav";

/**
 * Slack OAuth v2 redirect URL (SPEC §10.2). After a workspace admin approves the app,
 * Slack sends the browser here with ?code&state. Lives on the **app host** for the same
 * reason as /api/github/setup: it needs the session cookie (host-only there) to know
 * which org is installing — the state alone is never trusted as authorization, only as
 * "which agent page did this start from".
 */
export async function GET(req: NextRequest) {
  const state = decodeSlackInstallState(req.nextUrl.searchParams.get("state"));

  // Resolve every redirect against the app origin explicitly, not req.url — the
  // misconfigured-callback-dumps-you-on-the-apex lesson from the GitHub setup route.
  const appOrigin =
    appOriginFor(process.env.BETTER_AUTH_URL ?? req.nextUrl.origin) ?? req.nextUrl.origin;
  const to = (path: string) => NextResponse.redirect(new URL(path, appOrigin));

  let session: Awaited<ReturnType<typeof getSession>> = null;
  let org: Awaited<ReturnType<typeof listOrganizations>>[number] | undefined;
  try {
    session = await getSession();
    const orgs = await listOrganizations();
    org = orgs?.find((o) => !state || o.slug === state.org) ?? orgs?.[0];
  } catch {
    session = null;
  }
  if (!session || !org) {
    // Keep the whole Slack redirect (code + state) so signing in resumes the install —
    // Slack authorization codes are single-use but short-lived enough to survive a login.
    const resume = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    return to(`/login?redirect=${encodeURIComponent(resume)}`);
  }

  // Back to the agent page the install started from (identifiers re-validated, never a
  // path from the state). No resolvable site → the org dashboard root.
  const backPath =
    state?.site && (await findSite(org.slug, state.site))
      ? siteHref(org.slug, state.site, "automate/agent")
      : `/${org.slug}`;
  const back = (params?: Record<string, string>) => {
    const url = new URL(backPath, appOrigin);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  // The admin hit Cancel on Slack's consent screen (?error=access_denied) — not a
  // failure worth alarming about, just land back on the page.
  if (req.nextUrl.searchParams.get("error")) return back();

  const code = req.nextUrl.searchParams.get("code");
  // A missing/expired state also lands here: without it we can't trust which org+site
  // the flow was bound to, so don't record anything — reinstalling takes one click.
  if (!code || !state) return back({ slack: "state_expired" });

  // redirect_uri must match the authorize step verbatim — both derive it from
  // slackRedirectUri(), so it can't drift.
  const result = await exchangeSlackCode(code);
  if ("error" in result) return back({ slack: "error" });

  await recordSlackInstall(org.id, result, session.user?.id);
  return back({ slack: "connected" });
}
