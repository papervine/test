import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { robotsPolicyFor } from "@/lib/seo-routes";

/**
 * `robots.txt`, answered per host (SPEC §2) — see `src/lib/seo-routes.ts` for why one app
 * cannot serve one robots file: the marketing apex, the authenticated app host, tenant docs
 * subdomains and customers' own custom domains all arrive at this same route tree, and a
 * static file would describe the wrong site on three of them.
 *
 * Next caches this convention by default; reading `headers()` is a request-time API, which is
 * exactly what opts it out (see the robots.txt file-convention docs). Without that, the first
 * host to be crawled would have its answer served to every other one — the leak this exists
 * to prevent.
 */
// Explicit, not inferred from the `headers()` call below: this route's answer depends on
// the request Host, and a cached one would hand a tenant somebody else's file.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  const policy = robotsPolicyFor({
    host,
    singleRepo: Boolean(process.env.PAPERVINE_CONTENT),
  });
  return {
    rules: policy.allow
      ? { userAgent: "*", allow: "/" }
      : { userAgent: "*", disallow: "/" },
    ...(policy.sitemap ? { sitemap: policy.sitemap } : {}),
  };
}
