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
};

export default nextConfig;
