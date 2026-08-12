import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { PageAccess } from "@papervine/renderer/lib/nav";
import type { PageFrontmatter } from "@papervine/renderer/lib/content";
import { canAccessPage } from "./reader-auth";
import { readerSession } from "./reader-session";

/**
 * Per-request reader access, shared by every surface that exposes page content (SPEC §11.2).
 *
 * The renderer/nav already gate pages by the reader's session `groups`; retrieval surfaces
 * (Cmd-K search, the AI assistant's RAG, the MCP server) must apply the SAME predicate or a
 * reader can pull gated content they can't open. Rather than thread a predicate through every
 * call signature, we carry it in an AsyncLocalStorage the way the renderer carries its content
 * source (`contentContext`): routes set it, `docs-tools`/`search` read it. The default is
 * ALLOW_ALL, so the apex, `papervine dev`, non-gated sites, and any path that doesn't set it
 * are unchanged.
 */
const ALLOW_ALL: PageAccess = () => true;

const accessContext = new AsyncLocalStorage<PageAccess>();

/** The current request's access predicate, or ALLOW_ALL when none is set. */
export function currentPageAccess(): PageAccess {
  return accessContext.getStore() ?? ALLOW_ALL;
}

/** Run `fn` with `access` as the current predicate (nest inside `contentContext.run`). */
export function withReaderAccess<T>(access: PageAccess, fn: () => Promise<T> | T): Promise<T> | T {
  return accessContext.run(access, fn);
}

/**
 * Build the access predicate from a site record + reader cookie. Mirrors the renderer's
 * `readerAccess`:
 *  - auth OFF → ALLOW_ALL (no gating; the site renders every page publicly).
 *  - auth ON  → gate each page by the reader's session groups.
 *  - `anonymous` → ignore the cookie and use NO groups. This is the MCP case: external
 *    agents carry no reader session, so they only ever see the public/un-gated subset
 *    (a gated page is indistinguishable from a missing one to them).
 */
export function accessForRecord(
  record: { authEnabled?: boolean | null; id: string } | null | undefined,
  cookieValue: string | undefined,
  opts?: { anonymous?: boolean },
): PageAccess {
  if (!record?.authEnabled) return ALLOW_ALL;
  // `signedIn` is carried separately from the groups list because "anonymous" and
  // "authenticated but group-less" are different entitlements: the first sees only
  // `public: true` pages, the second also sees every ungated page.
  const session = opts?.anonymous ? null : readerSession(cookieValue, record.id);
  const groups = session?.groups ?? [];
  const signedIn = Boolean(session);
  return (fm: PageFrontmatter) => canAccessPage(fm.groups, fm.public, groups, signedIn);
}

/**
 * A stable cache-key string for the reader's *entitlement class* — the dimension a gated page's
 * rendered output (and its group-filtered nav) varies on (SPEC §11.2). Mirrors `accessForRecord`
 * exactly, so the key always corresponds to the access decision:
 *  - auth OFF  → "public" (one variant — every reader sees the same thing).
 *  - auth ON   → the reader's session groups, sorted + joined (or "anon" with no session).
 * Two readers with the same groups share a key, so per-group caches (nav today; the page cache
 * in move ③) fan out by group, not by user.
 */
export function entitlementKey(
  record: { authEnabled?: boolean | null; id: string } | null | undefined,
  cookieValue: string | undefined,
): string {
  if (!record?.authEnabled) return "public";
  const groups = readerSession(cookieValue, record.id)?.groups ?? [];
  return groups.length ? [...groups].sort().join(",") : "anon";
}
