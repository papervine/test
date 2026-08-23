import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import { starterTemplate, STARTER_SLUGS } from "../../src/lib/site-template";
import { parseDocsConfig } from "../../packages/renderer/lib/config";

// The starter content is what a brand-new Papervine-hosted site renders (SPEC §10.11), and
// the failure mode is brutal: s3Source.loadConfig() THROWS on an absent or unparseable
// docs.json, so a bad template means the site 500s on its very first pageview. These tests
// are the gate on "a new site renders".

const files = (name = "Acme Docs") => starterTemplate({ name });
const byPath = (name?: string) => new Map(files(name).map((f) => [f.path, f]));

describe("starterTemplate", () => {
  it("seeds a config plus one file per nav slug", () => {
    const paths = files().map((f) => f.path);
    expect(paths).toEqual(["index.mdx", "quickstart.mdx", "docs.json"]);
  });

  // Write order matters: createBlankSite and publishNative both write in array order, and
  // docs.json going last means a partial write never leaves navigation pointing at pages
  // that aren't there yet. Same discipline syncSite uses for its manifests.
  it("puts docs.json last so a partial write never has nav without pages", () => {
    const paths = files().map((f) => f.path);
    expect(paths[paths.length - 1]).toBe("docs.json");
  });

  it("ships only non-empty text content", () => {
    for (const file of files()) {
      expect(file.content.length).toBeGreaterThan(0);
    }
  });
});

describe("the seeded docs.json", () => {
  const config = (name?: string) => JSON.parse(byPath(name).get("docs.json")!.content);

  it("carries the site's name and a single nav group", () => {
    expect(config().name).toBe("Acme Docs");
    // `groups`, not `tabs` — a one-tab site shouldn't render a tab bar.
    expect(config().navigation.tabs).toBeUndefined();
    expect(config().navigation.groups).toHaveLength(1);
  });

  // THE regression this file exists for. The config is built as an object and
  // JSON.stringify'd precisely so a hostile name can't produce unparseable JSON; a
  // template literal with ${name} interpolated would break on any of these.
  it.each([
    ['a name with "double quotes"'],
    ["a name with a \\ backslash"],
    ["a name with a: colon"],
    ["a name with\na newline"],
    ["日本語のドキュメント"],
  ])("stays parseable JSON for %j", (name) => {
    expect(() => config(name)).not.toThrow();
    expect(config(name).name).toBe(name);
  });

  // parseDocsConfig is a lenient compatibility layer that warns instead of throwing, so a
  // "valid" config can still be quietly wrong. Zero warnings is the real assertion: our
  // own starter must not use a key our own parser doesn't understand.
  it("parses through parseDocsConfig with no warnings", () => {
    const { config: parsed, warnings } = parseDocsConfig(config());
    expect(warnings).toEqual([]);
    expect(parsed.name).toBe("Acme Docs");
  });

  it("references only pages the template actually ships", () => {
    const pages: string[] = config().navigation.groups[0].pages;
    const present = byPath();
    for (const slug of pages) {
      expect(present.has(`${slug}.mdx`)).toBe(true);
    }
    expect(pages).toEqual([...STARTER_SLUGS]);
  });

  it("seeds no favicon, since it seeds no favicon file", () => {
    // A favicon path pointing at a file we never wrote is a 404 in every page's <head>.
    expect(config().favicon).toBeUndefined();
  });
});

describe("the seeded pages", () => {
  it.each([...STARTER_SLUGS])("gives %s parseable frontmatter with a title", (slug) => {
    const { data, content } = matter(byPath().get(`${slug}.mdx`)!.content);
    expect(typeof data.title).toBe("string");
    expect(data.title).not.toHaveLength(0);
    expect(typeof data.description).toBe("string");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  // gray-matter parses the frontmatter block as YAML, where an unquoted value containing
  // a colon or a quote is a syntax error — the reason titles go through yamlString().
  it.each([
    ['a name with "double quotes"'],
    ["a name with a: colon"],
    ["a name with a # hash"],
  ])("keeps frontmatter parseable for the site name %j", (name) => {
    const index = byPath(name).get("index.mdx")!.content;
    expect(() => matter(index)).not.toThrow();
    expect(matter(index).data.title).toBe(name);
  });
});
