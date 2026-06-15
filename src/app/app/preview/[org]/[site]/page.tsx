import { requireSite } from "@/lib/dashboard-context";
import { requestContentSource } from "@/lib/request-source";
import { contentContext, loadConfig, loadPage } from "@papervine/renderer/lib/content";
import { Mdx } from "@papervine/renderer/lib/mdx";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";

// Live draft preview for the web editor (SPEC §9.2). Renders the current draft of one page
// through THE REAL renderer (`<Mdx>`) — the same engine, component map, and theme that ship
// to readers — so the editor's Preview tab is byte-faithful to publish, not a WYSIWYG
// approximation. Loaded in an <iframe> by MdxEditorPane.
//
// It lives at /app/preview/* (outside the [org] dashboard layout) ON PURPOSE: the iframe must
// show ONLY the rendered article, not the AppRail/PlatformShell chrome. It still inherits the
// root layout, so globals.css (.prose, Shiki, the MDX component styles) applies.
//
// Draft-aware: reads through `requestContentSource(slug, {draftBranch})`, the same overlay the
// editor loads content from, so unsaved-but-buffered edits appear. force-dynamic + the overlay's
// un-cached reads mean every load reflects the latest draft.
export const dynamic = "force-dynamic";

export default async function EditorPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; site: string }>;
  searchParams: Promise<{ branch?: string; slug?: string }>;
}) {
  const { org, site } = await params;
  const { branch, slug = "" } = await searchParams;
  // Authorize exactly like the editor: session → org membership → org-scoped site (404s others).
  const ctx = await requireSite(org, site);
  const siteRow = ctx.site;

  const src = branch
    ? await requestContentSource(siteRow.slug, { draftBranch: branch })
    : await requestContentSource(siteRow.slug);
  if (!src) {
    return <PreviewNotice>This site hasn’t synced any content yet.</PreviewNotice>;
  }

  // Assets resolve through the tenant-asset handler (path mode); links are inert in a preview.
  const assetBase = `/api/tenant-asset/${siteRow.slug}`;

  return contentContext.run(src, async () => {
    const config = await loadConfig();
    const page = await loadPage(slug);
    if (!page) {
      return <PreviewNotice>Nothing to preview for this page yet.</PreviewNotice>;
    }

    const theme = resolveTheme(config.theme);
    const c = config.colors;
    const themeVars = `:root{--color-primary:${c.primary};--color-primary-light:${
      c.light ?? c.primary
    };--color-primary-dark:${c.dark ?? c.primary};${themeCssVars(theme.tokens)};}`;

    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
        <div className="mx-auto max-w-3xl px-8 py-10">
          <article className="prose min-w-0">
            {page.frontmatter.title && <h1>{page.frontmatter.title}</h1>}
            {page.frontmatter.description && (
              <p className="!mt-2 text-lg text-zinc-500 dark:text-zinc-400">
                {page.frontmatter.description}
              </p>
            )}
            <Mdx source={page.body} linkBase="" assetBase={assetBase} />
          </article>
        </div>
      </>
    );
  });
}

function PreviewNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16 text-sm text-zinc-500 dark:text-zinc-400">
      {children}
    </div>
  );
}
