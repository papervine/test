import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import { githubSource } from "@/lib/github-source";
import { s3Source, isSynced } from "@/lib/s3-source";
import { contentContext, loadConfig, loadPage } from "@/lib/content";
import { buildNav, findGroupLabel } from "@/lib/nav";
import { Mdx, extractToc } from "@/lib/mdx";
import { resolveTheme, themeCssVars } from "@/lib/theme";
import { Navbar } from "@/components/Navbar";
import { NavTabs } from "@/components/NavTabs";
import { Sidebar } from "@/components/Sidebar";
import { TableOfContents } from "@/components/TableOfContents";
import { PageViewBeacon } from "@/components/analytics/PageViewBeacon";

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
  const assetBase = hostSlug ? "" : `/api/tenant-asset/${slug}`;

  const record = await getSiteBySlug(slug);
  if (!record?.repoOwner || !record.repoName) notFound();

  // Read from object storage (the synced copy); fall back to live GitHub for sites
  // connected before they were synced (SPEC §3.1 model C, with A as interim fallback).
  const src = (await isSynced(record.id))
    ? s3Source(record.id)
    : githubSource(record.repoOwner, record.repoName, record.branch);

  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const sections = await buildNav(config, base);
    const slugStr = (path ?? []).join("/");
    const page = await loadPage(slugStr);
    if (!page) notFound();

    const toc = extractToc(page.body);
    const eyebrow = findGroupLabel(sections, base + "/" + (slugStr || "index"));

    // Override the apex theme vars with this tenant's brand colors.
    const theme = resolveTheme(config.theme);
    const c = config.colors;
    const themeVars = `:root{--color-primary:${c.primary};--color-primary-light:${
      c.light ?? c.primary
    };--color-primary-dark:${c.dark ?? c.primary};${themeCssVars(theme.tokens)};}`;

    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
        <PageViewBeacon />
        <Navbar config={config} base={base} assetBase={assetBase} />
        <NavTabs sections={sections} />
        <div className="mx-auto flex max-w-7xl gap-8 pl-9 pr-6">
          <Sidebar sections={sections} />
          <main className="min-w-0 flex-1">
            <div className="flex items-start gap-10 px-8 py-10">
              <article className="prose min-w-0 flex-1">
                {eyebrow && (
                  <div className="mb-2 text-sm font-semibold text-primary">{eyebrow}</div>
                )}
                {page.frontmatter.title && <h1>{page.frontmatter.title}</h1>}
                {page.frontmatter.description && (
                  <p className="!mt-2 text-lg text-zinc-500 dark:text-zinc-400">
                    {page.frontmatter.description}
                  </p>
                )}
                <Mdx source={page.body} linkBase={base} assetBase={assetBase} />
              </article>
              <TableOfContents items={toc} />
            </div>
          </main>
        </div>
      </>
    );
  });
}
