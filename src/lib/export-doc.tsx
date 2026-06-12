import "server-only";
import { loadConfig } from "./content";
import { collectExportPages } from "./export-content";
import { Mdx } from "./mdx";

// Self-contained print stylesheet for the export view. The document is a print artifact —
// always light, one nav page per printed page — so it carries its own layout rather than
// the docs chrome (no sidebar/navbar/TOC). `break-before: page` puts each doc page on its
// own sheet; the cover gets its own sheet too. Injected once at the top of the document.
const EXPORT_CSS = `
.pv-export { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
.pv-export-cover { display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center; min-height: 60vh;
  border-bottom: 1px solid rgba(0,0,0,.08); margin-bottom: 3rem; }
.pv-export-cover h1 { font-size: 2.5rem; font-weight: 700; letter-spacing: -.02em; }
.pv-export-cover p { color: #6b7280; margin-top: .75rem; }
.pv-export-page + .pv-export-page { margin-top: 3.5rem; }
@media print {
  .pv-no-print { display: none !important; }
  .pv-export { padding-top: 0; }
  .pv-export-cover { min-height: 100vh; margin-bottom: 0; border: 0; break-after: page; }
  .pv-export-page { break-before: page; }
  @page { margin: 1.6cm; }
}
`;

/**
 * Render every page of the docs site in scope as one stacked, print-ready document — the
 * artifact behind Settings → Exports ("Export all content", SPEC §10.4). Reuses the real
 * MDX renderer (`Mdx`) so the export has full fidelity: components, Shiki-highlighted
 * code, the lot. Must run inside the tenant's `contentContext` (the route sets it).
 *
 * `linkBase`/`assetBase` are threaded into `Mdx` exactly as `renderTenantDocs` does, so
 * intra-doc links and image/asset URLs resolve against the right host in both serving
 * modes (subdomain → empty bases; apex path mode → `/sites/{slug}` + the asset proxy).
 */
export async function renderExportDoc({
  linkBase,
  assetBase,
}: {
  linkBase: string;
  assetBase: string;
}) {
  const config = await loadConfig();
  const pages = await collectExportPages();

  return (
    <div className="pv-export">
      <style dangerouslySetInnerHTML={{ __html: EXPORT_CSS }} />
      <header className="pv-export-cover">
        <h1>{config.name}</h1>
        <p>
          {pages.length} {pages.length === 1 ? "page" : "pages"} · exported for offline
          viewing
        </p>
      </header>

      {pages.map(({ title, href, page }) => (
        <article key={href} className="prose pv-export-page min-w-0">
          <h1>{page.frontmatter.title ?? title}</h1>
          {page.frontmatter.description && (
            <p className="!mt-2 text-lg text-zinc-500 dark:text-zinc-400">
              {page.frontmatter.description}
            </p>
          )}
          <Mdx source={page.body} linkBase={linkBase} assetBase={assetBase} />
        </article>
      ))}
    </div>
  );
}
