/** @type {import('next').NextConfig} */
const nextConfig = {
  // The renderer core ships as TS/TSX source (workspace package), so Next must
  // compile it rather than treat it as a pre-built dependency.
  transpilePackages: ["@papervine/renderer"],
  // The MDX compiler stack breaks when webpack bundles it for RSC — keep it
  // external so it's required at runtime (same constraint as the web app).
  serverExternalPackages: ["@mintlify/mdx", "next-mdx-remote-client"],
};

export default nextConfig;
