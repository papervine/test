import { NextResponse, type NextRequest } from "next/server";
import { getSiteByHost, getSiteBySlug } from "@/lib/tenant";
import { logEvent } from "@/lib/track";

/**
 * Search-intent beacon (SPEC §10.1). `POST /api/search/track` with `{ q, site }`.
 *
 * The reader's search box calls this (via `fetch` keepalive / `sendBeacon`) when a
 * query *settles* or a result is picked — one event per search the user meant, not
 * one per keystroke-prefix. Result fetching (`/api/search`) no longer logs. As with
 * search, the `site` slug wins (path mode hits the apex host, so the Host header
 * can't identify the tenant); otherwise fall back to the Host header (subdomain mode).
 */
export async function POST(req: NextRequest) {
  let body: { q?: string; site?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty/invalid body — nothing to log
  }
  const q = (body.q ?? "").trim();
  if (!q) return NextResponse.json({ ok: true });

  const site = body.site
    ? await getSiteBySlug(body.site)
    : await getSiteByHost(req.headers.get("host"));
  if (site) await logEvent({ siteId: site.id, type: "search", source: "human", query: q });

  return NextResponse.json({ ok: true });
}
