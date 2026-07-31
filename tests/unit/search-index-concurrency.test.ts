import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { runSearch } from "@/lib/search";

// Regression: buildIndexUncached used to `await loadPage(slug)` one slug at a time in a
// `for` loop. Each loadPage is a real network round-trip (S3/R2) in production, so a
// sequential loop turned a cold index build into N back-to-back round-trips — the
// "first search takes ~12s" report. This pins the fix (fetch every page concurrently).
//
// `buildNav` already fetches every NAV-listed page concurrently (its own, separate fix —
// see nav.ts's `collectChildren`), and `loadPage` is memoized per request, so nav-covered
// slugs are already warm by the time buildIndexUncached's own loop reaches them — testing
// concurrency against nav-listed slugs would actually be measuring buildNav's fetch, not
// this loop's. Real repos have plenty of slugs `listPageSlugs()` enumerates that AREN'T in
// nav (unlinked pages, per-locale duplicates outside the active nav's language), so this
// test gives the nav only ONE page and puts the rest exclusively in `listPageSlugs()` —
// isolating the loop under test.

function delayedSource(navSlug: string, extraSlugs: string[], delayMs: number) {
  const allSlugs = [navSlug, ...extraSlugs];
  let inFlight = 0;
  let maxConcurrent = 0;
  const pages: Record<string, string> = {};
  for (const slug of allSlugs) pages[slug] = `---\ntitle: ${slug}\n---\nMarker content for ${slug}.`;
  const { config } = parseDocsConfig({ name: "T", navigation: { groups: [{ group: "G", pages: [navSlug] }] } });
  const source: ContentSource = {
    async loadConfig() {
      return config;
    },
    async loadPage(slug) {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      inFlight--;
      return pages[slug] ? parsePage(slug, pages[slug]) : null;
    },
    async listPageSlugs() {
      return allSlugs;
    },
  };
  return { source, maxConcurrent: () => maxConcurrent };
}

describe("search index build fetches non-nav pages concurrently", () => {
  it("has more than one loadPage in flight at once for pages outside the nav", async () => {
    const extraSlugs = Array.from({ length: 6 }, (_, i) => `orphan-${i}`);
    const { source, maxConcurrent } = delayedSource("nav-page", extraSlugs, 20);

    await contentContext.run(source, () => runSearch("marker", { indexKey: "concurrency-test:v1" }));

    // Sequential `for (const slug of slugs) await loadPage(slug)` can never exceed 1 for
    // these orphan slugs (nav-page is pre-warmed by buildNav's own concurrent fetch, so it
    // doesn't count here) — a regression back to that shape would fail this with
    // maxConcurrent() === 1.
    expect(maxConcurrent()).toBeGreaterThan(1);
  });
});
