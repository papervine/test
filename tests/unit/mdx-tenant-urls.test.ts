import { describe, expect, it } from "vitest";

import { applyTenantUrls, componentsForCompiled } from "../../packages/renderer/lib/mdx-runtime";

// `applyTenantUrls` rewrites `href`/`src` against the tenant's base — and, to do it, wraps every
// named component. The wrapping is what this file is about.
//
// A NAMESPACE component carries its members as static properties (`Color.Item`, `Tree.Folder`,
// `GitHub.Repo`), and a plain wrapper function has none of them. MDX compiles `<Color.Item>` to a
// `components.Color.Item` lookup and throws "Expected component `Color.Item` to be defined" when
// it's missing — a 500, not a degraded render, because the throw happens while React renders the
// content rather than inside the compile step's try/catch.
//
// It only broke where a base is SET, which is the branch that wraps: the draft preview and
// path-based serving (`/sites/{slug}`). On a tenant host the map passes through untouched, so
// every fixture, crawl and smoke check rendered a `<Tree>` perfectly while the same page 500'd in
// Preview. Hence a unit test at the layer that actually decides it.

const empty = componentsForCompiled("");

describe("applyTenantUrls", () => {
  const namespaces: [string, string[]][] = [
    ["Color", ["Item", "Row"]],
    ["Tree", ["Folder", "File"]],
    ["FileTree", ["Folder", "File"]],
    ["GitHub", ["Repo"]],
  ];

  it("keeps namespace members when a base is set", () => {
    const withBase = applyTenantUrls(empty, "/preview/acme/docs/site", "/api/tenant-asset/docs", {});
    for (const [name, members] of namespaces) {
      for (const member of members) {
        const ns = withBase[name] as unknown as Record<string, unknown>;
        expect(typeof ns?.[member], `${name}.${member} must survive the wrap`).toBe("function");
      }
    }
  });

  it("keeps them with no base too — the branch that doesn't wrap at all", () => {
    const bare = applyTenantUrls(empty, "", "", {});
    for (const [name, members] of namespaces) {
      for (const member of members) {
        const ns = bare[name] as unknown as Record<string, unknown>;
        expect(typeof ns?.[member]).toBe("function");
      }
    }
  });

  it("still rewrites what it wraps", () => {
    const withBase = applyTenantUrls(empty, "/preview/acme/docs/site", "/assets", {});
    // The wrapper is a different function from the component it wraps — i.e. it really wrapped —
    // while the members came through untouched.
    expect(withBase.Card).not.toBe(empty.Card);
    expect(typeof withBase.a).toBe("function");
  });
});
