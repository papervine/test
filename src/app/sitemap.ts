import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { sitemapFor } from "@/lib/seo-routes";

/**
 * `sitemap.xml` for the marketing apex, and an EMPTY sitemap everywhere else (SPEC §2).
 *
 * The empty case is the point of the host check: this route tree also serves every tenant's
 * docs site, so a sitemap that always listed our marketing pages would publish
 * `papervine.io/pricing` inside `customer.com/sitemap.xml`. A tenant's real sitemap — their
 * pages, their `lastmod`, their gated pages excluded — is a renderer feature and not this
 * file's job; until it exists they get a valid, empty document rather than ours.
 *
 * `headers()` makes this dynamic on purpose (the convention is cached otherwise), for the
 * same reason as `robots.ts`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host");
  return sitemapFor({
    host,
    singleRepo: Boolean(process.env.PAPERVINE_CONTENT),
  });
}
