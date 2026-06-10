import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSiteByCustomDomain } from "@/lib/tenant";
import { renderTenantDocs } from "@/lib/render-tenant";

// Custom-domain docs (docs.acme.com). The middleware can't DB-resolve a vanity host at
// the edge, so it forwards the raw Host (x-papervine-host) and rewrites here (note: this
// segment is deliberately NOT `_`-prefixed — Next treats those as unrouted private
// folders); we resolve the site by that host. Dynamic for the same reason /sites is.
export const dynamic = "force-dynamic";

type Params = { path?: string[] };

async function host(): Promise<string | null> {
  const h = await headers();
  return h.get("x-papervine-host") ?? h.get("host");
}

export async function generateMetadata(): Promise<Metadata> {
  const record = await getSiteByCustomDomain((await host()) ?? "");
  return record ? { title: { default: record.name, template: `%s · ${record.name}` } } : {};
}

export default async function CustomDomainDocsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const record = await getSiteByCustomDomain((await host()) ?? "");
  if (!record) notFound();

  // "Host at /docs": the docs live under {domain}/docs, so we only own that subtree —
  // strip the leading `docs` segment to get the content path, 404 anything else (the
  // customer's own site owns the rest of the host). Otherwise docs are at the root.
  let path = (await params).path ?? [];
  let base = "";
  if (record.customDomainSubpath) {
    if (path[0] !== "docs") notFound();
    path = path.slice(1);
    base = "/docs";
  }

  return renderTenantDocs({ slug: record.slug, base, assetBase: base, path });
}
