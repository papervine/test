import { describe, it, expect } from "vitest";
import { resolveEditorLink } from "@/lib/editor-link";

// Links inside the Visual editor are resolved against the *site's* pages, never against the app
// host the editor happens to be served from — following `/quickstart` as written lands on
// app.papervine.io/quickstart (a 404) and throws away the editing session. resolveEditorLink is
// the pure decision layer; VisualEditor just acts on the verdict.

// The root page's slug is "" (see listPageSlugs), which is exactly the case that's easy to break.
const SLUGS = ["", "quickstart", "guides/components", "guides/advanced/theming"];

const resolve = (href: string, from = "") => resolveEditorLink(href, from, SLUGS);

describe("resolveEditorLink", () => {
  it("resolves a root-absolute docs path to the page slug", () => {
    expect(resolve("/quickstart")).toEqual({ kind: "page", slug: "quickstart" });
    expect(resolve("/guides/components")).toEqual({ kind: "page", slug: "guides/components" });
  });

  it("maps `/` and `/index` onto the root page, whose slug is the empty string", () => {
    expect(resolve("/")).toEqual({ kind: "page", slug: "" });
    expect(resolve("/index")).toEqual({ kind: "page", slug: "" });
  });

  it("resolves a relative link against the folder of the page being edited", () => {
    expect(resolve("theming", "guides/advanced/overview")).toEqual({
      kind: "page",
      slug: "guides/advanced/theming",
    });
    expect(resolve("./components", "guides/advanced")).toEqual({ kind: "page", slug: "guides/components" });
    expect(resolve("../quickstart", "guides/components")).toEqual({ kind: "page", slug: "quickstart" });
  });

  it("ignores a query string and a fragment when identifying the page", () => {
    expect(resolve("/quickstart#install")).toEqual({ kind: "page", slug: "quickstart" });
    expect(resolve("/quickstart?tab=cli")).toEqual({ kind: "page", slug: "quickstart" });
  });

  it("strips a page file extension, which links sometimes carry but slugs never do", () => {
    expect(resolve("/quickstart.mdx")).toEqual({ kind: "page", slug: "quickstart" });
    expect(resolve("/quickstart.md")).toEqual({ kind: "page", slug: "quickstart" });
  });

  it("treats anything with a scheme — or protocol-relative — as external", () => {
    expect(resolve("https://example.com/docs")).toEqual({
      kind: "external",
      href: "https://example.com/docs",
    });
    expect(resolve("mailto:hi@example.com")).toEqual({ kind: "external", href: "mailto:hi@example.com" });
    expect(resolve("//cdn.example.com/x.png")).toEqual({ kind: "external", href: "//cdn.example.com/x.png" });
  });

  it("treats a bare fragment or empty href as a same-page anchor", () => {
    expect(resolve("#install")).toEqual({ kind: "anchor" });
    expect(resolve("")).toEqual({ kind: "anchor" });
    expect(resolve("   ")).toEqual({ kind: "anchor" });
    expect(resolve("?tab=cli")).toEqual({ kind: "anchor" });
  });

  it("reports an in-site path with no page as missing, so a broken link says so", () => {
    expect(resolve("/nope")).toEqual({ kind: "missing", path: "/nope" });
    expect(resolve("/guides/missing")).toEqual({ kind: "missing", path: "/guides/missing" });
  });

  it("never escapes the site: `..` past the root collapses to a site path", () => {
    expect(resolve("../../../quickstart", "guides/components")).toEqual({ kind: "page", slug: "quickstart" });
  });
});
