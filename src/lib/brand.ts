// Papervine's own brand assets, served at stable URLs under `/brand/…`.
//
// Why a route and not a folder of static files: this repo has NO `public/` directory, on purpose
// (SPEC §2 — tenant assets are read from storage at request time), and apex middleware rewrites
// every root path ending in an asset extension to the docs-content reader. So a file dropped at
// `/logo.svg` doesn't get served, it gets looked up in the tenant's content — which is why there
// was no URL for our own logotype at all: the artwork existed three times over (`docs/logo/*.svg`,
// `examples/starter/logo/*.svg`, `src/assets/papervine-logo.png`) and none of it was addressable.
//
// `/brand/*` is bypassed in the apex and app-host middleware branches only. NOT on a tenant host:
// a customer's repo may legitimately have `/brand/hero.png`, and their path space stays theirs.
//
// The files live in `src/assets/brand/` and are read from disk by the route handler, with
// `outputFileTracingIncludes` in next.config.mjs keeping them in the serverless bundle. Reading at
// request time rather than inlining them as base64 constants is what makes the 512px PWA icon
// (330KB) practical to ship here at all.

/** One servable asset: the file in `src/assets/brand/`, and what to say it is. */
export interface BrandAsset {
  file: string;
  type: string;
  /** True for the SVG/text assets, so the route can send a charset. */
  text?: boolean;
}

/**
 * The allowlist. A request for anything not named here 404s, which is also the path-traversal
 * guard: the URL segment is a KEY into this table, never a filename that reaches the filesystem.
 */
export const BRAND_ASSETS: Record<string, BrandAsset> = {
  // The logotype: mark + wordmark. Named by the background they sit on rather than "light"/"dark",
  // because docs.json's own `logo.light` means "the file used in light mode" and gets misread
  // roughly half the time.
  "logotype.svg": { file: "logotype.svg", type: "image/svg+xml", text: true },
  "logotype-on-dark.svg": { file: "logotype-on-dark.svg", type: "image/svg+xml", text: true },
  /** The square mark alone, for avatars and app icons. */
  "mark.svg": { file: "mark.svg", type: "image/svg+xml", text: true },
  "favicon.ico": { file: "favicon.ico", type: "image/x-icon" },
  "favicon-16x16.png": { file: "favicon-16x16.png", type: "image/png" },
  "favicon-32x32.png": { file: "favicon-32x32.png", type: "image/png" },
  "apple-touch-icon.png": { file: "apple-touch-icon.png", type: "image/png" },
  "android-chrome-192x192.png": { file: "android-chrome-192x192.png", type: "image/png" },
  "android-chrome-512x512.png": { file: "android-chrome-512x512.png", type: "image/png" },
  "site.webmanifest": { file: "site.webmanifest", type: "application/manifest+json", text: true },
};

/** URL prefix every brand asset is served under — the string the middleware bypasses match. */
export const BRAND_PREFIX = "/brand/";

/** The public URL for a brand asset. Throws on a name that isn't served, so a typo fails loudly. */
export function brandAssetUrl(name: keyof typeof BRAND_ASSETS | string): string {
  if (!(name in BRAND_ASSETS)) throw new Error(`brandAssetUrl: no brand asset named "${name}"`);
  return `${BRAND_PREFIX}${name}`;
}

/**
 * The `<head>` icon set for PLATFORM surfaces — the marketing apex, the auth and legal pages, and
 * the dashboard on the app host.
 *
 * Deliberately not Next's `app/favicon.ico` file convention: that injects a `<link rel="icon">`
 * into every page under the root layout, and tenant docs pages share that layout — so a customer's
 * site would carry Papervine's icon alongside its own (`<Favicon>` from their `docs.json`), with
 * the browser free to pick either. Emitting these only when there's no tenant source keeps our
 * brand off their pages.
 */
export const PLATFORM_ICONS = [
  { rel: "icon", href: brandAssetUrl("favicon.ico"), sizes: "any" },
  { rel: "icon", href: brandAssetUrl("favicon-32x32.png"), type: "image/png", sizes: "32x32" },
  { rel: "icon", href: brandAssetUrl("favicon-16x16.png"), type: "image/png", sizes: "16x16" },
  { rel: "apple-touch-icon", href: brandAssetUrl("apple-touch-icon.png"), sizes: "180x180" },
  { rel: "manifest", href: brandAssetUrl("site.webmanifest") },
] as const;
