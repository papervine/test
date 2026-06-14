import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPage, listPageSlugs, loadConfig } from "@papervine/renderer/lib/content";
import { buildNav, findGroupLabel } from "@papervine/renderer/lib/nav";
import { loadApiCatalog } from "@papervine/renderer/lib/openapi";
import { Mdx, extractToc } from "@papervine/renderer/lib/mdx";
import { TableOfContents } from "@papervine/renderer/components/TableOfContents";
import { EndpointReference } from "@papervine/renderer/components/api/EndpointReference";

type Params = { slug?: string[] };

export async function generateStaticParams(): Promise<Params[]> {
  const slugs = await listPageSlugs();
  const config = await loadConfig();
  const opSlugs = [...(await loadApiCatalog(config)).keys()];
  return [...slugs, ...opSlugs].map((s) => ({ slug: s === "" ? [] : s.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugStr = (slug ?? []).join("/");
  const page = await loadPage(slugStr);
  if (page) {
    return { title: page.frontmatter.title, description: page.frontmatter.description };
  }
  const op = (await loadApiCatalog(await loadConfig())).get(slugStr);
  if (op) return { title: op.summary ?? `${op.method} ${op.path}`, description: op.description };
  return {};
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const slugStr = (slug ?? []).join("/");
  const config = await loadConfig();
  const page = await loadPage(slugStr);

  // MDX page.
  if (page) {
    const toc = extractToc(page.body);
    // Eyebrow: the group this page belongs to, shown above the title.
    const sections = await buildNav(config);
    const eyebrow = findGroupLabel(sections, "/" + (slugStr || "index"));

    return (
      <div className="flex items-start gap-10 px-8 py-10">
        <article className="prose min-w-0 flex-1">
          {eyebrow && <div className="mb-2 text-sm font-semibold text-primary">{eyebrow}</div>}
          {page.frontmatter.title && <h1>{page.frontmatter.title}</h1>}
          {page.frontmatter.description && (
            <p className="!mt-2 text-lg text-zinc-500 dark:text-zinc-400">
              {page.frontmatter.description}
            </p>
          )}
          <Mdx source={page.body} />
        </article>
        <TableOfContents items={toc} />
      </div>
    );
  }

  // Auto-generated OpenAPI endpoint page.
  const op = (await loadApiCatalog(config)).get(slugStr);
  if (op) {
    return (
      <div className="flex items-start gap-10 px-8 py-10">
        <EndpointReference op={op} baseUrl={op.baseUrl} />
      </div>
    );
  }

  notFound();
}
