import type { Metadata } from "next";
import { domains } from "./tenant-host";

/**
 * Shared metadata for the PLATFORM's own public pages — the marketing apex (SPEC §2), not
 * tenant docs.
 *
 * The distinction is load-bearing and the reason this doesn't live in the root layout: that
 * layout renders for every host, tenant docs included, so anything it stamped would attribute a
 * *customer's* docs card to us. Our handle and our canonical host belong only on pages that are
 * ours, so they're applied per-page from here. A tenant that wants its own handle sets
 * `seo.metatags` in its `docs.json` (see `@papervine/renderer/lib/seo`).
 */

/**
 * Papervine's X account, emitted as `twitter:site`/`twitter:creator`. X uses it to attribute the
 * card and to render the "from @papervine_io" line; without it a card is anonymous.
 */
export const X_HANDLE = "@papervine_io";

/**
 * The canonical origin for marketing pages. Hardcoded rather than taken from the request (which
 * is what tenant docs do, see request-origin.ts) because these pages have exactly ONE canonical
 * home: a preview deployment or a bare `*.vercel.app` hit must still point search engines and
 * crawlers at the real apex, not at itself.
 */
export const MARKETING_ORIGIN = `https://www.${domains.platform}`;

export function marketingMetadata(input: {
  /** Used verbatim — see `absolute` below. */
  title: string;
  description: string;
  /** Root-relative path of the page, e.g. `/` or `/pricing`. */
  path: string;
  keywords?: string[];
}): Metadata {
  return {
    // `absolute`, because the root layout's `%s · Papervine` template would otherwise append a
    // second "Papervine" to titles that already carry the brand — which is what made the
    // pricing page render "Pricing — Papervine · Papervine".
    title: { absolute: input.title },
    description: input.description,
    ...(input.keywords ? { keywords: input.keywords } : {}),
    // Without a metadataBase, Next resolves the relative URLs below against localhost — so
    // og:url shipped as "/" and social crawlers had nothing absolute to follow.
    metadataBase: new URL(MARKETING_ORIGIN),
    alternates: { canonical: input.path },
    openGraph: {
      type: "website",
      siteName: "Papervine",
      title: input.title,
      description: input.description,
      url: input.path,
    },
    // The image itself comes from each page's `opengraph-image.tsx` (Next merges it in and
    // mirrors it onto `twitter:image`), so it isn't named here.
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      site: X_HANDLE,
      creator: X_HANDLE,
    },
  };
}
