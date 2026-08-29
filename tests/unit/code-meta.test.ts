import { describe, expect, it } from "vitest";

import { parseCodeTitle } from "../../packages/renderer/lib/code-title";
import {
  canonicalLanguageId,
  CODE_LANGUAGES,
  codeTabLabel,
  filterLanguages,
  languageLabel,
  withCodeTitle,
} from "../../src/components/editor/visual/code-meta";

// The write half of code-block titles: renaming a <CodeGroup> tab in the Visual editor sets the
// fence's `meta`, and the renderer reads that back with `parseCodeTitle`. So the invariant worth
// asserting isn't the exact string — it's that what comes back out is what you typed in. Every
// case here therefore checks the round trip, not just the formatting.

const roundTrip = (meta: string | null, title: string) =>
  parseCodeTitle(withCodeTitle(meta, title));

describe("withCodeTitle", () => {
  it("writes a simple label bare, the way authors write it", () => {
    expect(withCodeTitle(null, "npm")).toBe("npm");
    expect(roundTrip(null, "npm")).toBe("npm");
  });

  it("quotes a label the bare form can't carry", () => {
    expect(withCodeTitle(null, "My file.ts")).toBe('title="My file.ts"');
    expect(roundTrip(null, "My file.ts")).toBe("My file.ts");
    // A quote inside the label would close the attribute early.
    expect(roundTrip(null, 'say "hi"')).toBe("say 'hi'");
  });

  it("replaces an existing title in either form", () => {
    expect(roundTrip("npm", "pnpm")).toBe("pnpm");
    expect(roundTrip('title="old.ts"', "new.ts")).toBe("new.ts");
    expect(withCodeTitle("npm", "pnpm")).toBe("pnpm");
  });

  it("keeps directives it doesn't model, and never lets one become the title", () => {
    // `parseCodeTitle` reads a bare label as the WHOLE meta, so a label sharing the meta with a
    // line-highlight range has to be written in the explicit form.
    expect(withCodeTitle("{1,3-4}", "app.ts")).toBe('title="app.ts" {1,3-4}');
    expect(roundTrip("{1,3-4}", "app.ts")).toBe("app.ts");
    expect(withCodeTitle("showLineNumbers=true", "app.ts")).toBe(
      'title="app.ts" showLineNumbers=true',
    );
    expect(roundTrip("showLineNumbers=true", "app.ts")).toBe("app.ts");
    expect(withCodeTitle('title="old" {1,3}', "new")).toBe('title="new" {1,3}');
  });

  it("returns null when clearing the last thing in the meta", () => {
    expect(withCodeTitle("npm", "")).toBeNull();
    expect(withCodeTitle('title="old.ts"', "  ")).toBeNull();
    expect(withCodeTitle(null, "")).toBeNull();
    // …but keeps a meta that still holds something.
    expect(withCodeTitle('title="old" {1,3}', "")).toBe("{1,3}");
  });

  it("collapses whitespace so a label can't wreck the tab strip", () => {
    expect(roundTrip(null, "  My   file.ts  ")).toBe("My file.ts");
  });
});

describe("codeTabLabel", () => {
  it("prefers the title, falls back to the language", () => {
    expect(codeTabLabel("npm", "bash")).toBe("npm");
    expect(codeTabLabel(null, "bash")).toBe("bash");
    expect(codeTabLabel(null, null)).toBe("");
    // A directive is not a label — the tab shows the language rather than "{1,3}".
    expect(codeTabLabel("{1,3}", "ts")).toBe("ts");
  });
});

describe("the language picker's list", () => {
  it("offers plain text first, and every entry has a distinct id", () => {
    expect(CODE_LANGUAGES[0]).toMatchObject({ id: "", label: "Plain Text" });
    expect(new Set(CODE_LANGUAGES.map((l) => l.id)).size).toBe(CODE_LANGUAGES.length);
    // An alias that doubles as another entry's id would make the picker resolve it to whichever
    // came first in the list — a fence's language would silently read as the wrong language.
    const ids = new Set(CODE_LANGUAGES.map((l) => l.id));
    const alts = CODE_LANGUAGES.flatMap((l) => l.alt ?? []);
    expect(alts.filter((a) => ids.has(a))).toEqual([]);
    expect(new Set(alts).size).toBe(alts.length);
  });

  it("matches on id or label, case-insensitively", () => {
    expect(filterLanguages("ts").map((l) => l.id)).toContain("typescript");
    expect(filterLanguages("Type").map((l) => l.id)).toContain("typescript");
    expect(filterLanguages("").length).toBe(CODE_LANGUAGES.length);
    expect(filterLanguages("nothinglikethis")).toEqual([]);
  });

  it("shows an unlisted language as written rather than blanking it", () => {
    expect(languageLabel("typescript")).toBe("TypeScript");
    expect(languageLabel("brainfuck")).toBe("brainfuck");
    expect(languageLabel(null)).toBe("Plain Text");
  });

  it("reads the short spellings authors actually write", () => {
    // A fence written ```ts should read "TypeScript" in the picker, not fall through as unlisted.
    expect(languageLabel("ts")).toBe("TypeScript");
    expect(languageLabel("yml")).toBe("YAML");
    expect(languageLabel("SH")).toBe("Bash");
    expect(canonicalLanguageId("ts")).toBe("typescript");
    expect(canonicalLanguageId("brainfuck")).toBe("brainfuck");
    expect(canonicalLanguageId(null)).toBe("");
  });
});
