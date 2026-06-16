import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import { renderTenantDocs } from "@/lib/render-tenant";

// Tenant docs render dynamically — content lives in the tenant's repo, fetched per
// request (cached briefly). Reached via the middleware host rewrite to /sites/{slug}.
export const dynamic = "force-dynamic";

type Params = { site: string; path?: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { site } = await params;
  const record = await getSiteBySlug(site);
  return record ? { title: { default: record.name, template: `%s · ${record.name}` } } : {};
}

export default async function TenantDocsPage({ params }: { params: Promise<Params> }) {
  const { site: slug, path } = await params;

  // Two ways to reach a tenant's docs:
  //  • Host mode (subdomain): `acme.papervine.io/…`, rewritten here by middleware. The
  //    host resolves to this slug; links/assets stay root-absolute (base empty).
  //  • Path mode (apex): `apex/sites/acme/…` directly — the interim for deploys
  //    without a wildcard domain (e.g. Vercel `*.vercel.app`, which won't issue TLS
  //    for nested subdomains). Links/assets get prefixed with the tenant base so they
  //    don't escape to the platform apex.
  // A subdomain host must only ever address its own slug (defense against cross-tenant URLs).
  const hostSlug = resolveTenantSlug((await headers()).get("host"));
  if (hostSlug && hostSlug !== slug) notFound();
  const base = hostSlug ? "" : `/sites/${slug}`;
  // Assets ALWAYS resolve through the slug-keyed asset route, even in subdomain mode
  // where a bare `/img/…` would also work for a direct browser load. The next/image
  // optimizer fetches the source URL server-side WITHOUT the tenant Host header, so a
  // host-rewrite-dependent `/img/…` 404s in the optimizer (→ broken image). The
  // `/api/tenant-asset/{slug}` route carries the slug in the path, so it resolves the
  // same regardless of host — the one form both the browser and the optimizer can read.
  const assetBase = `/api/tenant-asset/${slug}`;

  return renderTenantDocs({ slug, base, assetBase, path: path ?? [] });
}
