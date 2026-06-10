import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@/lib/config";
import { contentContext, parsePage, type ContentSource } from "@/lib/content";
import { runSearch } from "@/lib/search";

// Regression: buildIndex must enumerate pages from the NAV, not just from
// listPageSlugs(). If a content source returns [] from listPageSlugs() (e.g. it can't
// cheaply pre-walk every key), search would otherwise index NOTHING — which is what made
// the AI assistant's searchDocs and the Cmd-K dialog come back empty. Guarding the nav
// path keeps search working regardless of how exhaustively a source enumerates slugs.
//
// This exercises the real runSearch → buildIndex → buildNav path against a stub source
// with a populated nav + loadPage, but an empty listPageSlugs().

function navOnlySource(): ContentSource {
  const pages: Record<string, string> = {
    "guide/hidden-pages":
      "---\ntitle: Hidden Pages\n---\nSet hidden true in frontmatter to remove a quokka page from navigation.",
  };
  const { config } = parseDocsConfig({
    name: "Stub Tenant",
    navigation: { groups: [{ group: "Guide", pages: ["guide/hidden-pages"] }] },
  });
  return {
    async loadConfig() {
      return config;
    },
    async loadPage(slug) {
      const raw = pages[slug];
      return raw ? parsePage(slug, raw) : null;
    },
    // The behavior we're guarding against: no pre-enumerated slugs.
    async listPageSlugs() {
      return [];
    },
  };
}

describe("search indexes nav pages when the source lists no slugs", () => {
  it("finds a page reachable only via the nav", async () => {
    const hits = await contentContext.run(navOnlySource(), () => runSearch("quokka"));
    expect(hits.map((h) => h.href)).toContain("/guide/hidden-pages");
  });
});
