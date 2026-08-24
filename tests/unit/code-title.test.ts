import { describe, expect, it } from "vitest";

import { parseCodeTitle } from "../../packages/renderer/lib/code-title";

// The pure core of code-block titles. This exists because the *previous* implementation was
// dead code for months: `remarkCodeTitles` rewrote a fence's `meta` to `title="…"` and the
// serializer's Shiki integration dropped `meta` entirely, so no title ever reached the DOM —
// which is why `<CodeGroup>` labelled its tabs with the language ("shellscript" three times
// over) instead of npm/pnpm/yarn. Nothing failed, because nothing was asserting.
//
// The distinction that actually matters here is title vs. *not* a title: a line-highlight range
// or a `key=value` directive misread as a label becomes a CodeGroup tab that actively lies about
// what it's showing, which is worse than no label at all.

describe("parseCodeTitle", () => {
  it("reads a bare label after the language", () => {
    expect(parseCodeTitle("npm")).toBe("npm");
  });

  it("reads an explicit title=\"…\"", () => {
    expect(parseCodeTitle('title="My file.ts"')).toBe("My file.ts");
  });

  it("accepts a single-quoted explicit title", () => {
    expect(parseCodeTitle("title='app.py'")).toBe("app.py");
  });

  it("finds an explicit title alongside other directives", () => {
    // The `=` bail-out below must not swallow this case — an explicit title is unambiguous
    // wherever it sits.
    expect(parseCodeTitle('showLineNumbers title="server.ts"')).toBe("server.ts");
  });

  it("keeps a multi-word bare label", () => {
    expect(parseCodeTitle("Install with npm")).toBe("Install with npm");
  });

  it("collapses internal whitespace, so a label can't wreck the tab bar", () => {
    expect(parseCodeTitle("Install   with\tnpm")).toBe("Install with npm");
  });

  it("strips surrounding quotes from a bare quoted label", () => {
    expect(parseCodeTitle('"npm install"')).toBe("npm install");
  });

  describe("things that are not titles", () => {
    it("ignores a line-highlight range", () => {
      expect(parseCodeTitle("{1,3-4}")).toBeUndefined();
    });

    it("ignores a key=value directive", () => {
      expect(parseCodeTitle("showLineNumbers=true")).toBeUndefined();
    });

    it("returns undefined for empty or whitespace-only meta", () => {
      expect(parseCodeTitle("")).toBeUndefined();
      expect(parseCodeTitle("   ")).toBeUndefined();
    });

    it("returns undefined for a non-string, since mdast meta is nullable", () => {
      expect(parseCodeTitle(null)).toBeUndefined();
      expect(parseCodeTitle(undefined)).toBeUndefined();
      expect(parseCodeTitle(42)).toBeUndefined();
    });

    it("returns undefined for an empty explicit title rather than an empty label", () => {
      expect(parseCodeTitle('title=""')).toBeUndefined();
    });
  });
});
