import { TenantDocsShell, sitesTenantTarget } from "@/lib/render-tenant";

// Persistent docs chrome (navbar + tabs + sidebar + assistant) for a tenant. It sits in a
// (docs) route group at the [site] level — NOT at [[...path]] — on purpose: its only param
// is {site}, which doesn't change as you navigate between pages, so React keeps this layout
// mounted and re-renders just the article segment underneath. (At [[...path]] the catch-all
// param changes every navigation, which would re-render the whole shell.) The group also
// keeps the shell off the sibling login/export routes. Mirrors the apex (docs)/layout.tsx.
export const dynamic = "force-dynamic";

export default async function TenantDocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ site: string }>;
}) {
  const { site: slug } = await params;
  const { base, assetBase } = await sitesTenantTarget(slug);
  return (
    <TenantDocsShell slug={slug} base={base} assetBase={assetBase}>
      {children}
    </TenantDocsShell>
  );
}
