import { describe, expect, it } from "vitest";
import { sitemapUrls } from "@papervine/renderer/lib/sitemap";
import { docsOriginFor } from "@/lib/seo-routes";
import { canPublishSitemap } from "@/lib/tenant-sitemap";

// A docs site's sitemap is built from the same nav walk /llms.txt uses, so gating and
// `noindex` are already handled upstream. What this layer decides is which of those entries
// becomes a URL, and what that URL is.

const ORIGIN = "https://docs.example.com";

describe("sitemapUrls", () => {
  it("turns nav hrefs into absolute URLs in nav order", () => {
    expect(
      sitemapUrls(ORIGIN, [{ href: "/" }, { href: "/quickstart" }, { href: "/guides/markdown" }]),
    ).toEqual([
      { url: "https://docs.example.com" },
      { url: "https://docs.example.com/quickstart" },
      { url: "https://docs.example.com/guides/markdown" },
    ]);
  });

  it("gives the index page the origin itself, under either spelling", () => {
    // The index page is written "index" in docs.json, reported as "" by the page lister and
    // linked as "/" by the nav. Its canonical URL is the origin, which is also what the page's
    // own <link rel="canonical"> says — a sitemap that disagreed would be self-contradictory.
    expect(sitemapUrls(ORIGIN, [{ href: "/index" }])).toEqual([
      { url: "https://docs.example.com" },
    ]);
  });

  it("leaves external links out — they are somebody else's URLs", () => {
    expect(
      sitemapUrls(ORIGIN, [
        { href: "/real" },
        { href: "https://github.com/acme/repo", external: true },
      ]),
    ).toEqual([{ url: "https://docs.example.com/real" }]);
  });

  it("collapses a page that appears in two nav groups", () => {
    expect(sitemapUrls(ORIGIN, [{ href: "/shared" }, { href: "/shared" }])).toHaveLength(1);
  });

  it("stamps lastModified only when given one", () => {
    expect(sitemapUrls(ORIGIN, [{ href: "/a" }], "2026-09-02")).toEqual([
      { url: "https://docs.example.com/a", lastModified: "2026-09-02" },
    ]);
    expect(sitemapUrls(ORIGIN, [{ href: "/a" }])[0]).not.toHaveProperty("lastModified");
  });
});

describe("docsOriginFor", () => {
  it("uses https for a real host, including a custom domain", () => {
    expect(docsOriginFor("docs.papervine.io")).toBe("https://docs.papervine.io");
    expect(docsOriginFor("docs.acme.com")).toBe("https://docs.acme.com");
  });

  it("uses http for local hosts, so a dev server advertises a sitemap it can serve", () => {
    expect(docsOriginFor("localhost:3000")).toBe("http://localhost:3000");
    expect(docsOriginFor("starter.localhost:3000")).toBe("http://starter.localhost:3000");
    expect(docsOriginFor("127.0.0.1:4188")).toBe("http://127.0.0.1:4188");
  });

  it("has no origin without a Host header", () => {
    expect(docsOriginFor(null)).toBe(null);
  });
});

describe("canPublishSitemap", () => {
  it("publishes for a resolved site, and for a CLI-served repo that has no records", () => {
    expect(canPublishSitemap({ singleRepo: false, hasRecord: true })).toBe(true);
    expect(canPublishSitemap({ singleRepo: true, hasRecord: false })).toBe(true);
  });

  it("publishes NOTHING when the site row is missing — the fail-closed case", () => {
    // The content source and the site record resolve separately. A request that found the
    // content but not the row would otherwise fall back to "no gating" and list a gated
    // site's internal URLs as public. Seen once, on a cold request.
    expect(canPublishSitemap({ singleRepo: false, hasRecord: false })).toBe(false);
  });
});
