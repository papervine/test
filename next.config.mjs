import { withSentryConfig } from "@sentry/nextjs";
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output directory, overridable so a test harness can have its OWN.
  //
  // Next allows one `next dev` per distDir (it holds `<distDir>/dev/lock`), and two dev
  // servers sharing one output tree also interleave their compiled chunks and manifests —
  // which is how running the smoke gate while `npm run dev` was up corrupted the dev
  // server's `.next` and forced a `dev:fresh`. Each harness now sets NEXT_DIST_DIR
  // (`.next-smoke`, `.next-crawl`, `.next-e2e`), so tests run happily alongside your dev
  // server: separate output, separate lock, and — since e2e already uses `papervine_test` —
  // separate database. Unset (dev, `next build`, Vercel) keeps the default `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Content lives outside the app dir (../content) and is read at request time,
  // so nothing tenant-specific is baked into the build. Mirrors the runtime-render
  // model in SPEC.md §2.
  outputFileTracingIncludes: {
    "/**": ["./content/**/*"],
  },
  // The MDX compiler stack (unified/@mdx-js + next-mdx-remote-client) breaks when
  // webpack bundles it for RSC — keep it external so it's required at runtime.
  serverExternalPackages: ["@mintlify/mdx", "next-mdx-remote-client"],
  // `next dev` refuses cross-origin requests for /_next/* dev resources unless the origin is
  // listed here. Our e2e suite must address the app as 127.0.0.1 (some runners resolve
  // `localhost` to IPv6 ::1 while Next listens on IPv4 — the fetch-127.0.0.1 rule in
  // CLAUDE.md), and `*.localhost` subdomain hosts are a different origin again. Without this
  // the HTML renders but every client chunk 403s, so pages run with NO JavaScript: nothing
  // hydrates, and any spec touching interactivity fails in a way that looks like a product
  // bug (a button that "does nothing") rather than a blocked asset. Dev-only setting.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.localhost"],
  // The renderer core ships as TS/TSX source (workspace package), so Next must
  // compile it rather than treat it as a pre-built dependency.
  transpilePackages: ["@papervine/renderer"],
  // Tenant content images render through next/image (packages/renderer/lib/mdx.tsx). They're
  // same-origin (served by /api/tenant-asset/…, or the host-rewritten /img/… path), so the
  // optimizer needs no remotePatterns — only AVIF added to the default WebP negotiation.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    // Client-side Router Cache reuse window. Next 15 defaults `dynamic` to 0, which means a
    // prefetched-but-dynamic route (every dashboard/settings page — they read the session
    // cookie, so they render dynamically) is treated as immediately stale: <Link> prefetches
    // the RSC, then THROWS IT AWAY and refetches on click. That's a live round-trip on every
    // navigation (~200ms TTFB measured), so settings tabs feel like "click → wait → change"
    // instead of hosted docs platforms' "changed before you let go" (their prefetched RSC is reused from
    // cache → ~40ms, 0 network). Giving dynamic entries a 30s freshness window lets the
    // prefetch be reused, turning sibling-tab navigation into an instant client render.
    //
    // Safe because our mutations go through server actions that call revalidatePath (see
    // settings/*/actions.ts), which busts the cached entry — so freshly-changed data still
    // shows. 30s only affects re-visiting an already-fetched route within the window; a hard
    // refresh or the revalidate always wins. (This was Next 14.1's own former default.)
    staleTimes: {
      dynamic: 30,
    },
    // The editor autosaves whole MDX files through a Server Action (saveDraftAction). Next's
    // default 1 MB body cap is low for a docs editor: a large API-reference page or one with an
    // embedded data-URI image can legitimately exceed it, and the whole file rides one request.
    // Raise it to 4 MB. (This is headroom for real pages — NOT a cover for runaway growth; the
    // Visual-editor emit is a fixed point, see mdx-prosemirror-emit-idempotent.test.ts.)
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "newnewmedia",

  project: "papervine",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
