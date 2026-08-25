import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { contentContext, loadConfig, loadPage } from "@papervine/renderer/lib/content";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import { OgCard, OG_CARD_SIZE, type OgCardInput } from "@papervine/renderer/lib/og-card";
import { requestContentSource, requestSiteRecord } from "@/lib/request-source";

/**
 * The auto-generated social card for a docs page — `GET /api/og/{page-slug}` (SPEC §5).
 * Referenced as `og:image`/`twitter:image` by every docs route's `generateMetadata`
 * (see `@papervine/renderer/lib/seo`), so sharing a page on X, Slack or LinkedIn unfurls
 * to a branded image instead of a bare URL.
 *
 * It lives under `/api/` on purpose: that's the one path space middleware passes through
 * untouched on every host class (tenant subdomain, custom domain, apex), so ONE route
 * answers for all three and resolves its own tenant from the Host header —
 * `requestContentSource` does exactly the resolution the page render does, with `?site=`
 * carrying the slug in apex path mode (the same convention `/api/search` uses).
 *
 * Content-derived rather than parameterised: the title and description come from the page,
 * never from the query string, so nobody can mint `…/api/og?title=<anything>` and serve
 * arbitrary text as an image from a customer's own domain.
 */

// Tenant content is fetched per request (cached by version downstream), and the card
// depends on the Host header — nothing here is prerenderable.
export const dynamic = "force-dynamic";

type Params = { path?: string[] };

export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { path } = await ctx.params;
  const slug = (path ?? []).join("/");
  const site = req.nextUrl.searchParams.get("site") ?? undefined;

  const src = await requestContentSource(site);
  const record = await requestSiteRecord(site);

  const read = async () => {
    const config = await loadConfig();
    const page = await loadPage(slug);
    let title = page?.frontmatter.title;
    let description = page?.frontmatter.description;
    if (!page && slug) {
      // Auto-generated OpenAPI endpoint pages (SPEC §7) have no MDX file but are real,
      // shareable URLs, so they get a card built from the operation instead.
      const op = (await loadApiCatalog(config)).get(slug);
      if (op) {
        title = op.summary ?? `${op.method} ${op.path}`;
        description = op.description;
      }
    }
    // A card is fetched by crawlers with no reader session, so it must never carry a gated
    // page's title or description (SPEC §11.2) — that would leak through the unfurl exactly
    // what the 404-not-403 rule is there to withhold. Degrade to the site-level card.
    if (record?.authEnabled && !page?.frontmatter.public) {
      title = undefined;
      description = undefined;
    }
    return { config, title, description };
  };

  let card: OgCardInput = { siteName: "Docs" };
  try {
    const { config, title, description } = src ? await contentContext.run(src, read) : await read();
    card = {
      siteName: config.name,
      title,
      description,
      primary: config.colors?.primary,
      appearance: config.appearance?.default,
    };
  } catch (err) {
    // Same rule as the renderer: one bad page or unreadable config must not 500 the surface.
    // A plain "Docs" card still unfurls; an error response leaves the link with no image.
    console.warn(`OG card fell back to the default for "${slug}": ${(err as Error).message}`);
  }

  return new ImageResponse(<OgCard {...card} />, {
    ...OG_CARD_SIZE,
    headers: {
      // The URL carries the tenant's synced content version (`?v=`), so a card is safe to
      // cache hard — a re-sync mints a new URL and re-scrapes rather than serving a stale
      // title forever. Without a version (apex / single-repo preview) the hour cap applies.
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
