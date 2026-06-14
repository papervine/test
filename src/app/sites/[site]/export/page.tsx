import { headers, cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import { READER_COOKIE, readerSessionValid } from "@/lib/reader-session";
import { requestContentSource } from "@/lib/request-source";
import { contentContext } from "@papervine/renderer/lib/content";
import { renderExportDoc } from "@/lib/export-doc";
import { PrintControls } from "@/components/export/PrintControls";

// The combined "export all content" view (SPEC §10.4). A static segment that wins over the
// docs catch-all (`[[...path]]`), the same way `/login` does — so `/export` is the export,
// not a page named "export". Reached via the apex path form (`/sites/{slug}/export`, the
// URL the dashboard links) and via the subdomain host (middleware rewrites
// `{slug}.host/export` → here). Renders every page stacked for print → "Save as PDF".
export const dynamic = "force-dynamic";
// Large docs sites enumerate + render every page in one request; give it headroom like the
// sync routes (the default 15s can be tight for a few-hundred-page repo on a cold lambda).
export const maxDuration = 60;

type Params = { site: string };

export default async function ExportAllPage({ params }: { params: Promise<Params> }) {
  const { site: slug } = await params;

  // Mirror the docs page's host/base resolution so links + assets resolve in both serving
  // modes, and a subdomain host can only address its own slug.
  const hostSlug = resolveTenantSlug((await headers()).get("host"));
  if (hostSlug && hostSlug !== slug) notFound();
  const base = hostSlug ? "" : `/sites/${slug}`;
  const assetBase = hostSlug ? "" : `/api/tenant-asset/${slug}`;

  // Same reader-auth gate as renderTenantDocs (SPEC §11.2): an auth-gated site must not
  // leak its full corpus through the export. A reader without a valid session is bounced
  // to the site's login, round-tripping back here after signing in.
  const record = await getSiteBySlug(slug);
  if (record?.authEnabled) {
    const cookie = (await cookies()).get(READER_COOKIE)?.value;
    if (!readerSessionValid(cookie, record.id)) {
      redirect(`${base}/login?redirect=${encodeURIComponent(`${base}/export`)}`);
    }
  }

  const src = await requestContentSource(slug);
  if (!src) notFound();

  const doc = await contentContext.run(src, () =>
    renderExportDoc({ linkBase: base, assetBase }),
  );

  return (
    <>
      <PrintControls />
      {doc}
    </>
  );
}
