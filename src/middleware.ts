import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  resolveTenantSlug,
  isAppHost,
  appHostFor,
  parentDomain,
  legacyTenantRedirectHost,
  isReservedPlatformHost,
} from "./lib/tenant-host";
import { SIGNED_IN_FLAG } from "./lib/signed-in-flag";
import { isOAuthCallbackPath } from "./lib/social-auth";
import { setLlmsDiscoveryHeaders } from "@papervine/renderer/lib/llms-discovery";

// Bare control-plane paths that keep their own URL on the app host (real routes, not
// rewritten onto /app): the auth pages.
function isAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/onboarding" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
  );
}

// Auth paths that must NOT bounce a signed-in visitor to the dashboard. `/onboarding` is where
// the resolver *sends* org-less users (bouncing looped every fresh signup). The password pages
// are reached from an emailed link, and the person clicking it very often still has a live
// session — bouncing them to the dashboard would make a reset link unusable for exactly the
// people who need it (a shared machine, a suspected compromise).
function isAuthPathReachableWhenSignedIn(pathname: string): boolean {
  return (
    pathname === "/onboarding" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
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

// Sentry's tunnel route (next.config.mjs `tunnelRoute`). The browser POSTs error/perf events
// here so they aren't blocked by ad blockers — but it is a ROOT route, and every rewritten host
// class below would send it somewhere that doesn't exist: `/app/monitoring` on the app host,
// `/sites/{slug}/monitoring` on a tenant subdomain, `/custom-domain/monitoring` on a custom
// domain. All three 404, so Sentry silently dropped every report from the dashboard AND from
// every tenant docs site — i.e. from everywhere except the marketing apex, which is the one
// place errors matter least. It resolves the DSN itself and needs no tenant context, so it
// passes straight through untouched.
const SENTRY_TUNNEL = "/monitoring";

/**
 * The AI-discovery surfaces (SPEC §9.1/§10.1). Like the Sentry tunnel these are ROOT paths
 * that resolve the tenant from the Host themselves, so they must NOT be rewritten under
 * `/sites/{slug}` or `/custom-domain` — they're stamped with the tenant and passed through.
 * `.well-known/*` is included for exactly that reason: rewritten, it would 404 on every
 * tenant host and only work on the apex, which is the one host no reader is looking at.
 */
function isAgentSurface(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname === "/llms.txt" ||
    pathname === "/llms-full.txt" ||
    pathname === "/.well-known/llms.txt" ||
    pathname === "/.well-known/llms-full.txt" ||
    // skill.md and its discovery endpoints (SPEC §9.1). Prefix matches, not equality, because
    // each skill is addressed individually under these directories. `/skill.md` also has to be
    // named here explicitly for a second reason: it ends in `.md`, so without this it would be
    // caught by the page-Markdown-twin rewrite below and looked up as a docs page called
    // "skill" — which is exactly the page `isPageSlug` now refuses to serve.
    pathname === "/skill.md" ||
    pathname === "/.well-known/agent-card.json" ||
    pathname.startsWith("/.well-known/agent-skills/") ||
    pathname.startsWith("/.well-known/skills/")
  );
}

/**
 * Every page also serves its Markdown source at `<path>.md` — what /llms.txt links to, so
 * an agent following a link gets prose instead of a React render. The route tree can't match
 * on an extension, so the mapping is here: `/guides/auth.md` → `/api/page-md/guides/auth`.
 * Ordered BEFORE the asset check on every host, since `.md` is a page, not an asset.
 */
const PAGE_MD_RE = /\.md$/i;

function pageMdPath(pathname: string): string {
  return `/api/page-md/${pathname.replace(/^\//, "").replace(PAGE_MD_RE, "")}`;
}

/**
 * Advertise /llms.txt on a docs *page* response. The headers only help if they're on the
 * response a client already fetched, which for the rewritten host classes means here — the
 * page render itself never sees the original path.
 */
function withLlmsDiscovery(res: NextResponse): NextResponse {
  setLlmsDiscoveryHeaders(res.headers);
  return res;
}

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

/**
 * Clear Better Auth's session cookies + the signed-in flag on `res`. Used by the stale-session
 * self-heal: when a session cookie is present but the server-side check found it invalid, the
 * lingering cookie must be cleared or the presence-only edge bounce loops /login → / → /login.
 * Better Auth's cookies are `<prefix>.session_token` / `.session_data` (with a `__Secure-` prefix
 * when secure), so match by suffix to catch both prefixes.
 */
function clearAuthCookies(req: NextRequest, res: NextResponse, host: string) {
  for (const c of req.cookies.getAll()) {
    if (/\.session_token$|\.session_data$/.test(c.name)) {
      res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
    }
  }
  if (req.cookies.get(SIGNED_IN_FLAG)) {
    res.cookies.set(SIGNED_IN_FLAG, "", { domain: parentDomain(host), path: "/", maxAge: 0 });
  }
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
      pathname === SENTRY_TUNNEL ||
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
      // Stale-session self-heal: the app-side check (getSession → null) redirects here with
      // ?stale=1 when a session COOKIE is present but INVALID (expiry, a revoke, a dev DB
      // reset). Clear the lingering cookie(s) + flag and render the login page — otherwise the
      // presence-only bounce below sends /login → / → (invalid) → /login forever
      // (ERR_TOO_MANY_REDIRECTS). syncFlag is skipped: we've just cleared the flag ourselves.
      if (authed && req.nextUrl.searchParams.get("stale") === "1") {
        const res = NextResponse.next();
        clearAuthCookies(req, res, reqHost!);
        return res;
      }
      // Already logged in? Skip the auth form and go to the dashboard — the way
      // the app-host signup flow bounces a signed-in user straight to their workspace.
      // EXCEPT the paths that exist FOR the signed-in: /onboarding (the dashboard resolver
      // redirects org-less users here, so bouncing authed users back to "/" made every fresh
      // signup loop with ERR_TOO_MANY_REDIRECTS) and the password-reset pages.
      if (authed && !isAuthPathReachableWhenSignedIn(pathname)) {
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
  // Two guards, and both are load-bearing.
  //
  // `!resolveTenantSlug`: reserved-platform hosts include tenant subdomains
  // (`{slug}.localhost` / `{slug}.papervine.page` — they're ours, not vanity domains), but on
  // a tenant host `/login` is the *reader* login (→ sites/{slug}/login below), NOT a control-
  // plane path. Without this guard the bounce hijacks it to `app.{slug}.localhost/login` (the
  // Papervine account login), so reader auth never reaches its own login card in subdomain mode.
  //
  // `isReservedPlatformHost`, NOT `isPlatformHost`: the latter is true for *every* host under
  // our own domain, including one an operator has claimed as a site's custom domain. That
  // sent `docs.papervine.io/login` to `app.docs.papervine.io/login` — a host that does not
  // exist, so the browser got ERR_CONNECTION_CLOSED. Only the platform's genuine front-door
  // hosts (the apex and its `www`/`app`/`api` labels) should bounce; a host serving a
  // tenant's docs must keep its own auth paths, which is exactly what reader auth needs.
  //
  // Social sign-in callbacks ride the same bounce (SPEC §10.1). The OAuth redirect URI is
  // registered on the APEX because Google refuses one on a subdomain of localhost, so dev
  // could otherwise never exercise the flow — see oauthCallbackURI. The provider sends the
  // browser to `papervine.io/api/auth/callback/google?code=…&state=…`; forwarding it (query
  // intact) to the app host is what puts the request back where the PKCE/state cookie was
  // set — those cookies are host-only on `app.`, so exchanging the code on the apex would
  // always fail. A redirect, not a rewrite: the browser has to re-send its cookies.
  if (
    isReservedPlatformHost(reqHost) &&
    !resolveTenantSlug(reqHost) &&
    !process.env.PAPERVINE_CONTENT &&
    (isAuthPath(pathname) ||
      isOAuthCallbackPath(pathname) ||
      pathname === "/app" ||
      pathname.startsWith("/app/"))
  ) {
    const url = req.nextUrl.clone();
    url.host = appHostFor(reqHost!);
    url.pathname =
      pathname === "/app" ? "/" : pathname.startsWith("/app/")
        ? pathname.slice("/app".length)
        : pathname;
    return NextResponse.redirect(url);
  }

  // Tenant docs moved to their own registrable domain (SPEC §2 — so customer-authored
  // content never runs on a domain our cookies are scoped to). Old `{slug}.{platform}`
  // URLs are already in bookmarks, README links and search indexes, so send them to the
  // canonical host with a permanent redirect rather than breaking them. Path, query and
  // hash ride along. Only genuine tenant labels redirect — `app.`/`www.`/`api.`/`docs.` on
  // the platform domain are ours and fall through to the handling below.
  const legacyHost = legacyTenantRedirectHost(req.headers.get("host"));
  if (legacyHost && !process.env.PAPERVINE_CONTENT) {
    const url = req.nextUrl.clone();
    url.host = legacyHost.split(":")[0];
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  // Multi-tenant host routing (SPEC §2): a tenant subdomain ({slug}.papervine.page,
  // {slug}.localhost in dev, or a legacy {slug}.papervine.io that hasn't redirected yet)
  // serves that tenant's docs. Rewrite the whole host to /_sites/{slug}/… and let that
  // route resolve the site + fetch its content.
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
    if (pathname === SENTRY_TUNNEL) return NextResponse.next();
    if (isAgentSurface(pathname)) return NextResponse.next(withSite(req, tenant));
    if (PAGE_MD_RE.test(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = pageMdPath(pathname);
      return NextResponse.rewrite(url, withSite(req, tenant));
    }
    const url = req.nextUrl.clone();
    // Assets (images/fonts/…) stream from the tenant's synced bucket; everything
    // else is a docs page.
    const isAsset = ASSET_RE.test(pathname);
    url.pathname = isAsset
      ? `/api/tenant-asset/${tenant}${pathname}`
      : `/sites/${tenant}${pathname === "/" ? "" : pathname}`;
    const res = NextResponse.rewrite(url, withSite(req, tenant));
    return isAsset ? res : withLlmsDiscovery(res);
  }

  // Apex path-mode docs (`/sites/{slug}/…`, the interim for hosts without a wildcard
  // domain). Stamp the tenant slug so the root layout — which renders before the route
  // sets contentContext — resolves the same content source the page will, instead of
  // priming React's per-request cache with the default content/ config. See
  // requestContentSource() for the full why.
  const pathSite = pathname.match(/^\/sites\/([^/]+)(?:\/|$)/)?.[1];
  if (pathSite) {
    // `.md` is a page twin, not a docs route — send it to the handler with the slug stripped
    // out of the path, since it resolves the tenant from the stamped header like every other
    // agent surface.
    if (PAGE_MD_RE.test(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = pageMdPath(pathname.slice(`/sites/${pathSite}`.length) || "/index.md");
      return NextResponse.rewrite(url, withSite(req, pathSite));
    }
    return withLlmsDiscovery(NextResponse.next(withSite(req, pathSite)));
  }

  // Custom (vanity) domains (SPEC §2): any host that isn't STRUCTURALLY ours is a candidate
  // domain someone pointed at us. We can't DB-resolve the slug at the edge, so forward
  // the Host and route by it on the node side — docs → /custom-domain, assets → the
  // by-host asset handler, and the agent/API surfaces resolve the site from the Host
  // themselves. An unknown host (no matching site) simply 404s in those node handlers.
  //
  // `isReservedPlatformHost`, not `isPlatformHost`: the latter is true for every host under
  // our own domain, which would mean a legitimately-claimed `docs.{platform}` saved fine in
  // settings and then never routed — it would fall through to the marketing apex. Function
  // hosts (apex, `app.`, `www.`, `api.`) and tenant subdomains are still excluded, and the
  // tenant-subdomain branch above has already returned for those.
  const host = req.headers.get("host");
  if (host && !isReservedPlatformHost(host) && !process.env.PAPERVINE_CONTENT) {
    if (pathname.startsWith("/api/")) return NextResponse.next(withHost(req, host));
    if (pathname === SENTRY_TUNNEL) return NextResponse.next();
    if (isAgentSurface(pathname)) return NextResponse.next(withHost(req, host));
    if (PAGE_MD_RE.test(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = pageMdPath(pathname);
      return NextResponse.rewrite(url, withHost(req, host));
    }
    const url = req.nextUrl.clone();
    const isAsset = ASSET_RE.test(pathname);
    url.pathname = isAsset
      ? `/api/tenant-asset-by-host${pathname}`
      : `/custom-domain${pathname === "/" ? "" : pathname}`;
    const res = NextResponse.rewrite(url, withHost(req, host));
    return isAsset ? res : withLlmsDiscovery(res);
  }

  // SaaS apex front door: serve the marketing landing at / (SPEC §2). In single-repo
  // preview mode (PAPERVINE_CONTENT set — `papervine dev` / tests) the apex keeps serving the
  // previewed repo's home instead.
  if (pathname === "/" && !process.env.PAPERVINE_CONTENT) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.rewrite(url);
  }

  // Apex `.md` page twins. On the apex this matters most in single-repo preview mode
  // (`papervine dev` / the published CLI), which is where the docs being previewed live.
  //
  // `isAgentSurface` is checked FIRST because two of those surfaces end in `.md` — `/skill.md`
  // and `/.well-known/agent-skills/{name}/SKILL.md`. Without this they are rewritten to the
  // page-Markdown twin and looked up as docs pages named "skill" and ".well-known/…", which is
  // exactly the page `isPageSlug` refuses to serve: the route exists, the file exists, and the
  // request 404s anyway.
  if (!isAgentSurface(pathname) && PAGE_MD_RE.test(pathname) && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = pageMdPath(pathname);
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
  // docs.) The apex serves its own /llms.txt — from the previewed repo in single-repo mode,
  // from `content/` otherwise — so advertising it here is truthful on both.
  return withLlmsDiscovery(NextResponse.next());
}

export const config = {
  // Skip Next internals; everything else is checked against ASSET_RE above.
  matcher: ["/((?!_next/|dbasset/).*)"],
};
