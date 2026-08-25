import type { Metadata } from "next";
import { TenantDocsArticle, sitesTenantTarget, tenantPageMetadata } from "@/lib/render-tenant";

// Tenant docs render dynamically — content lives in the tenant's repo, fetched per
// request (cached briefly). Reached via the middleware host rewrite to /sites/{slug}.
// The persistent chrome (navbar/sidebar/assistant) is the sibling layout.tsx, so a
// same-site navigation re-renders only this article segment.
export const dynamic = "force-dynamic";

type Params = { site: string; path?: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { site, path } = await params;
  const { base, assetBase } = await sitesTenantTarget(site);
  // A non-empty `base` here means apex path mode — the Host names no tenant, so the card
  // route is told which site to render.
  return tenantPageMetadata({
    slug: site,
    base,
    assetBase,
    path: path ?? [],
    pathMode: Boolean(base),
  });
}

export default async function TenantDocsPage({ params }: { params: Promise<Params> }) {
  const { site: slug, path } = await params;
  const { base, assetBase } = await sitesTenantTarget(slug);
  return <TenantDocsArticle slug={slug} base={base} assetBase={assetBase} path={path ?? []} />;
}
