import type { Metadata } from "next";
import { TenantDocsArticle, tenantPageMetadata } from "@/lib/render-tenant";
import { resolveCustomDomainPage } from "../resolve";

// Custom-domain docs (docs.example.com). The middleware can't DB-resolve a vanity host at the
// edge, so it forwards the raw Host (x-papervine-host) and rewrites here (note: this segment
// is deliberately NOT `_`-prefixed — Next treats those as unrouted private folders); we
// resolve the site by that host. Dynamic for the same reason /sites is. The persistent
// chrome is the (docs) group layout, so a navigation re-renders only this article.
export const dynamic = "force-dynamic";

type Params = { path?: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { record, base, assetBase, path } = await resolveCustomDomainPage((await params).path ?? []);
  // Not path mode: the vanity Host resolves the tenant, even in "Host at /docs" serving
  // (where `base` is "/docs" but still host-scoped).
  return tenantPageMetadata({ slug: record.slug, base, assetBase, path });
}

export default async function CustomDomainDocsPage({ params }: { params: Promise<Params> }) {
  const { record, base, assetBase, path } = await resolveCustomDomainPage((await params).path ?? []);
  return <TenantDocsArticle slug={record.slug} base={base} assetBase={assetBase} path={path} />;
}
