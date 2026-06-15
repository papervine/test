import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SiteRow } from "./dashboard-context";
import type { ContentSource } from "@papervine/renderer/lib/content";
import { draftSource } from "./draft-source";
import {
  resolvePagePath,
  saveDraft,
  publishDraft,
  checkoutBranch,
  discardSession,
  listSessions,
} from "./authoring-core";
import { listBranches } from "./github";
import { repoTokenForSite } from "./github-token";

/**
 * The editing agent's WRITE tools (SPEC §9.2) — the agent-native half of the authoring
 * backend. These wrap the SAME authoring-core functions the human editor's server actions
 * call, scoped to one (site, branch), so the agent and the human edit one draft buffer.
 *
 * The READ tools (searchDocs/readPage/listPages) are the existing assistant tools; the
 * route spreads them in and runs the whole stream inside the draft content context
 * (`draftContentSource` below), so the agent reads live drafts too.
 *
 * Tool names are snake_case so the editor UI can detect write-tool stream parts
 * (`tool-write_page`, …) and refetch the affected page.
 */

/** The draft-overlay content source for an editing session (read tools see live edits). */
export function draftContentSource(site: SiteRow, branch: string): ContentSource {
  return draftSource(site.id, branch, site.lastSyncedCommitSha ?? "");
}

export function authoringTools(site: SiteRow, branch: string): ToolSet {
  return {
    write_page: tool({
      description:
        "Create or completely replace a documentation page. `content` is the FULL MDX " +
        "including frontmatter. Buffers to the draft branch — it is NOT published until " +
        "the user asks you to publish.",
      inputSchema: z.object({
        slug: z.string().describe("Page slug, e.g. 'guides/intro' (no leading slash needed)."),
        content: z.string().describe("The full MDX content of the page, including frontmatter."),
      }),
      execute: async ({ slug, content }) => {
        const { path } = await resolvePagePath(site, branch, slug);
        await saveDraft(site, branch, path, content);
        return { ok: true, slug, path };
      },
    }),

    edit_page: tool({
      description:
        "Make a targeted edit to an existing page by replacing the first occurrence of " +
        "`find` with `replace`. Operates on the page's raw MDX (frontmatter included). " +
        "Buffers to the draft branch; not published until asked.",
      inputSchema: z.object({
        slug: z.string().describe("Page slug of an existing page."),
        find: z.string().describe("Exact text to find (the first match is replaced)."),
        replace: z.string().describe("Replacement text."),
      }),
      execute: async ({ slug, find, replace }) => {
        const { path, raw } = await resolvePagePath(site, branch, slug);
        if (raw === null) return { error: `No page found for "${slug}".` };
        if (!raw.includes(find)) return { error: `Couldn't find that text in "${slug}".` };
        await saveDraft(site, branch, path, raw.replace(find, replace));
        return { ok: true, slug, path };
      },
    }),

    delete_page: tool({
      description: "Delete a documentation page. Tombstones it in the draft until published.",
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => {
        const { path, raw } = await resolvePagePath(site, branch, slug);
        if (raw === null) return { error: `No page found for "${slug}".` };
        await saveDraft(site, branch, path, "", { deleted: true });
        return { ok: true, slug, path };
      },
    }),

    list_branches: tool({
      description: "List the repo's git branches and the open Papervine edit sessions.",
      inputSchema: z.object({}),
      execute: async () => {
        const token = await repoTokenForSite(site);
        const [branches, sessions] = await Promise.all([
          listBranches(site.repoOwner!, site.repoName!, token),
          listSessions(site),
        ]);
        return { branches, editSessions: sessions.map((s) => s.branch), current: branch };
      },
    }),

    checkout: tool({
      description:
        "Start a fresh edit session on a new working branch (or attach to a named one). " +
        "Returns the branch you are now editing.",
      inputSchema: z.object({
        branchName: z.string().optional().describe("Optional existing branch to attach to."),
      }),
      execute: async ({ branchName }) => {
        const res = await checkoutBranch(site, { branchName });
        return { branch: res.branch };
      },
    }),

    publish: tool({
      description:
        "Publish the current draft. mode 'pr' opens a pull request into the deploy branch " +
        "(safe default); mode 'commit' commits straight to it. ONLY call this when the user " +
        "explicitly asks to publish or open a PR — never on your own.",
      inputSchema: z.object({
        mode: z.enum(["pr", "commit"]).describe("'pr' opens a PR; 'commit' writes to the deploy branch."),
        message: z.string().optional().describe("Commit / PR title."),
      }),
      execute: async ({ mode, message }) => publishDraft(site, branch, { mode, message }),
    }),

    discard: tool({
      description: "Discard all unpublished edits on the current branch. Irreversible.",
      inputSchema: z.object({}),
      execute: async () => discardSession(site, branch),
    }),
  };
}
