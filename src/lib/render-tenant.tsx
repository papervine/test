import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import { READER_COOKIE, readerSessionValid } from "@/lib/reader-session";
import { accessForRecord, entitlementKey } from "@/lib/reader-access";
import { requestContentSource } from "@/lib/request-source";
import { ARTICLE_ROW } from "@/lib/docs-layout";
import { siteContentTag } from "@/lib/s3-source";
import type { PageAccess } from "@papervine/renderer/lib/nav";
import {
  contentContext,
  loadConfig,
  loadPage,
  loadAssetDimensions,
  type ContentSource,
} from "@papervine/renderer/lib/content";
import { buildNav, findGroupLabel } from "@papervine/renderer/lib/nav";
import { pageMetadata, ogImagePath } from "@papervine/renderer/lib/seo";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import { EndpointReference } from "@papervine/renderer/components/api/EndpointReference";
import { Mdx, extractToc } from "@papervine/renderer/lib/mdx";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";
import { Navbar } from "@papervine/renderer/components/Navbar";
import { NavTabs } from "@papervine/renderer/components/NavTabs";
import { Sidebar } from "@papervine/renderer/components/Sidebar";
import { PoweredBy } from "@/components/PoweredBy";
import { showsPoweredBy } from "@/lib/powered-by-store";
import { TableOfContents } from "@papervine/renderer/components/TableOfContents";
import { PageActions } from "@papervine/renderer/components/PageActions";
import { mdHref } from "@papervine/renderer/lib/llms-format";
import { PageViewBeacon } from "@/components/analytics/PageViewBeacon";
import { Assistant } from "@papervine/renderer/components/assistant/Assistant";
import { AskAssistantButton } from "@papervine/renderer/components/assistant/AskAssistantButton";
import { SearchButton } from "@papervine/renderer/components/SearchDialog";
import { Banner } from "@papervine/renderer/components/mdx/Banner";

/**
 * Tenant docs render as a persistent SHELL (layout: navbar + tabs + sidebar + assistant)
 * around a per-page ARTICLE (page: title + MDX + ToC). Splitting them into a layout/page
 * pair is the whole point: navigating between pages of the same site re-renders only the
 * article segment — the sidebar/navbar persist (no flash, scroll preserved) and only the
 * small article RSC payload streams, the way hosted docs platforms swaps content under a fixed chrome.
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
 * A tenant page's `<head>` metadata — title, description, canonical, and the `og:`/`twitter:`
 * tags that make a shared link unfurl as a card (SPEC §5).
 *
 * Shared by both tenant routes (`/sites/{slug}` and `/custom-domain`) because they differ only
 * in how they resolve the tenant, never in what they should advertise. Before this, both
 * returned only the *site* name — so every page of a site shared as the same bare title and no
 * image at all.
 *
 * The title is returned bare, not suffixed: the root layout owns the `%s · {site}` template
 * (and reads the same tenant config), so the suffix has exactly one definition.
 */
export async function tenantPageMetadata({
  slug,
  base,
  assetBase,
  path,
  pathMode = false,
}: {
  slug: string;
  base: string;
  assetBase: string;
  path: string[];
  /**
   * True only for apex path-mode serving (`/sites/{slug}/…`), where the request Host names no
   * tenant so the card route needs the slug as `?site=`. NOT the same as a non-empty `base`:
   * a custom domain served at `/docs` also has one, but its Host does resolve the tenant.
   */
  pathMode?: boolean;
}): Promise<Metadata> {
  const src = await requestContentSource(slug);
  if (!src) return {};
  const record = await getSiteBySlug(slug);
  // The card URL carries the content version so a re-synced page re-scrapes instead of
  // unfurling its old title forever. `updatedAt` alone is enough: the sync runner bumps it on
  // every success, including a re-sync of the same commit (see requestContentSource).
  const version = record?.updatedAt instanceof Date ? String(record.updatedAt.getTime()) : undefined;
  const slugStr = path.join("/");

  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const page = await loadPage(slugStr);
    // A generated OpenAPI endpoint page (SPEC §7) has no frontmatter but is a real, shareable
    // URL, so it advertises the operation instead.
    const op = page ? undefined : (await loadApiCatalog(config)).get(slugStr);
    return pageMetadata({
      config,
      frontmatter: page?.frontmatter,
      title: op ? (op.summary ?? `${op.method} ${op.path}`) : undefined,
      description: op?.description,
      // Root-absolute and tenant-scoped: `base` is "" on a host of the site's own and
      // `/sites/{slug}` in apex path mode. `metadataBase` (root layout) makes it absolute.
      path: `${base}/${slugStr}`.replace(/\/+$/, ""),
      assetBase,
      // `?site=` only in path mode — on a tenant host (subdomain or custom domain) the card
      // route resolves the tenant from the Host header, the same way this render did.
      ogImage: ogImagePath(slugStr, { site: pathMode ? slug : undefined, version }),
    });
  });
}

/**
 * Layer 2 reader-auth gate (SPEC §11.2), applied **per page** to match the established
 * `docs.json` platform so a migrated repo gates identically. With auth on, every page needs a
 * reader session *unless* it carries `public: true` — default-deny, with explicit opt-outs.
 *
 * This deliberately does NOT run in the shell. The layout only sees `{site}`, not the deep
 * path, so a gate there can only make one whole-site decision: bounce everyone to login,
 * including visitors to a page the author marked public. Auth is a property of the page, so
 * the decision belongs where the frontmatter is known — the article.
 *
 * An anonymous reader on a non-public page is sent to the site's login (they may be able to
 * sign in and read it). A *signed-in* reader who simply isn't in the page's `groups` gets a
 * 404 from the caller instead — never a 403, which would confirm the page exists.
 *
 * Enforcement lives here, not in middleware, because the per-site config is a DB read the
 * edge runtime can't do. The login route sits outside the (docs) group, so it is never itself
 * gated — no redirect loop.
 */
async function requireReaderForPage(
  slug: string,
  base: string,
  frontmatter: { public?: boolean },
  currentPath: string,
): Promise<void> {
  const record = await getSiteBySlug(slug);
  if (!record?.authEnabled) return;
  if (frontmatter.public) return;
  const cookie = (await cookies()).get(READER_COOKIE)?.value;
  if (!readerSessionValid(cookie, record.id)) {
    // Round-trip to the page they asked for, not the site root — they land where they meant
    // to go after signing in.
    const target = `${base}/${currentPath}`.replace(/\/+$/, "") || "/";
    redirect(`${base}/login?redirect=${encodeURIComponent(target)}`);
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
  const cookie = (await cookies()).get(READER_COOKIE)?.value;
  return accessForRecord(record, cookie);
}

/**
 * `buildNav` resolves every nav leaf via `loadPage` (one content read per page), and the nav is
 * identical across all pages of a site for a given reader-entitlement class — yet it ran on every
 * page render (the shell AND the article). Cache it in the Data Cache (SPEC §11.2 move ②):
 *  - VERSION-keyed (`sha:syncedAt`, like the content cache), so a sync yields a fresh key — and,
 *    via move ①, the version follows the cached site row (manual sync busts immediately, a webhook
 *    sync settles within the row TTL).
 *  - GROUP-keyed (`entitlementKey`), so a gated site's per-group nav variants don't collide; a
 *    public site is the single "public" class.
 * Built once per (version, base, class) and reused for every page render + the shell. The callback
 * re-establishes `contentContext` so `loadPage` works on a cache miss regardless of whether the
 * ambient ALS propagates through `unstable_cache`. Output is plain NavSection[] (strings/arrays),
 * so it round-trips the cache cleanly.
 */
async function buildNavCached(
  slug: string,
  base: string,
  config: Parameters<typeof buildNav>[0],
  canAccess: PageAccess,
  src: ContentSource,
  draftBranch?: string,
): Promise<Awaited<ReturnType<typeof buildNav>>> {
  const record = await getSiteBySlug(slug);
  if (!record) return buildNav(config, base, canAccess); // src exists; purely defensive
  const cookie = (await cookies()).get(READER_COOKIE)?.value;
  const version = `${record.lastSyncedCommitSha ?? ""}:${
    record.updatedAt instanceof Date ? record.updatedAt.getTime() : 0
  }`;
  const groupKey = entitlementKey(record, cookie);
  // A DRAFT nav must never be cached. The key below is `sha:updatedAt`, and a draft changes
  // neither — so a cached draft nav would be handed to readers of the PUBLISHED site. Drafts
  // read live and uncached everywhere else (draft-source.ts) for exactly this reason.
  if (draftBranch) return contentContext.run(src, () => buildNav(config, base, canAccess));
  return unstable_cache(
    () => contentContext.run(src, () => buildNav(config, base, canAccess)),
    ["tenant-nav", record.id, version, base, groupKey],
    { tags: [siteContentTag(record.id)], revalidate: 3600 },
  )();
}

/** The persistent docs chrome (layout). Renders the tenant's navbar/tabs/sidebar/assistant
 *  + theme once; `children` is the per-page article, which streams independently. */
/** Draft-preview options. Absent on every reader-facing route — see the cache note below. */
export type DraftPreview = {
  // Render this edit session's draft instead of published content.
  branch: string;
  // Skip reader-auth filtering. The preview route is already gated to org members with editor
  // access, and an author previewing their own site must see the gated pages they're editing.
  showGated: boolean;
};

export async function TenantDocsShell({
  slug,
  base,
  assetBase,
  draft,
  children,
}: {
  slug: string;
  base: string;
  assetBase: string;
  draft?: DraftPreview;
  children: React.ReactNode;
}) {
  // No auth gate here on purpose — see requireReaderForPage. The shell can't see which page
  // is being requested, and with per-page auth that decision needs the frontmatter. The nav
  // this shell renders is already filtered by the same access predicate, so an anonymous
  // reader sees chrome listing only the pages they can actually open.
  const src = draft
    ? await requestContentSource(slug, { draftBranch: draft.branch })
    : await requestContentSource(slug);
  if (!src) notFound();

  // Operational kill switch (SPEC §8.6): when the assistant is disabled for this site, don't
  // mount its launcher or widget — the toggle takes effect on the next render (the row is
  // revalidated on toggle). Default ON for older rows. `getSiteBySlug` is per-request cached,
  // so this shares the lookup buildNavCached already does.
  const record = await getSiteBySlug(slug);
  const assistantOn = record?.assistantEnabled ?? true;
  // Rides the same per-request-cached site lookup, and is itself cached for a minute — this is
  // the render path of every docs page, so it must not add a query per view. Hidden with no
  // database and on any error (see powered-by-store).
  const badge = await showsPoweredBy(record?.organizationId ?? null);

  const canAccess = draft?.showGated ? () => true : await readerAccess(slug);
  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const sections = await buildNavCached(slug, base, config, canAccess, src, draft?.branch);

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
        {/* Site-wide `docs.json` banner, above the navbar. */}
        {config.banner?.content && (
          <Banner
            content={config.banner.content}
            type={config.banner.type}
            dismissible={config.banner.dismissible}
            color={config.banner.color}
          />
        )}
        <Navbar
          config={config}
          base={base}
          assetBase={assetBase}
          search={<SearchButton site={slug} track />}
          assistant={assistantOn ? <AskAssistantButton /> : null}
        />
        <NavTabs sections={sections} />
        <div className="mx-auto flex max-w-[var(--db-shell-w)] gap-8 pl-9 pr-6">
          <Sidebar sections={sections} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
        {/* The navbar's "Ask Assistant" button (and Cmd-I) dispatch an event this
            component listens for. Tenant pages render outside the apex (docs) group's
            layout, so mount it here. Skipped when the kill switch is off. */}
        {assistantOn && <Assistant site={slug} />}
        {/* Last in the shell so it sits under the content on every page — including the API
            reference and the not-found page, which never touch TenantDocsArticle. */}
        {badge && <PoweredBy />}
      </>
    );
  });
}

/** One tenant docs page (the article inside the shell): eyebrow + title + MDX + ToC. */
export async function TenantDocsArticle({
  slug,
  base,
  assetBase,
  draft,
  path,
}: {
  slug: string;
  base: string;
  assetBase: string;
  draft?: DraftPreview;
  path: string[];
}) {
  const src = draft
    ? await requestContentSource(slug, { draftBranch: draft.branch })
    : await requestContentSource(slug);
  if (!src) notFound();

  const canAccess = draft?.showGated ? () => true : await readerAccess(slug);
  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const sections = await buildNavCached(slug, base, config, canAccess, src, draft?.branch);
    const slugStr = path.join("/");
    const page = await loadPage(slugStr);
    if (!page) {
      // Not an MDX page — try an auto-generated OpenAPI endpoint page (SPEC §7). The spec is
      // read through the active ContentSource (loadRaw), so a synced tenant's API Reference
      // pages resolve the same way the apex `papervine dev` preview does.
      const op = (await loadApiCatalog(config)).get(slugStr);
      if (op) {
        return (
          <div className={ARTICLE_ROW}>
            <EndpointReference op={op} baseUrl={op.baseUrl} siteBase={base} />
          </div>
        );
      }
      notFound();
    }
    // Per-page auth gate (SPEC §11.2), in two steps, because "you need to sign in" and "you
    // signed in but this isn't for you" deserve different answers:
    //
    //  1. No session and the page isn't `public: true` → send them to the site's login, with
    //     a redirect back to this page. Answering 404 here would strand a legitimate reader
    //     with no way to discover that signing in would work.
    //  2. Signed in but not in the page's `groups` → 404, NOT 403. A 403 would confirm a
    //     protected page exists at this URL. The nav already hides it; this stops a
    //     direct-URL hit.
    // Skipped in a draft preview: the route is already gated to an org member with editor
    // access, and this would otherwise bounce them to the *tenant's* reader login — a dead end
    // from inside the dashboard, and wrong for an author previewing pages they're editing.
    if (!draft?.showGated) {
      await requireReaderForPage(slug, base, page.frontmatter, slugStr);
      if (!canAccess(page.frontmatter)) notFound();
    }

    const toc = extractToc(page.body);
    const eyebrow = findGroupLabel(sections, base + "/" + (slugStr || "index"));
    const assetDimensions = await loadAssetDimensions();

    // The assistant's kill switch also governs its menu item — offering "Ask Assistant" on a
    // site where the launcher is hidden would open a panel that isn't mounted.
    const assistantOn = (await getSiteBySlug(slug))?.assistantEnabled ?? true;

    return (
      <div className={`${ARTICLE_ROW} pv-article-row`}>
        {/* The actions row sits above the article rather than inside it: `prose` styles the
            article's first child, and a control there fights those rules for margins. */}
        <div className="pv-article-col min-w-0 flex-1">
          <PageActions mdHref={base + mdHref("/" + slugStr)} assistant={assistantOn} />
          <article className="prose min-w-0">
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
        </div>
        <TableOfContents items={toc} />
      </div>
    );
  });
}
