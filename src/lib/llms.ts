import "server-only";
import { loadConfig, loadPage } from "./content";
import { listPages } from "./docs-tools";

/**
 * Render the llms.txt / llms-full.txt index for the docs site in scope (SPEC §9.1,
 * §10.1). The llmstxt.org convention: an H1 with the site name, then a linked list of
 * every page so an AI client can discover the docs in one fetch. `full` additionally
 * inlines each page's Markdown body (llms-full.txt) for clients that want the whole
 * corpus without crawling. Must run inside the tenant's `contentContext` (the caller
 * sets it) so loadConfig/listPages/loadPage read the right source.
 */
export async function renderLlmsTxt(origin: string, full: boolean): Promise<string> {
  const config = await loadConfig();
  const pages = await listPages();

  const lines: string[] = [`# ${config.name}`, "", "## Docs", ""];
  for (const p of pages) {
    lines.push(`- [${p.title}](${origin}${p.href})`);
  }
  if (!full) return lines.join("\n") + "\n";

  for (const p of pages) {
    const page = await loadPage(p.href.replace(/^\//, ""));
    if (!page) continue;
    lines.push("", "---", "", `# ${p.title}`, `Source: ${origin}${p.href}`, "", page.body.trim());
  }
  return lines.join("\n") + "\n";
}
