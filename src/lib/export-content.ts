import "server-only";
import { loadPage, type Page } from "./content";
import { listPages } from "./docs-tools";

/** One page in the combined export: its nav title/href plus the loaded source. */
export type ExportPage = { title: string; href: string; page: Page };

/**
 * Collect every page of the docs site in scope, in sidebar order, for the "export all
 * content" PDF (SPEC §10.4). Structurally the same enumerate-all-pages walk as
 * llms-full.txt (`renderLlmsTxt`): `listPages()` gives the nav-ordered leaves, then we
 * load each body. A leaf with no loadable page (e.g. an API group entry, or a stale nav
 * reference) is skipped rather than failing the whole export. Must run inside the
 * tenant's `contentContext` so the reads hit the right source.
 */
export async function collectExportPages(): Promise<ExportPage[]> {
  const pages = await listPages();
  const loaded = await Promise.all(
    pages.map(async ({ title, href }) => {
      const page = await loadPage(href.replace(/^\//, ""));
      return page ? { title, href, page } : null;
    }),
  );
  return loaded.filter((p): p is ExportPage => p !== null);
}
