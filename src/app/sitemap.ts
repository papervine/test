import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { sitemapFor, isMarketingHost } from "@/lib/seo-routes";
import { requestSiteRecord } from "@/lib/request-source";
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
 * The site row is consulted FIRST, and the host heuristic only decides what to do when no
 * site claims this host. That order matters more than it looks: `docs.papervine.io` is a
 * custom domain on our own dogfood site, and `docs` is reserved from slug resolution, so to a
 * host-only check it was indistinguishable from the apex — and this route served the marketing
 * sitemap on the docs host until the row got a vote.
 *
 * Explicit `force-dynamic`, not inferred from `headers()`: the answer varies by Host, and a
 * cached one would hand a tenant somebody else's file.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  const singleRepo = Boolean(process.env.PAPERVINE_CONTENT);
  if (singleRepo) return tenantSitemap();
  if (await requestSiteRecord()) return tenantSitemap();
  return isMarketingHost({ host, singleRepo }) ? sitemapFor({ host, singleRepo }) : [];
}
