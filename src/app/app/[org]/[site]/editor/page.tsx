import { requireSite } from "@/lib/dashboard-context";
import { requestContentSource } from "@/lib/request-source";
import { contentContext } from "@papervine/renderer/lib/content";
import { buildNav, type NavSection, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";
import { resolvePagePath, listSessions } from "@/lib/authoring-core";
import { EditorShell } from "@/components/editor/EditorShell";

// The first page slug in the nav (the editor opens on it). Empty string → index.
function firstSlug(sections: NavSection[]): string {
  const walk = (nodes: (NavLeaf | NavNode)[]): string | null => {
    for (const n of nodes) {
      if ("href" in n) return n.href.replace(/^\//, "");
      const found = walk(n.items);
      if (found !== null) return found;
    }
    return null;
  };
  for (const s of sections) {
    const found = walk(s.nodes);
    if (found !== null) return found;
  }
  return "";
}

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; site: string }>;
  searchParams: Promise<{ branch?: string; slug?: string }>;
}) {
  const { org, site } = await params;
  const { branch: branchParam, slug: slugParam } = await searchParams;
  const ctx = await requireSite(org, site);
  const siteRow = ctx.site;

  // Open on the site's configured deploy branch by default (the incumbent's "Default"), NOT a
  // freshly-minted edit branch — landing the editor on the live branch the way the incumbent does.
  // Drafts buffer in a session keyed on this branch, created lazily on the first edit
  // (saveDraft auto-checks-out), so a clean load creates no branch and reads the synced
  // content; Publish then commits straight to the deploy branch. An explicit ?branch= (or
  // "Create new branch" in the switcher) opens a working branch instead, which publishes as a PR.
  const sessions = await listSessions(siteRow);
  const branch = branchParam || siteRow.branch;
  const sessionBranches = [...new Set([...sessions.map((s) => s.branch), branch])];

  // Build the nav + initial page from the DRAFT overlay for this branch.
  const src = await requestContentSource(siteRow.slug, { draftBranch: branch });
  if (!src) {
    return (
      <div className="p-10 text-sm text-neutral-500">
        This site hasn’t synced any content yet. Connect and sync a repo first, then open the editor.
      </div>
    );
  }

  const { sections, initialSlug, initialPath, initialMarkdown } = await contentContext.run(src, async () => {
    // Read config straight from `src`, NOT the memoized `loadConfig()`. The root layout renders
    // first on this app host, finds no tenant source (no slug/custom-domain — see
    // requestContentSource), and primes the per-request React `cache()` for `loadConfig` with the
    // DEFAULT content/ repo. That memo is keyed only on args (none), so our `contentContext.run`
    // here can't override it — `loadConfig()` would return Papervine's own docs.json and the
    // sidebar would show OUR pages, not the edited site's. `loadPage` (used by buildNav) isn't
    // primed by the layout, so it reads the draft correctly; only config needs the direct read.
    const config = await src.loadConfig();
    const sections = await buildNav(config, "");
    const initialSlug = slugParam ?? firstSlug(sections);
    const { path, raw } = await resolvePagePath(siteRow, branch, initialSlug);
    return { sections, initialSlug, initialPath: path, initialMarkdown: raw ?? "" };
  });

  return (
    <EditorShell
      org={org}
      site={site}
      deployBranch={siteRow.branch}
      initialBranch={branch}
      sections={sections}
      sessionBranches={sessionBranches}
      initialSlug={initialSlug}
      initialPath={initialPath}
      initialMarkdown={initialMarkdown}
    />
  );
}
