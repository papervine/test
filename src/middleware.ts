import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { resolveTenantSlug, isPlatformHost } from "./lib/tenant-host";

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

/**
 * Custom domains resolve to a site by a DB lookup, which can't run in the edge
 * middleware — so instead of resolving the slug here, we forward the raw Host and let
 * the node `/_domain` route (and the by-host asset/identity handlers) do the lookup.
 */
function withHost(req: NextRequest, host: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-papervine-host", host);
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

    // Agent surfaces (SPEC §9.1/§10.1) also serve directly on the tenant host: the
    // /mcp server and the llms.txt index resolve the tenant from the host (and the
    // x-papervine-site header), and they log agent analytics. Stamp the slug so they
    // read the right content source, but don't rewrite them under /sites/{slug}.
    if (
      pathname === "/mcp" ||
      pathname === "/llms.txt" ||
      pathname === "/llms-full.txt"
    ) {
      return NextResponse.next(withSite(req, tenant));
    }
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

  // Custom (vanity) domains (SPEC §2): any host that isn't one of ours is a candidate
  // domain a tenant pointed at us. We can't DB-resolve the slug at the edge, so forward
  // the Host and route by it on the node side — docs → /custom-domain, assets → the
  // by-host asset handler, and the agent/API surfaces resolve the site from the Host
  // themselves. An unknown host (no matching site) simply 404s in those node handlers.
  const host = req.headers.get("host");
  if (host && !isPlatformHost(host) && !process.env.PAPERVINE_CONTENT) {
    if (pathname.startsWith("/api/")) return NextResponse.next(withHost(req, host));
    if (
      pathname === "/mcp" ||
      pathname === "/llms.txt" ||
      pathname === "/llms-full.txt"
    ) {
      return NextResponse.next(withHost(req, host));
    }
    const url = req.nextUrl.clone();
    url.pathname = ASSET_RE.test(pathname)
      ? `/api/tenant-asset-by-host${pathname}`
      : `/custom-domain${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url, withHost(req, host));
  }

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
