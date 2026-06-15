import { requireSite } from "@/lib/dashboard-context";
import { requestContentSource } from "@/lib/request-source";
import { contentContext, loadConfig } from "@papervine/renderer/lib/content";
import { buildNav, type NavSection, type NavLeaf, type NavNode } from "@papervine/renderer/lib/nav";
import { checkoutBranch, resolvePagePath, listSessions } from "@/lib/authoring-core";
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

  // Resolve the working branch: an explicit ?branch=, else the most recent open session,
  // else mint one (only when none exists, so a refresh doesn't spawn branches).
  const sessions = await listSessions(siteRow);
  let branch = branchParam || sessions[sessions.length - 1]?.branch;
  if (!branch) {
    branch = (await checkoutBranch(siteRow, { actorUserId: ctx.session.user.id })).branch;
  }
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
    const config = await loadConfig();
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
