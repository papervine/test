import { requireSite } from "@/lib/dashboard-context";
import { TenantDocsArticle } from "@/lib/render-tenant";
import { findOpenSession } from "@/lib/draft-store";

// One article inside the full-site draft preview. The chrome is the sibling layout, so moving
// between pages here re-renders only this segment — the same layout/page split the real tenant
// route uses (and the reason it exists).
export const dynamic = "force-dynamic";

export default async function PreviewSitePage({
  params,
}: {
  params: Promise<{ org: string; site: string; path?: string[] }>;
}) {
  const { org, site, path } = await params;
  const ctx = await requireSite(org, site);
  const slug = ctx.site.slug;
  const open = await findOpenSession(ctx.site.id, ctx.site.branch);
  const branch = open?.baseBranch ?? ctx.site.branch;

  return (
    <TenantDocsArticle
      slug={slug}
      base={`/preview/${org}/${site}/site`}
      assetBase={`/api/tenant-asset/${slug}`}
      draft={{ branch, showGated: true }}
      path={path ?? []}
    />
  );
}
