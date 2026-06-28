import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import { READER_COOKIE, readerSession, readerSessionValid } from "@/lib/reader-session";
import { canAccessPage } from "@/lib/reader-auth";
import { requestContentSource } from "@/lib/request-source";
import type { PageAccess } from "@papervine/renderer/lib/nav";
import {
  contentContext,
  loadConfig,
  loadPage,
  loadAssetDimensions,
} from "@papervine/renderer/lib/content";
import { buildNav, findGroupLabel } from "@papervine/renderer/lib/nav";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import { EndpointReference } from "@papervine/renderer/components/api/EndpointReference";
import { Mdx, extractToc } from "@papervine/renderer/lib/mdx";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";
import { Navbar } from "@papervine/renderer/components/Navbar";
import { NavTabs } from "@papervine/renderer/components/NavTabs";
import { Sidebar } from "@papervine/renderer/components/Sidebar";
import { TableOfContents } from "@papervine/renderer/components/TableOfContents";
import { PageViewBeacon } from "@/components/analytics/PageViewBeacon";
import { Assistant } from "@/components/assistant/Assistant";
import { AskAssistantButton } from "@/components/assistant/AskAssistantButton";
import { SearchButton } from "@/components/SearchDialog";

/**
 * Tenant docs render as a persistent SHELL (layout: navbar + tabs + sidebar + assistant)
 * around a per-page ARTICLE (page: title + MDX + ToC). Splitting them into a layout/page
 * pair is the whole point: navigating between pages of the same site re-renders only the
 * article segment — the sidebar/navbar persist (no flash, scroll preserved) and only the
 * small article RSC payload streams, the way the incumbent swaps content under a fixed chrome.
 * Previously one component rendered the entire page per navigation.
 *
 * Both halves resolve the same content source from the slug (cheap: getSiteBySlug is a
 * per-request cache(), the s3 reads are version-keyed + tagged) and run inside
 * `contentContext.run` so every content read hits that source. They can't drift because the
 * base/mode and the source come from the shared helpers below.
 *
 * Serving modes (see middleware): subdomain/custom-domain host → `base` empty (root-absolute
 * links); apex path mode → `base = /sites/{slug}`. Assets ALWAYS go through the slug-keyed
 * `/api/tenant-asset/{slug}` route (host-independent — the next/image optimizer fetches the
 * source server-side without the tenant Host, so a host-rewrite-dependent `/img/…` 404s).
 */
export async function sitesTenantTarget(slug: string): Promise<{ base: string; assetBase: string }> {
  // A subdomain host must only ever address its own slug (defense against cross-tenant URLs);
  // in path mode there's no host tenant, so any /sites/{slug} is addressable as intended.
  const hostSlug = resolveTenantSlug((await headers()).get("host"));
  if (hostSlug && hostSlug !== slug) notFound();
  return { base: hostSlug ? "" : `/sites/${slug}`, assetBase: `/api/tenant-asset/${slug}` };
}

/**
 * Layer 2 reader-auth gate (SPEC §11.2). A site with auth enabled only renders to a reader
 * holding a valid docs session for it; everyone else is bounced to the site's login. Runs in
 * the shell (layout) so it gates every page under it before any content renders; the login
 * route lives outside the (docs) group, so it isn't gated — no redirect loop. Enforcement
 * lives here, not in middleware, because the per-site config is a DB read the edge runtime
 * can't do. The layout sees only the {site} param (not the deep path), so login round-trips
 * to the site root rather than the exact page — acceptable for the v2/partial reader-auth.
 */
async function gateReaderAuth(slug: string, base: string): Promise<void> {
  const record = await getSiteBySlug(slug);
  if (!record?.authEnabled) return;
  const cookie = (await cookies()).get(READER_COOKIE)?.value;
  if (!readerSessionValid(cookie, record.id)) {
    redirect(`${base}/login?redirect=${encodeURIComponent(base || "/")}`);
  }
}

/**
 * The per-page access predicate for the current reader (SPEC §11.2 per-page `groups`). On a
 * site with auth OFF, every page is public → allow all. With auth ON, gate each page by the
 * reader's session groups (from the JWT/OAuth handshake; the password method carries none, so
 * it can never satisfy a `groups:` page — by design). Both the shell (nav hiding) and the
 * article (page gate → 404) use this, so the sidebar and the renderable pages agree. The site
 * record + cookie are per-request `cache()`d, so resolving this in both halves is cheap.
 */
async function readerAccess(slug: string): Promise<PageAccess> {
  const record = await getSiteBySlug(slug);
  if (!record?.authEnabled) return () => true;
  const cookie = (await cookies()).get(READER_COOKIE)?.value;
  const groups = readerSession(cookie, record.id)?.groups ?? [];
  return (fm) => canAccessPage(fm.groups, fm.public, groups);
}

/** The persistent docs chrome (layout). Renders the tenant's navbar/tabs/sidebar/assistant
 *  + theme once; `children` is the per-page article, which streams independently. */
export async function TenantDocsShell({
  slug,
  base,
  assetBase,
  children,
}: {
  slug: string;
  base: string;
  assetBase: string;
  children: React.ReactNode;
}) {
  await gateReaderAuth(slug, base);

  const src = await requestContentSource(slug);
  if (!src) notFound();

  const canAccess = await readerAccess(slug);
  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const sections = await buildNav(config, base, canAccess);

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
        <Navbar
          config={config}
          base={base}
          assetBase={assetBase}
          search={<SearchButton site={slug} />}
          assistant={<AskAssistantButton />}
        />
        <NavTabs sections={sections} />
        <div className="mx-auto flex max-w-7xl gap-8 pl-9 pr-6">
          <Sidebar sections={sections} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
        {/* The navbar's "Ask Assistant" button (and Cmd-I) dispatch an event this
            component listens for. Tenant pages render outside the apex (docs) group's
            layout, so mount it here. */}
        <Assistant site={slug} />
      </>
    );
  });
}

/** One tenant docs page (the article inside the shell): eyebrow + title + MDX + ToC. */
export async function TenantDocsArticle({
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
  const src = await requestContentSource(slug);
  if (!src) notFound();

  const canAccess = await readerAccess(slug);
  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const sections = await buildNav(config, base, canAccess);
    const slugStr = path.join("/");
    const page = await loadPage(slugStr);
    if (!page) {
      // Not an MDX page — try an auto-generated OpenAPI endpoint page (SPEC §7). The spec is
      // read through the active ContentSource (loadRaw), so a synced tenant's API Reference
      // pages resolve the same way the apex `papervine dev` preview does.
      const op = (await loadApiCatalog(config)).get(slugStr);
      if (op) {
        return (
          <div className="flex items-start gap-10 px-8 py-10">
            <EndpointReference op={op} baseUrl={op.baseUrl} />
          </div>
        );
      }
      notFound();
    }
    // Per-page group gate (SPEC §11.2): a reader who isn't in the page's `groups` gets a 404,
    // NOT a 403 — a 403 would confirm a protected page exists at this URL. The shell already
    // hides it from the nav; this stops a direct-URL hit.
    if (!canAccess(page.frontmatter)) notFound();

    const toc = extractToc(page.body);
    const eyebrow = findGroupLabel(sections, base + "/" + (slugStr || "index"));
    const assetDimensions = await loadAssetDimensions();

    return (
      <div className="flex items-start gap-10 px-8 py-10">
        <article className="prose min-w-0 flex-1">
          {eyebrow && <div className="mb-2 text-sm font-semibold text-primary">{eyebrow}</div>}
          {page.frontmatter.title && <h1>{page.frontmatter.title}</h1>}
          {page.frontmatter.description && (
            <p className="!mt-2 text-lg text-zinc-500 dark:text-zinc-400">
              {page.frontmatter.description}
            </p>
          )}
          <Mdx
            source={page.body}
            linkBase={base}
            assetBase={assetBase}
            assetDimensions={assetDimensions}
          />
        </article>
        <TableOfContents items={toc} />
      </div>
    );
  });
}
