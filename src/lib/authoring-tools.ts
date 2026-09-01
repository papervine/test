import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SiteRow } from "./dashboard-context";
import type { ContentSource } from "@papervine/renderer/lib/content";
import { draftSource } from "./draft-source";
import { contentVersion, liveContentPrefix } from "./revisions";
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
import { hasGitRepo } from "./site-source";
import { findOpenSession, listDraftFiles, upsertDraftFile } from "./draft-store";
import { listKeys, putObject } from "./storage";
import { mimeForPath } from "./sync-plan";
import { draftAssetKey, uploadTargetPath, validateUpload } from "./media-upload";
import { bytesFromDataUrl, type ImageAttachment } from "./agent-attachments";

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
  return draftSource(site.id, branch, contentVersion(site), liveContentPrefix(site));
}

export function authoringTools(
  site: SiteRow,
  branch: string,
  opts: { attachments?: ImageAttachment[] } = {},
): ToolSet {
  // A Papervine-hosted site has no repo and no PR target (SPEC §10.11). Rather than let the
  // agent call a tool that would hit GitHub with a null owner — or offer it a publish mode
  // the server will ignore — the Git-only capabilities are omitted from its toolset
  // entirely, and `publish` describes the one action that actually exists.
  const gitBacked = hasGitRepo(site);
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

    ...(gitBacked
      ? {
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
        }
      : {}),

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
      description: gitBacked
        ? "Publish the current draft. mode 'pr' opens a pull request into the deploy branch " +
          "(safe default); mode 'commit' commits straight to it. ONLY call this when the user " +
          "explicitly asks to publish or open a PR — never on your own."
        : "Publish the current draft straight to the live site. This site is hosted by " +
          "Papervine — there is no repository, so there are no branches or pull requests. " +
          "ONLY call this when the user explicitly asks to publish — never on your own.",
      inputSchema: gitBacked
        ? z.object({
            mode: z
              .enum(["pr", "commit"])
              .describe("'pr' opens a PR; 'commit' writes to the deploy branch."),
            message: z.string().optional().describe("Commit / PR title."),
          })
        : z.object({ message: z.string().optional().describe("A short title for this publish.") }),
      execute: async (input) => {
        const { message } = input as { message?: string };
        // Ignored by the hosted publisher; 'commit' is the safe Git default when the
        // narrower hosted schema means no mode was offered at all.
        const mode = (input as { mode?: "pr" | "commit" }).mode ?? "commit";
        return publishDraft(site, branch, { mode, message });
      },
    }),

    discard: tool({
      description: "Discard all unpublished edits on the current branch. Irreversible.",
      inputSchema: z.object({}),
      execute: async () => discardSession(site, branch),
    }),

    // Only offered when the conversation actually carries an image, so the model is never
    // shown a capability with nothing to use it on (the same rule that hides list_branches
    // on a hosted site).
    ...(opts.attachments?.length
      ? {
          save_attachment: tool({
            description:
              "Save an image the user ATTACHED to this conversation into the site's assets, " +
              "so a page can show it. Returns the markdown to embed. The bytes buffer to the " +
              "draft like any other edit — nothing is live until publish. Call this BEFORE " +
              "adding an attached image to a page; page edits must reference the returned " +
              "path, never the raw attachment.",
            inputSchema: z.object({
              filename: z
                .string()
                .describe("The attachment's filename as it appears in the conversation."),
              alt: z.string().optional().describe("Alt text for the image."),
            }),
            execute: async ({ filename, alt }) => {
              // Newest-first, so "screenshot.png" means the one just sent when names repeat.
              const attachment = opts.attachments!.find(
                (a) => a.filename.toLowerCase() === filename.toLowerCase(),
              );
              if (!attachment) {
                return {
                  error: `No attached image named "${filename}". Attached: ${opts
                    .attachments!.map((a) => a.filename)
                    .join(", ")}.`,
                };
              }
              const bytes = bytesFromDataUrl(attachment.url);
              const valid = validateUpload("image", attachment.filename, bytes.length);
              if ("error" in valid) return valid;

              // The same pipeline as a human upload (src/lib/actions/media.ts), minus the
              // presign hop — the bytes are already server-side, in the conversation. The
              // route checked the session out before any tool can run, so it exists.
              const session = await findOpenSession(site.id, branch);
              if (!session) return { error: "No open edit session for this branch." };
              const prefix = liveContentPrefix(site);
              const published = (await listKeys(prefix)).map((k) => k.slice(prefix.length));
              const drafted = (await listDraftFiles(session.id)).map((f) => f.path);
              const path = uploadTargetPath("image", attachment.filename, [
                ...published,
                ...drafted,
              ]);
              if (!path) return { error: "That file type isn't supported here." };

              await putObject(draftAssetKey(session.id, path), bytes, mimeForPath(path));
              // content stays empty: `binary` says the bytes are in storage, not in Postgres.
              await upsertDraftFile({ sessionId: session.id, path, content: "", binary: true });
              return { ok: true, path, markdown: `![${alt ?? ""}](/${path})` };
            },
          }),
        }
      : {}),
  };
}
