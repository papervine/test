import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSiteByCustomDomain } from "@/lib/tenant";
import { TenantDocsArticle } from "@/lib/render-tenant";
import { resolveCustomDomainPage } from "../resolve";

// Custom-domain docs (docs.acme.com). The middleware can't DB-resolve a vanity host at the
// edge, so it forwards the raw Host (x-papervine-host) and rewrites here (note: this segment
// is deliberately NOT `_`-prefixed — Next treats those as unrouted private folders); we
// resolve the site by that host. Dynamic for the same reason /sites is. The persistent
// chrome is the (docs) group layout, so a navigation re-renders only this article.
export const dynamic = "force-dynamic";

type Params = { path?: string[] };

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const record = await getSiteByCustomDomain(h.get("x-papervine-host") ?? h.get("host") ?? "");
  return record ? { title: { default: record.name, template: `%s · ${record.name}` } } : {};
}

export default async function CustomDomainDocsPage({ params }: { params: Promise<Params> }) {
  const { record, base, assetBase, path } = await resolveCustomDomainPage((await params).path ?? []);
  return <TenantDocsArticle slug={record.slug} base={base} assetBase={assetBase} path={path} />;
}
