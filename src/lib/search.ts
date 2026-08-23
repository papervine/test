import "server-only";
import {
  runSearch as coreRunSearch,
  type SearchHit,
} from "@papervine/renderer/lib/search";
import { currentPageAccess } from "./reader-access";

/**
 * The hosted app's view of search.
 *
 * The engine itself moved to `@papervine/renderer/lib/search` so the CLI can use it too:
 * it's an in-memory Orama index built from the same `ContentSource` the renderer reads,
 * with no database involved, so there was never a reason it had to be control-plane-only.
 *
 * What stays here is the one thing that *is* control-plane: reader-auth. The core takes an
 * access predicate and defaults to allowing everything; this wrapper supplies the real one
 * from the request's reader context, so gated pages can't surface through search, RAG, or
 * MCP to a reader who can't open them (SPEC §11.2). Reading it here rather than in the core
 * keeps it inside the request's AsyncLocalStorage scope.
 *
 * Call sites are unchanged — `@/lib/search` still exports `runSearch` and
 * `withSearchIndexKey`.
 */
export function runSearch(
  term: string,
  opts: { indexKey?: string | null; limit?: number } = {},
): Promise<SearchHit[]> {
  return coreRunSearch(term, { ...opts, access: currentPageAccess() });
}

export { withSearchIndexKey } from "@papervine/renderer/lib/search";
export type { SearchHit } from "@papervine/renderer/lib/search";
