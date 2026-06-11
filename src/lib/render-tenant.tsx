import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSiteBySlug } from "@/lib/tenant";
import { READER_COOKIE, readerSessionValid } from "@/lib/reader-session";
import { requestContentSource } from "@/lib/request-source";
import { contentContext, loadConfig, loadPage } from "@/lib/content";
import { buildNav, findGroupLabel } from "@/lib/nav";
import { Mdx, extractToc } from "@/lib/mdx";
import { resolveTheme, themeCssVars } from "@/lib/theme";
import { Navbar } from "@/components/Navbar";
import { NavTabs } from "@/components/NavTabs";
import { Sidebar } from "@/components/Sidebar";
import { TableOfContents } from "@/components/TableOfContents";
import { PageViewBeacon } from "@/components/analytics/PageViewBeacon";
import { Assistant } from "@/components/assistant/Assistant";

/**
 * Render one tenant docs page. Shared by both serving paths so they can't drift:
 *  • subdomain / custom-domain host: `base`/`assetBase` empty (root-absolute links).
 *  • apex path mode: `base = /sites/{slug}`, assets via `/api/tenant-asset/{slug}`.
 *  • custom domain "Host at /docs": `base = /docs`, assets via the by-host handler.
 *
 * Resolves the tenant's content source from its slug — the same resolver the root
 * layout uses, so config + pages read from one source in a single render — and runs
 * the whole render inside `contentContext.run` so every content read hits that source.
 */
export async function renderTenantDocs({
  slug,
  base,
  assetBase,
  path,
}: {
  slug: string;
  base: string;
  assetBase: string;
  path: string[];
}) {
  // Layer 2 reader-auth gate (SPEC §11.2). A site with auth enabled only renders to a
  // reader holding a valid docs session for it; everyone else is bounced to the site's
  // login, round-tripping the intended path so they land back here after signing in. This
  // is the single chokepoint for all three serving modes (subdomain / path / custom
  // domain), and the login route renders outside this function, so it isn't gated — no
  // redirect loop. Enforcement lives here, not in middleware, because the per-site config
  // is a DB read the edge runtime can't do (same reason custom-domain resolution is here).
  const record = await getSiteBySlug(slug);
  if (record?.authEnabled) {
    const cookie = (await cookies()).get(READER_COOKIE)?.value;
    if (!readerSessionValid(cookie, record.id)) {
      const intended = `${base}/${path.join("/")}`;
      redirect(`${base}/login?redirect=${encodeURIComponent(intended)}`);
    }
  }

  const src = await requestContentSource(slug);
  if (!src) notFound();

  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const sections = await buildNav(config, base);
    const slugStr = path.join("/");
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
        <Navbar config={config} base={base} assetBase={assetBase} site={slug} />
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
        {/* The navbar's "Ask Assistant" button (and Cmd-I) dispatch an event this
            component listens for. The (docs)-group layout mounts it for apex docs;
            tenant pages render outside that group, so mount it here too. */}
        <Assistant site={slug} />
      </>
    );
  });
}
