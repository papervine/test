import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { sitemapFor, isMarketingHost } from "@/lib/seo-routes";
import { tenantSitemap } from "@/lib/tenant-sitemap";

/**
 * `sitemap.xml`, answered per host (SPEC §2).
 *
 * Two different sitemaps live behind this one route, because one Next app answers on four
 * kinds of host:
 *  · the marketing apex → our own pages, from `seo-routes.ts`;
 *  · a docs site — a tenant subdomain, a customer's custom domain, or a repo behind
 *    `papervine serve` — → THEIR pages, from the renderer.
 *
 * The docs half used to be an empty document, on the grounds that a real one was a renderer
 * feature nobody had built. It is built now (`packages/renderer/lib/sitemap.ts`), and the
 * gap it left was ours as much as anyone's: `docs.papervine.io` is itself a tenant, so our
 * own documentation shipped without a sitemap.
 *
 * `headers()` makes this dynamic on purpose (the convention is cached otherwise), for the
 * same reason as `robots.ts`.
 */
// Explicit, not inferred from the `headers()` call below: this route's answer depends on
// the request Host, and a cached one would hand a tenant somebody else's file.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  const singleRepo = Boolean(process.env.PAPERVINE_CONTENT);
  if (isMarketingHost({ host, singleRepo })) return sitemapFor({ host, singleRepo });
  return tenantSitemap();
}
