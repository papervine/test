import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSiteByCustomDomain } from "@/lib/tenant";

// Resolve a custom-domain request to its site + serving base. Shared by the layout (shell)
// and page (article) so they can't drift. getSiteByCustomDomain is a per-request cache(), so
// calling it from both halves is a single lookup. Assets go through the slug-keyed route
// (host-independent) so the next/image optimizer — which fetches the source without the
// custom-domain Host — can resolve them.
//
// `base` is site-level ("Host at /docs" → "/docs", else root), so the layout can compute it
// WITHOUT the path param it can't see. The page additionally validates/strips the path.
export async function resolveCustomDomainSite() {
  const h = await headers();
  const record = await getSiteByCustomDomain(h.get("x-papervine-host") ?? h.get("host") ?? "");
  if (!record) notFound();
  return {
    record,
    base: record.customDomainSubpath ? "/docs" : "",
    assetBase: `/api/tenant-asset/${record.slug}`,
  };
}

// The article also needs the content path: in "Host at /docs" mode we only own the /docs
// subtree, so strip the leading `docs` segment and 404 anything else.
export async function resolveCustomDomainPage(rawPath: string[]) {
  const site = await resolveCustomDomainSite();
  let path = rawPath;
  if (site.record.customDomainSubpath) {
    if (path[0] !== "docs") notFound();
    path = path.slice(1);
  }
  return { ...site, path };
}
