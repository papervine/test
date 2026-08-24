import { describe, it, expect } from "vitest";
import { parseDocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, parsePage, type ContentSource } from "@papervine/renderer/lib/content";
import { collectExportPages } from "@/lib/export-content";
import { listPages } from "@papervine/renderer/lib/docs-tools";

// Regression for Settings → Exports (SPEC §10.2): collectExportPages must return every
// docs page IN SIDEBAR ORDER, skipping nav leaves with no loadable page (e.g. a stale
// reference) rather than failing the whole export. We back it with an in-memory source so
// it's deterministic and infra-free, the same shape buildNav's unit test uses.

function fixtureSource(): { source: ContentSource; pages: Record<string, string> } {
  // Two groups; "ghost" is referenced by the nav but has no file (→ must be skipped).
  const pages: Record<string, string> = {
    index: "---\ntitle: Home\n---\nWelcome.",
    "guide/install": "---\ntitle: Install\n---\nRun npm i.",
    "guide/usage": "---\ntitle: Usage\n---\nUse it.",
  };
  const { config } = parseDocsConfig({
    name: "Export Tenant",
    navigation: {
      groups: [
        { group: "Start", pages: ["index", "guide/ghost"] },
        { group: "Guide", pages: ["guide/install", "guide/usage"] },
      ],
    },
  });
  return {
    pages,
    source: {
      async loadConfig() {
        return config;
      },
      async loadPage(slug) {
        const key = slug === "" ? "index" : slug;
        return key in pages ? parsePage(slug, pages[key]) : null;
      },
      async listPageSlugs() {
        return Object.keys(pages);
      },
    },
  };
}

describe("collectExportPages", () => {
  it("returns every loadable page in sidebar order, skipping missing ones", async () => {
    const { source } = fixtureSource();
    const result = await contentContext.run(source, () => collectExportPages());

    // "guide/ghost" is in the nav but unloadable → dropped; the rest stay in nav order.
    expect(result.map((p) => p.href)).toEqual([
      "/index",
      "/guide/install",
      "/guide/usage",
    ]);
    expect(result.map((p) => p.title)).toEqual(["Home", "Install", "Usage"]);
    for (const p of result) expect(p.page.body.trim().length).toBeGreaterThan(0);
  });

  it("matches listPages order, minus the unloadable leaves", async () => {
    const { source } = fixtureSource();
    const [navHrefs, exported] = await contentContext.run(source, async () => {
      const nav = (await listPages()).map((p) => p.href);
      const pages = await collectExportPages();
      return [nav, pages.map((p) => p.href)] as const;
    });
    // Export is the nav order with only the unloadable "/guide/ghost" removed.
    expect(exported).toEqual(navHrefs.filter((h) => h !== "/guide/ghost"));
  });
});
