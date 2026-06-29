import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { runSearch } from "@/lib/search";

// The search index is rebuilt by re-reading every page, so doing it per request made Cmd-K slow
// (a full rebuild on each keystroke). runSearch now reuses the built index across calls, keyed by
// a content-version string (search.ts getIndex). This guards that: the SAME key reuses the cached
// index (so new content behind the same version is NOT seen), and a NEW key rebuilds.

// A source whose single page carries a unique marker word, so we can tell which build a query hit.
function markerSource(marker: string): ContentSource {
  const pages: Record<string, string> = {
    page: `---\ntitle: Page\n---\nUnique marker ${marker} appears here.`,
  };
  const { config } = parseDocsConfig({
    name: "T",
    navigation: { groups: [{ group: "G", pages: ["page"] }] },
  });
  return {
    async loadConfig() {
      return config;
    },
    async loadPage(slug) {
      return pages[slug] ? parsePage(slug, pages[slug]) : null;
    },
    async listPageSlugs() {
      return ["page"];
    },
  };
}

describe("search index is cached per content-version key", () => {
  it("reuses the index for the same key and rebuilds for a new key", async () => {
    const keyA = "site_x:shaA";

    // Build under keyA from the "alpha" content.
    const built = await contentContext.run(markerSource("alphamarker"), () =>
      runSearch("alphamarker", { indexKey: keyA }),
    );
    expect(built.length).toBeGreaterThan(0);

    // Same key, but the source now has DIFFERENT content → must serve the cached (alpha) index.
    const stillAlpha = await contentContext.run(markerSource("betamarker"), () =>
      runSearch("alphamarker", { indexKey: keyA }),
    );
    expect(stillAlpha.length).toBeGreaterThan(0); // cached index still has alpha
    const noBeta = await contentContext.run(markerSource("betamarker"), () =>
      runSearch("betamarker", { indexKey: keyA }),
    );
    expect(noBeta.length).toBe(0); // the cached index never saw beta content

    // A new version key rebuilds against the current source → now beta is found.
    const beta = await contentContext.run(markerSource("betamarker"), () =>
      runSearch("betamarker", { indexKey: "site_x:shaB" }),
    );
    expect(beta.length).toBeGreaterThan(0);
  });
});
