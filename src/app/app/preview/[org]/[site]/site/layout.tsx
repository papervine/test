import { notFound } from "next/navigation";
import { requireSite } from "@/lib/dashboard-context";
import { TenantDocsShell } from "@/lib/render-tenant";
import { findOpenSession } from "@/lib/draft-store";

// FULL-SITE draft preview (SPEC §9.2): the whole docs site — navbar, tabs, sidebar, search,
// assistant — rendered from the editor's draft, so "how does this actually look?" is answered by
// the real renderer instead of a per-page approximation.
//
// This is the sibling of ../page.tsx, which renders ONE article with no chrome for the editor's
// in-pane Preview iframe. That one answers "is this page's MDX right?"; this one answers "is the
// site right?" — navigation order, tabs, groups, links between pages.
//
// `base` points back into the preview, so following a link stays in the draft rather than
// escaping to the published site. Assets go through the slug-keyed tenant-asset route, exactly
// as they do on the real host.
export const dynamic = "force-dynamic";

// Params are hand-written rather than using Next's generated `LayoutProps<...>`, matching every
// other route here: CI typechecks BEFORE building, so on a clean checkout `.next`'s generated
// route types don't exist yet and the helper wouldn't resolve.
export default async function PreviewSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string; site: string }>;
}) {
  const { org, site } = await params;
  // Same gate as the editor: session → org membership → org-scoped site (404s anyone else).
  const ctx = await requireSite(org, site);
  const slug = ctx.site.slug;

  // A layout doesn't receive searchParams in Next's App Router, so the branch can't come from
  // the URL here — resolve the site's open edit session instead, which is the branch the editor
  // is on. Falls back to the deploy branch, i.e. the published content.
  const open = await findOpenSession(ctx.site.id, ctx.site.branch);
  const branch = open?.baseBranch ?? ctx.site.branch;
  if (!slug) notFound();

  return (
    <TenantDocsShell
      slug={slug}
      base={`/preview/${org}/${site}/site`}
      assetBase={`/api/tenant-asset/${slug}`}
      draft={{ branch, showGated: true }}
    >
      {children}
    </TenantDocsShell>
  );
}
