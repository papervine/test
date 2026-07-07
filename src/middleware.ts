import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  resolveTenantSlug,
  isPlatformHost,
  isAppHost,
  appHostFor,
  parentDomain,
} from "./lib/tenant-host";
import { SIGNED_IN_FLAG } from "./lib/signed-in-flag";

// Bare control-plane paths that keep their own URL on the app host (real routes, not
// rewritten onto /app): the auth pages.
function isAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/onboarding"
  );
}

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
  const reqHost = req.headers.get("host");

  // Control-plane host (SPEC §10): the authenticated app lives on app.{apex} at bare
  // /:org/:site, so the apex/tenant namespace stays free for docs. The route files live
  // under an invisible /app mount (no bare [org] at the root, which would shadow the docs
  // catch-all), so we rewrite bare → /app here — the same Host-rewrite trick tenant docs
  // use (→ /sites/{slug}). Auth pages, API, and assets keep their real paths.
  if (isAppHost(reqHost)) {
    const authed = Boolean(getSessionCookie(req));
    const hasFlag = Boolean(req.cookies.get(SIGNED_IN_FLAG));

    // Keep the *benign* "signed in" hint in sync so the marketing apex can show a Dashboard
    // link — a boolean, NEVER the session token (which stays host-only on the app host;
    // sharing it would expose it to every tenant docs subdomain, SPEC §10). It's a
    // parent-domain cookie, so it DOES reach tenant subdomains — hence httpOnly (tenant page
    // JS can't read it; only our servers ever see it) + Secure in prod. Cleared here on
    // logout rather than client-side, since client JS can't touch an httpOnly cookie.
    const syncFlag = (res: NextResponse) => {
      const domain = parentDomain(reqHost!);
      const secure = req.nextUrl.protocol === "https:";
      if (authed && !hasFlag) {
        res.cookies.set(SIGNED_IN_FLAG, "1", {
          domain,
          path: "/",
          sameSite: "lax",
          httpOnly: true,
          secure,
        });
      } else if (!authed && hasFlag) {
        res.cookies.set(SIGNED_IN_FLAG, "", { domain, path: "/", maxAge: 0 });
      }
      return res;
    };

    if (
      pathname.startsWith("/api/") ||
      pathname.startsWith("/app/") || // already internal (defensive; links are bare)
      pathname === "/app" ||
      ASSET_RE.test(pathname)
    ) {
      return syncFlag(NextResponse.next());
    }
    // Accept-invitation keeps its own bare URL and is reachable signed-OUT (to view it / sign
    // up) AND signed-IN (you accept WITH a session) — so unlike the auth pages it neither
    // bounces a signed-in user to the dashboard nor rewrites onto /app. The page handles each
    // state itself (SPEC §10 invitations).
    if (pathname === "/accept-invite") {
      return syncFlag(NextResponse.next());
    }
    if (isAuthPath(pathname)) {
      // Already logged in? Skip the auth form and go to the dashboard — the way
      // the app-host signup flow bounces a signed-in user straight to their workspace.
      // EXCEPT /onboarding, which exists FOR the just-signed-in: the dashboard resolver
      // (app/page.tsx) redirects org-less users here, so bouncing authed users back to
      // "/" made every fresh signup loop (ERR_TOO_MANY_REDIRECTS) — the bug that broke
      // the e2e auth.setup flow and real first-run onboarding alike.
      if (authed && pathname !== "/onboarding") {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        return syncFlag(NextResponse.redirect(url));
      }
      return syncFlag(NextResponse.next());
    }

    // Cheap edge cookie gate — the [org] layout does the authoritative session check.
    if (!authed) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return syncFlag(NextResponse.redirect(url));
    }

    // Bare → invisible /app mount. `/` → the resolver, which forwards to the first site.
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? "/app" : `/app${pathname}`;
    return syncFlag(NextResponse.rewrite(url));
  }

  // The control plane only answers on the app host: if its paths are hit on the apex
  // (an old link, or /app typed directly), bounce to the app host so the session cookie
  // is set there, not on the marketing apex. Skipped in single-repo preview mode, which
  // has no control plane. Public URLs are bare, so strip the internal /app prefix.
  //
  // Guard with `!resolveTenantSlug`: `isPlatformHost` is true for tenant subdomains too
  // (`{slug}.localhost` / `{slug}.papervine.io` — they're ours, not vanity domains), but on
  // a tenant host `/login` is the *reader* login (→ sites/{slug}/login below), NOT a control-
  // plane path. Without this guard the bounce hijacks it to `app.{slug}.localhost/login` (the
  // Papervine account login), so reader auth never reaches its own login card in subdomain mode.
  if (
    isPlatformHost(reqHost) &&
    !resolveTenantSlug(reqHost) &&
    !process.env.PAPERVINE_CONTENT &&
    (isAuthPath(pathname) || pathname === "/app" || pathname.startsWith("/app/"))
  ) {
    const url = req.nextUrl.clone();
    url.host = appHostFor(reqHost!);
    url.pathname =
      pathname === "/app" ? "/" : pathname.startsWith("/app/")
        ? pathname.slice("/app".length)
        : pathname;
    return NextResponse.redirect(url);
  }

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

  // (The control plane is gated on the app host above; the apex only serves marketing +
  // docs.)
  return NextResponse.next();
}

export const config = {
  // Skip Next internals; everything else is checked against ASSET_RE above.
  matcher: ["/((?!_next/|dbasset/).*)"],
};
