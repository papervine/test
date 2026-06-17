import { TenantDocsShell } from "@/lib/render-tenant";
import { resolveCustomDomainSite } from "./resolve";

// Persistent docs chrome for a custom-domain tenant. Sits in a (docs) route group with NO
// dynamic params of its own (the site is resolved from the Host), so it stays mounted across
// page navigations — only the article segment re-renders. The group keeps the shell off the
// sibling login route. Mirrors the /sites (docs) layout.
export const dynamic = "force-dynamic";

export default async function CustomDomainLayout({ children }: { children: React.ReactNode }) {
  const { record, base, assetBase } = await resolveCustomDomainSite();
  return (
    <TenantDocsShell slug={record.slug} base={base} assetBase={assetBase}>
      {children}
    </TenantDocsShell>
  );
}
