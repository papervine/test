import "server-only";
import { cache } from "react";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { parsePage, PAGE_EXTS, type ContentSource } from "@papervine/renderer/lib/content";
import { s3Source } from "./s3-source";
import { findOpenSession, getDraftFile, listDraftFiles } from "./draft-store";

// Draft-overlay content source (SPEC §9.2). Reads uncommitted edits for a session branch
// live from Postgres and falls through to the synced S3 content (`s3Source`) for every
// file the session hasn't touched. This is what lets the editor preview, the Source/Visual
// panes, and the editing agent all see the SAME in-progress draft.
//
// Two hard rules:
//  1. Drafts are read LIVE (not through `unstable_cache`) so the agent and the human see
//     each other's writes immediately — Postgres is the single source of truth.
//  2. This source is only ever used by editor surfaces that pass an explicit branch. The
//     public render path keeps using `s3Source` unchanged (see request-source.ts), so a
//     reader can never be served a draft.
//
// Draft paths are docs-root-relative (docsPath stripped), matching s3 keys: "guides/intro.mdx",
// "index.mdx", "docs.json".

/** Slug → candidate file paths, in PAGE_EXTS priority (mirrors s3Source.loadPage). */
function slugCandidates(slug: string): string[] {
  const normalized = slug === "" || slug === "/" ? "index" : slug;
  return PAGE_EXTS.map((ext) => `${normalized}${ext}`);
}

/** File path → slug ("index.mdx" → "", "guides/intro.mdx" → "guides/intro"). */
export function pathToSlug(path: string): string {
  const s = path.replace(/\.mdx?$/, "");
  return s === "index" ? "" : s;
}

export function isPagePath(path: string): boolean {
  return PAGE_EXTS.some((ext) => path.endsWith(ext));
}

// Resolve the open session once per request (buildNav fans out loadPage across the whole
// nav — without this each leaf would re-query the session row).
const resolveSession = cache((siteId: string, branch: string) => findOpenSession(siteId, branch));

export function draftSource(siteId: string, branch: string, baseVersion = ""): ContentSource {
  const base = s3Source(siteId, baseVersion);

  return {
    // Distinct from the s3Source it wraps: the same request renders both (a draft page beside the
    // published base) and they must not collide in the per-request memo.
    id: `draft:${siteId}:${branch}:${baseVersion}`,
    async loadConfig() {
      const session = await resolveSession(siteId, branch);
      if (session) {
        const draft = await getDraftFile(session.id, "docs.json");
        if (draft && !draft.deleted) {
          const { config, warnings } = parseDocsConfig(JSON.parse(draft.content));
          for (const w of warnings) console.warn(`docs.json (draft): ${w}`);
          return config;
        }
      }
      return base.loadConfig();
    },

    async loadPage(slug) {
      const session = await resolveSession(siteId, branch);
      if (session) {
        for (const path of slugCandidates(slug)) {
          const draft = await getDraftFile(session.id, path);
          if (draft) return draft.deleted ? null : parsePage(slug, draft.content);
        }
      }
      return base.loadPage(slug);
    },

    async listPageSlugs() {
      const baseSlugs = await base.listPageSlugs();
      const session = await resolveSession(siteId, branch);
      if (!session) return baseSlugs;

      const drafts = await listDraftFiles(session.id);
      const tombstoned = new Set<string>();
      const added = new Set<string>();
      for (const d of drafts) {
        if (!isPagePath(d.path)) continue; // skip docs.json etc.
        const slug = pathToSlug(d.path);
        if (d.deleted) tombstoned.add(slug);
        else added.add(slug);
      }
      const union = new Set([...baseSlugs, ...added]);
      for (const t of tombstoned) union.delete(t);
      return [...union];
    },

    // Specs (OpenAPI etc.) aren't draftable — read from the synced base content.
    loadRaw(relPath) {
      return base.loadRaw?.(relPath) ?? Promise.resolve(null);
    },
  };
}
