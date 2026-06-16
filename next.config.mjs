import { withSentryConfig } from "@sentry/nextjs";
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Content lives outside the app dir (../content) and is read at request time,
  // so nothing tenant-specific is baked into the build. Mirrors the runtime-render
  // model in SPEC.md §2.
  outputFileTracingIncludes: {
    "/**": ["./content/**/*"],
  },
  // The MDX compiler stack (unified/@mdx-js + next-mdx-remote-client) breaks when
  // webpack bundles it for RSC — keep it external so it's required at runtime.
  serverExternalPackages: ["@mintlify/mdx", "next-mdx-remote-client"],
  // The renderer core ships as TS/TSX source (workspace package), so Next must
  // compile it rather than treat it as a pre-built dependency.
  transpilePackages: ["@papervine/renderer"],
  // Tenant content images render through next/image (packages/renderer/lib/mdx.tsx). They're
  // same-origin (served by /api/tenant-asset/…, or the host-rewritten /img/… path), so the
  // optimizer needs no remotePatterns — only AVIF added to the default WebP negotiation.
  images: {
    formats: ["image/avif", "image/webp"],
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
