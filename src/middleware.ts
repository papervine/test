import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { resolveTenantSlug } from "./lib/tenant-host";

/**
 * Docs assets (images, fonts, video) are referenced by absolute path from the
 * repo root — e.g. `/img/hero.png`, `/logo/dark.svg`. Without this, those
 * requests fall through to the `[[...slug]]` page route, find no MDX file, and
 * 404 (broken images). We rewrite any request that ends in a static-asset
 * extension to the `dbasset` handler, which streams it from PAPERVINE_CONTENT.
 */
const ASSET_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

/**
 * Forward the resolved tenant slug to the render as a request header, so server
 * components (the root layout especially) can pick the right content source without
 * re-resolving the host. Returns the option bag NextResponse.rewrite/next accept.
 */
function withSite(req: NextRequest, slug: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-papervine-site", slug);
  return { request: { headers: requestHeaders } };
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Multi-tenant host routing (SPEC §2): a tenant subdomain ({slug}.papervine.io,
  // or {slug}.localhost in dev) serves that tenant's docs. Rewrite the whole host
  // to /_sites/{slug}/… and let that route resolve the site + fetch its content.
  // (Per-tenant asset/dashboard handling is apex-only for now.)
  const tenant = resolveTenantSlug(req.headers.get("host"));
  if (tenant) {
    // API routes (search, assistant, events beacon) serve directly on the tenant
    // host — they resolve the site from the Host header. Rewriting them under
    // /sites/{slug} would 404. Everything else is docs.
    if (pathname.startsWith("/api/")) return NextResponse.next();
    const url = req.nextUrl.clone();
    // Assets (images/fonts/…) stream from the tenant's synced bucket; everything
    // else is a docs page.
    url.pathname = ASSET_RE.test(pathname)
      ? `/api/tenant-asset/${tenant}${pathname}`
      : `/sites/${tenant}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url, withSite(req, tenant));
  }

  // Apex path-mode docs (`/sites/{slug}/…`, the interim for hosts without a wildcard
  // domain). Stamp the tenant slug so the root layout — which renders before the route
  // sets contentContext — resolves the same content source the page will, instead of
  // priming React's per-request cache with the default content/ config. See
  // requestContentSource() for the full why.
  const pathSite = pathname.match(/^\/sites\/([^/]+)(?:\/|$)/)?.[1];
  if (pathSite) return NextResponse.next(withSite(req, pathSite));

  // SaaS apex front door: serve the marketing landing at / (SPEC §2). In single-repo
  // preview mode (PAPERVINE_CONTENT set — `papervine dev` / tests) the apex keeps serving the
  // previewed repo's home instead.
  if (pathname === "/" && !process.env.PAPERVINE_CONTENT) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.rewrite(url);
  }

  // Apex static assets stream from PAPERVINE_CONTENT — but not `/api/…`, which includes
  // path-mode tenant assets (`/api/tenant-asset/{slug}/img.png`) that must reach their
  // route handler, not the dbasset reader.
  if (ASSET_RE.test(pathname) && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = `/dbasset${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Control-plane gate: cheap edge cookie check (no DB) — the (app) layout does
  // the authoritative session validation and the org/onboarding redirects.
  if (pathname.startsWith("/dashboard")) {
    if (!getSessionCookie(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals; everything else is checked against ASSET_RE above.
  matcher: ["/((?!_next/|dbasset/).*)"],
};
