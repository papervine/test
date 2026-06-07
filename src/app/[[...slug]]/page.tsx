import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPage, listPageSlugs } from "@/lib/content";
import { Mdx, extractToc } from "@/lib/mdx";
import { TableOfContents } from "@/components/TableOfContents";

type Params = { slug?: string[] };

export async function generateStaticParams(): Promise<Params[]> {
  const slugs = await listPageSlugs();
  return slugs.map((s) => ({ slug: s === "" ? [] : s.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage((slug ?? []).join("/"));
  if (!page) return {};
  return {
    title: page.frontmatter.title,
    description: page.frontmatter.description,
  };
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = await loadPage((slug ?? []).join("/"));
  if (!page) notFound();

  const toc = extractToc(page.body);

  return (
    <div className="flex gap-10 px-8 py-10">
      <article className="prose min-w-0 flex-1">
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
