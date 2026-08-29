// Which site backs the marketing home's "Ask" demo (SPEC §2). Server-only: it hits the site
// table, and the home page renders on the apex where that table may not even be reachable.
import "server-only";
import { getSiteByHost, getSiteBySlug } from "./tenant";
import { demoDocsHost, supportsSubdomainTenants, tenantHostFor } from "./tenant-host";
import { isOriginAllowed } from "./widget";

export type HomeDemo = {
  /** Public by design — a widget id lives in the script tag on every customer's site. */
  widgetId: string;
};

/**
 * The site whose rendered docs the home page frames, preferred in this order:
 *
 *  1. `starter` — the forkable example (examples/starter). It is the right one to show because
 *     it carries an OpenAPI spec, so the frame includes a WORKING API console alongside the
 *     nav, search and assistant. It's also the page people already judge us by.
 *  2. the `docs.{apex}` site the Ask demo uses — our own documentation. No API reference, but
 *     everything else is real.
 *
 * Null when neither exists (no DB, single-repo preview, a deployment that has seeded neither),
 * and the section then shows its static poster with no frame. Deliberately convention-based
 * like resolveHomeDemo — an operator sets this up by creating the site, not by setting a var.
 */
export async function resolveDocsFrame(host: string): Promise<{ url: string } | null> {
  const starter = await getSiteBySlug("starter");
  const site = starter ?? (await getSiteByHost(demoDocsHost(host)));
  if (!site) return null;

  const local = host.includes("localhost") || host.startsWith("127.0.0.1");
  const proto = local ? "http" : "https";

  // A connected custom domain is the site's real public home — prefer it over the tenant host.
  // NOT locally, though: dev seeds `docs.localhost` as a custom domain purely as a lookup key,
  // and that host is RESERVED, so it renders the marketing apex. Framing it would embed this
  // very page inside itself.
  if (site.customDomain && !local) return { url: `https://${site.customDomain}/quickstart` };

  // Otherwise the same subdomain-vs-path decision the dashboard's "Open site" link makes: a
  // host with no wildcard (a preview deployment, a bare IP) can only serve tenants by path.
  const tenantHost = tenantHostFor(site.slug, host);
  if (supportsSubdomainTenants(tenantHost.replace(/^[^.]+\./, ""))) {
    return { url: `${proto}://${tenantHost}/quickstart` };
  }
  const apex = host.replace(/^(app|www)\./, "");
  return { url: `${proto}://${apex}/sites/${site.slug}/quickstart` };
}

/**
 * Resolve the widget the home page may embed, or null to degrade to plain links.
 *
 * Convention over configuration: the demo site is whichever site claims `docs.{apex}` as its
 * custom domain — our own dogfooded docs. No env var to set and nothing to forget when a new
 * environment appears; a deployment that hasn't set that up just shows link chips.
 *
 * Null is the ordinary answer, not an error state. It happens with no DB (the smoke gate),
 * in single-repo preview mode, before the operator enables the widget, and on any host whose
 * origin isn't on the site's allowlist — so the caller must always be able to render without it.
 *
 * The allowlist check is the same one the chat route enforces, run here so we never render a
 * launcher that would 403 on its first message. It also means an operator who forgets
 * `https://www.{apex}` sees the fallback rather than a broken widget.
 */
export async function resolveHomeDemo(host: string): Promise<HomeDemo | null> {
  const site = await getSiteByHost(demoDocsHost(host));
  if (!site?.widgetEnabled || !site.widgetId) return null;

  const proto = host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  if (!isOriginAllowed(`${proto}://${host}`, site.widgetAllowedOrigins)) return null;

  return { widgetId: site.widgetId };
}
