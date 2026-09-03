import "server-only";
import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { contentContext } from "@papervine/renderer/lib/content";
import { renderSitemap } from "@papervine/renderer/lib/sitemap";
import { requestContentSource, requestSiteRecord } from "./request-source";
import { accessForRecord, withReaderAccess } from "./reader-access";
import { docsOriginFor } from "./seo-routes";

/**
 * Is there enough certainty about who may read this site to publish a list of its URLs?
 *
 * Pure, because the answer must fail CLOSED and that is easy to get wrong. `accessForRecord`
 * treats a missing site record as "no gating" — right for the render path, where a missing
 * record means the page 404s anyway, and dangerous here: the content source and the site
 * record are resolved separately, so a request that finds the content but not the row would
 * publish a GATED site's internal URLs as if they were public. Observed exactly once on a cold
 * request, which is the only reason it was caught.
 *
 * Single-repo mode (`papervine serve`, `papervine dev`, the smoke gate) has no records and no
 * reader auth at all, so there is nothing to be uncertain about.
 */
export function canPublishSitemap(input: { singleRepo: boolean; hasRecord: boolean }): boolean {
  return input.singleRepo || input.hasRecord;
}

/**
 * `sitemap.xml` for the docs site in scope — the adapter between the request (host, tenant
 * header, content source) and the renderer's page walk. Mirrors `handleLlmsRequest`, which
 * solves the identical problem for `/llms.txt`.
 *
 * ANONYMOUS access on purpose: a crawler has no reader session, so the sitemap describes what
 * an anonymous fetch can actually retrieve. On a site with reader auth that is the
 * `public: true` subset, and the gated pages are absent rather than listed-and-unfetchable —
 * which would both waste crawl budget and publish the URLs of pages meant to be internal.
 *
 * Empty on any failure. A sitemap is a hint; a 500 on `/sitemap.xml` is a broken site.
 */
export async function tenantSitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = docsOriginFor((await headers()).get("host"));
  if (!origin) return [];

  try {
    const singleRepo = Boolean(process.env.PAPERVINE_CONTENT);
    const record = singleRepo ? null : await requestSiteRecord();
    if (!canPublishSitemap({ singleRepo, hasRecord: Boolean(record) })) return [];

    const src = await requestContentSource();
    // Derived from the SAME record the check above used, so the two can't disagree.
    const access = accessForRecord(record, undefined, { anonymous: true });
    const build = () => withReaderAccess(access, () => renderSitemap(origin));
    const urls = src ? await contentContext.run(src, build) : await build();
    return urls.map((u) => ({
      url: u.url,
      ...(u.lastModified ? { lastModified: u.lastModified } : {}),
    }));
  } catch {
    return [];
  }
}
