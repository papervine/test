import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { findSite } from "@/lib/dashboard-context";
import { getActivityFeed } from "@/lib/activity-feed";
import { parseFeedTarget } from "@/lib/overview";

// Live Activity feed endpoint (SPEC §10.3): the Overview's client feed polls this for the
// same `deployment`-backed rows the page server-rendered, so a webhook sync that lands while
// you're looking at the page shows up (and resolves building → successful) without a reload.
// Bare URL `/:org/:site/activity` — the app-host middleware rewrites it onto this /app mount,
// the same way the page route is reached. Authorized exactly like the page: session → org
// membership → org-scoped site (findSite), so one tenant can't read another's feed.
//
// 401 vs 404 is deliberate: a signed-out poll (cookie expired in a backgrounded tab) gets
// 401 so the client stops hammering, while a missing/forbidden site gets an indistinct 404.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ org: string; site: string }> },
) {
  const { org, site } = await params;

  if (!(await getSession())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const row = await findSite(org, site);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const target = parseFeedTarget(
    req.nextUrl.searchParams.get("feed") ?? undefined,
  );
  const rows = await getActivityFeed(row.id, target);
  return NextResponse.json(
    { rows },
    { headers: { "cache-control": "no-store" } },
  );
}
