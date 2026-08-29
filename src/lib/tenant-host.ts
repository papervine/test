// Pure host→tenant-slug mapping. No imports — safe in edge middleware (must not
// pull in the DB/node deps that tenant.ts uses).
//
// TWO DOMAINS, on purpose (SPEC §2). The *platform* domain carries the marketing apex and
// the control plane (`app.`); the *tenant* domain serves customers' docs sites. They are
// deliberately different registrable domains so that a tenant's own MDX never runs on a
// domain any platform cookie is scoped to — the control-plane session is host-only on
// `app.{platform}`, and even the benign `pv_signed_in` flag is scoped to the platform
// parent domain. Same-registrable-domain hosting is what forced that flag to be httpOnly;
// splitting removes the exposure rather than mitigating it. It also frees the whole
// tenant namespace: `docs`, `www`, `app` and `api` are ordinary slugs on the tenant domain
// because nothing of ours answers there.
//
// Both are configurable so dev/preview/prod can differ, and so this file never becomes the
// place a domain rename has to be hunted down.
// NEXT_PUBLIC_ because client components display these too (the onboarding slug preview
// shows you your future docs URL as you type). They're public domain names, not secrets,
// and one variable each beats keeping a server/client pair in sync.
const PLATFORM_DOMAIN = (
  process.env.NEXT_PUBLIC_PLATFORM_DOMAIN || "papervine.io"
).toLowerCase();
// `.page` is HSTS-preloaded as an entire TLD, so every tenant host is HTTPS-only from the
// moment it exists — no preload submission, and no way to lose it to a misconfiguration.
// (Cookie isolation BETWEEN tenants is a separate matter: that needs the Public Suffix
// List, which is a per-domain submission and is not implied by the TLD.)
const TENANT_DOMAIN = (process.env.NEXT_PUBLIC_TENANT_DOMAIN || "papervine.page").toLowerCase();

// Labels the platform actually SERVES from. Nobody may ever claim these as a custom domain,
// because something of ours already answers there.
const PLATFORM_FUNCTION_LABELS = new Set(["www", "app", "api"]);

// Labels that must never resolve to a TENANT SLUG on a shared-suffix host — `*.localhost` in
// dev (where `app.localhost` is the control plane) and the legacy `*.{platform}` hosts we
// still answer on for old links. On the tenant domain proper nothing collides, so no label
// is reserved there.
//
// `docs` is here but NOT in PLATFORM_FUNCTION_LABELS, and the difference is load-bearing:
// nothing of ours serves `docs.{platform}`, so it must not be read as a tenant subdomain
// (that would drag it into the legacy 308 and bounce it to the tenant domain) — yet the org
// that owns the platform domain can still legitimately claim it as a CUSTOM DOMAIN for one
// of its own sites. Conflating "reserved from slug resolution" with "unclaimable" is exactly
// what made connecting `docs.{platform}` impossible.
const RESERVED = new Set([...PLATFORM_FUNCTION_LABELS, "docs"]);

/**
 * Map a request Host to a tenant slug, or null for the apex/platform host.
 *
 * Canonical tenant hosts are `{slug}.{TENANT_DOMAIN}`; `{slug}.localhost` is the dev
 * equivalent, and `{slug}.{PLATFORM_DOMAIN}` still resolves so links minted before the
 * domain split keep working (middleware redirects those to the canonical host — see
 * `legacyTenantRedirect`). A null return on the apex is also what flips the `/sites/{slug}`
 * route into path-based serving (SPEC §2 "Interim path-based serving").
 *
 * RESERVED applies only to the shared-suffix hosts. On the tenant domain every label is a
 * legal slug, which is what makes `docs.{TENANT_DOMAIN}` an ordinary site we can dogfood.
 */
export function resolveTenantSlug(host: string | null): string | null {
  if (!host) return null;
  const name = host.split(":")[0].toLowerCase();
  const suffixes: Array<{ suffix: string; reserved: boolean }> = [
    { suffix: `.${TENANT_DOMAIN}`, reserved: false },
    { suffix: ".localhost", reserved: true },
    { suffix: `.${PLATFORM_DOMAIN}`, reserved: true },
  ];
  for (const { suffix, reserved } of suffixes) {
    if (name.endsWith(suffix)) {
      const label = name.slice(0, -suffix.length);
      if (!label || label.includes(".")) continue;
      if (reserved && RESERVED.has(label)) continue;
      return label;
    }
  }
  return null;
}

/**
 * A legacy tenant host (`{slug}.{PLATFORM_DOMAIN}`) that should 301 to its canonical home on
 * the tenant domain — returns the new host, or null when the host is already canonical (or
 * isn't a tenant host at all). Keeps every URL minted before the split alive instead of
 * breaking bookmarks and inbound links. Dev (`*.localhost`) is left alone: there's only one
 * local suffix, so there's nothing to migrate to.
 */
export function legacyTenantRedirectHost(host: string | null): string | null {
  if (!host || PLATFORM_DOMAIN === TENANT_DOMAIN) return null;
  const [name, port] = host.split(":");
  const suffix = `.${PLATFORM_DOMAIN}`;
  const lower = name.toLowerCase();
  if (!lower.endsWith(suffix)) return null;
  const label = lower.slice(0, -suffix.length);
  if (!label || label.includes(".") || RESERVED.has(label)) return null;
  const target = `${label}.${TENANT_DOMAIN}`;
  return port ? `${target}:${port}` : target;
}

// Hosts Papervine itself answers on — the apex marketing/control plane and every
// preview/dev surface — as opposed to a tenant's own vanity domain (docs.example.com).
// The tenant domain is OURS even though tenants' content lives on it — it must stay a
// "platform host" or middleware would treat every `{slug}.{TENANT_DOMAIN}` request as a
// candidate vanity domain and try to DB-resolve it as a custom domain.
const PLATFORM_APEXES = new Set([PLATFORM_DOMAIN, TENANT_DOMAIN]);
const PLATFORM_SUFFIXES = [
  ".localhost",
  `.${PLATFORM_DOMAIN}`,
  `.${TENANT_DOMAIN}`,
  ".vercel.app",
];

/**
 * Is this Host one Papervine owns (apex, a tenant subdomain, a preview, a dev/test
 * runner) rather than a tenant's custom domain? The middleware uses it to decide
 * whether to attempt custom-domain resolution: everything that is NOT a platform host
 * is treated as a candidate vanity domain (resolved against `site.customDomain`). Pure
 * + import-free so it stays safe in the edge middleware, like `resolveTenantSlug`.
 */
export function isPlatformHost(host: string | null): boolean {
  if (!host) return true;
  const name = host.split(":")[0].toLowerCase();
  if (!name.includes(".")) return true; // bare label (localhost, app) — never a vanity domain
  if (/^[0-9.]+$/.test(name)) return true; // raw IPv4 (127.0.0.1, CI test runners)
  if (PLATFORM_APEXES.has(name)) return true;
  return PLATFORM_SUFFIXES.some((s) => name.endsWith(s));
}

/**
 * The control-plane host — the authenticated app (dashboard + auth), kept off the apex/
 * docs namespace the way hosted docs platforms uses app-host. `app.localhost` in dev,
 * `app.papervine.io` in prod. Requiring a platform host stops a tenant's own
 * `app.example.com` vanity domain from being mistaken for ours. Pure + import-free so it's
 * safe in the edge middleware.
 */
export function isAppHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return (name === "app" || name.startsWith("app.")) && isPlatformHost(host);
}

/**
 * The parent domain a cookie should scope to so it's readable across the apex + app host:
 * `app.papervine.io` → `papervine.io`, `app.localhost` → `localhost`. Used only for the
 * benign "signed in" hint (a boolean, never the session token — see SPEC §10), so the
 * marketing apex can show a Dashboard link without the session cookie leaving the app host.
 */
export function parentDomain(host: string): string {
  const name = host.split(":")[0];
  const parts = name.split(".");
  return parts.length <= 1 ? name : parts.slice(1).join(".");
}

/**
 * The app host for a given request host: `app.{apexBase}` (carrying the dev port). Strips
 * a leading `www`/`app` label so a link built on the marketing apex points at the control
 * plane — `papervine.io`/`www.papervine.io` → `app.papervine.io`, `localhost:3000` →
 * `app.localhost:3000`.
 */
export function appHostFor(host: string): string {
  const [name, port] = host.split(":");
  const base = name.replace(/^(www|app)\./, "");
  return port ? `app.${base}:${port}` : `app.${base}`;
}

/**
 * The host whose site backs the marketing home's live demo: `docs.` on the apex the request
 * came in on (`papervine.io` / `www.papervine.io` → `docs.papervine.io`, `localhost:3000` →
 * `docs.localhost`). Convention instead of configuration — there is no env var to set, and
 * the demo simply degrades to links when no such site exists (see lib/home-demo.ts).
 *
 * The PORT IS DROPPED, because this is a `custom_domain` lookup key, not a URL to fetch:
 * `getSiteByCustomDomain` normalizes the port away too, and the dogfood site's stored domain
 * is `docs.papervine.io`. Note that in dev `docs.localhost` isn't *servable* (it's RESERVED,
 * so it's neither a tenant subdomain nor routed as a custom domain, and it renders the
 * marketing apex) — it works purely as the column value the seed writes. That's enough for
 * the demo, whose widget calls `/api/widget/{id}/chat` on the apex rather than that host.
 */
export function demoDocsHost(requestHost: string): string {
  const name = requestHost.split(":")[0].toLowerCase();
  return `docs.${name.replace(/^(www|app)\./, "")}`;
}

/**
 * The control plane's ORIGIN for a configured apex origin: `https://papervine.io` →
 * `https://app.papervine.io`, `http://localhost:3000` → `http://app.localhost:3000`.
 *
 * `BETTER_AUTH_URL` names the apex, but every link we put in an *email* has to land on the
 * app host: verification and password-reset callbacks set session cookies, and those cookies
 * are host-only on `app.` (SPEC §10). A link to the apex would hand the browser a cookie on
 * the wrong host, or bounce through a redirect that drops the token. Emailed links have no
 * Google-style registration constraint forcing them onto the apex — unlike the OAuth callback
 * (see `oauthCallbackURI`) — so they go straight to the app host.
 *
 * Returns null for an unparseable input rather than throwing: a missing/typo'd
 * `BETTER_AUTH_URL` should disable email links with a warning, not crash the auth config at
 * import time.
 */
export function appOriginFor(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    url.host = appHostFor(url.host);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Can tenants be served as `{slug}.{apexBase}` subdomains on this apex host? True only
 * for hosts the resolver actually recognizes (`papervine.io`, `localhost`) — NOT a bare
 * `*.vercel.app`, where nested-subdomain TLS isn't issued and the resolver wouldn't
 * match the suffix anyway. When false, link tenants via the path form (`/sites/{slug}`).
 * Probes the resolver itself so this can never drift from the real routing rules.
 */
export function supportsSubdomainTenants(apexBase: string): boolean {
  return resolveTenantSlug(`probe.${apexBase}`) === "probe";
}

/**
 * The host a tenant's docs are served on, given the CURRENT request's host.
 *
 * This exists because the old rule — "strip `app.`/`www.` off the request host and use
 * what's left" — is wrong the moment tenants live on their own domain: a dashboard request
 * arrives on `app.{PLATFORM_DOMAIN}` and would derive `{slug}.{PLATFORM_DOMAIN}`, the
 * legacy host. The tenant domain is configuration, not something to infer from whoever is
 * asking.
 *
 * Dev is the exception and is inferred deliberately: everything local shares `.localhost`
 * (there is no second local registrable domain to split onto), so a request on
 * `app.localhost:3000` yields `{slug}.localhost:3000` and keeps the port. This is also why
 * the domain split is NOT exercised locally — cookie isolation between the control plane
 * and tenant content only materialises in an environment with two real domains.
 *
 * Returns a bare host (no scheme); callers add the protocol they need.
 */
export function tenantHostFor(slug: string, requestHost: string | null): string {
  const [name = "", port] = (requestHost ?? "").split(":");
  const base = name.toLowerCase().replace(/^(www|app)\./, "");
  // Local/preview hosts have no separate tenant domain — stay on the host we're serving from.
  if (base === "localhost" || base.endsWith(".localhost") || base.endsWith(".vercel.app")) {
    return port ? `${slug}.${base}:${port}` : `${slug}.${base}`;
  }
  return `${slug}.${TENANT_DOMAIN}`;
}

/** The configured domains, for callers that need to name them (docs copy, DNS guidance). */
export const domains = { platform: PLATFORM_DOMAIN, tenant: TENANT_DOMAIN } as const;

/**
 * Hosts that are STRUCTURALLY ours and can therefore never be a site's custom domain:
 * the platform apex and its function labels (`www`/`app`/`api`), anything on the tenant
 * domain (those are tenant subdomains — serving one as somebody's "custom domain" would be
 * a hijack), and the local/preview hosts.
 *
 * Deliberately narrower than `isPlatformHost`. That one answers "is this host ours?" and is
 * right for routing. Using it to decide *claimability* conflated two different questions and
 * banned every host under the platform domain — including `docs.{platform}`, which the org
 * that owns the platform domain has every right to point at one of its own sites. Ownership
 * of a host on our own domain is an authorization question (see `requiresOperator` in
 * custom-domain.ts), not a structural one.
 */
export function isReservedPlatformHost(host: string | null): boolean {
  if (!host) return true;
  const name = host.split(":")[0].toLowerCase();
  if (!name.includes(".")) return true; // bare label (localhost, app)
  if (/^[0-9.]+$/.test(name)) return true; // raw IPv4
  if (name === PLATFORM_DOMAIN || name === TENANT_DOMAIN) return true;
  if (name.endsWith(`.${TENANT_DOMAIN}`)) return true; // tenant subdomains
  if (name.endsWith(".localhost") || name.endsWith(".vercel.app")) return true;
  if (name.endsWith(`.${PLATFORM_DOMAIN}`)) {
    const label = name.slice(0, -`.${PLATFORM_DOMAIN}`.length);
    // Function labels only — `docs.{platform}` is claimable (see RESERVED's comment).
    return label.includes(".") || PLATFORM_FUNCTION_LABELS.has(label);
  }
  return false;
}

/** Is this host on the domain WE own — i.e. claiming it requires being the operator? */
export function isOnPlatformDomain(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return name === PLATFORM_DOMAIN || name.endsWith(`.${PLATFORM_DOMAIN}`);
}
