/**
 * The starter content a brand-new Papervine-hosted site is seeded with (SPEC §10.11).
 *
 * Why a TS module and not a directory of template files read with `fs`: on Vercel only
 * *traced* files ship, so a runtime `readFile` of `templates/…` is a deploy-shaped bug
 * waiting to happen (the same class as `serverExternalPackages`). A path→content map is
 * trace-proof, and it makes the one thing that really matters unit-testable — that the
 * generated `docs.json` parses. `s3Source.loadConfig()` THROWS when docs.json is absent or
 * unparseable, and `isSynced()` requires it to exist, so a malformed template means the
 * brand-new site 500s on its very first pageview.
 *
 * Pure + DB-free: no storage writes here. `createBlankSite` does the putObject-ing.
 */

/**
 * One seeded file. `path` is docs-root-relative and matches the S3 key space exactly.
 * Text-only by construction (the whole template is MDX + JSON), so the writer stores every
 * file under `TEXT_CONTENT_TYPE` — the same type syncSite uses for repo text files.
 */
export type TemplateFile = { path: string; content: string };

/** Page slugs the starter ships, in nav order. Used by tests and the editor's landing. */
export const STARTER_SLUGS = ["index", "quickstart"] as const;

// Same palette as the platform's own docs (content/docs.json) so a fresh site looks
// deliberate rather than unstyled. `theme` is a named preset resolved by lib/theme.ts.
function starterConfig(name: string): Record<string, unknown> {
  return {
    $schema: "https://papervine.io/schema.json",
    name,
    theme: "mint",
    colors: { primary: "#16A34A", light: "#4ADE80", dark: "#15803D" },
    // `groups`, not `tabs`: a single-tab site would render a tab bar with one tab in it.
    // No `favicon` key — we seed no favicon file, and a dangling path is a 404 in <head>.
    navigation: {
      groups: [{ group: "Get started", pages: [...STARTER_SLUGS] }],
    },
  };
}

/**
 * The files to write under `sites/{id}/` for a new hosted site. Returned in write order:
 * pages first, `docs.json` LAST, so a partial write never leaves navigation pointing at
 * pages that don't exist yet (the same discipline syncSite uses for its manifests).
 */
export function starterTemplate(input: { name: string }): TemplateFile[] {
  const name = input.name;
  return [
    {
      path: "index.mdx",
      // Frontmatter is written through a JSON-quoted title for the same reason the config
      // is stringified: a name containing a colon or a quote would otherwise produce YAML
      // that gray-matter can't parse.
      content: `---
title: ${yamlString(name)}
description: ${yamlString(`Documentation for ${name}.`)}
---

Welcome to your new docs site. This page lives in your site's content — edit it in
Studio, hit **Publish**, and it's live.

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    A second page, so you can see how navigation works.
  </Card>
  <Card title="Add a page" icon="file-plus" href="/quickstart">
    Create pages in Studio and they appear in the sidebar.
  </Card>
</CardGroup>

## Editing this site

Your content is hosted by Papervine — there's no Git repository to clone. Everything is
written and published from the browser.

## Next steps

Replace this page with your own introduction, then add the pages your readers need.
`,
    },
    {
      path: "quickstart.mdx",
      content: `---
title: Quickstart
description: ${yamlString(`Get started with ${name}.`)}
---

This is a starter page. Open it in Studio and replace this text with your own.

## Writing content

Pages are Markdown with a few extra components. Standard Markdown works everywhere —
headings, lists, tables, links, and fenced code blocks:

\`\`\`bash
echo "hello"
\`\`\`

<Note>
  Components like this one are available on every page. No setup required.
</Note>

## Organizing your sidebar

The sidebar comes from your site's navigation. Add a page in Studio and it shows up
here.
`,
    },
    {
      path: "docs.json",
      // Built as an object and stringified — NEVER interpolated into a JSON string
      // literal. A site named `He said "hi"` would otherwise emit unparseable JSON and
      // the brand-new site would 500 on its first request. Guarded by a unit test.
      content: `${JSON.stringify(starterConfig(name), null, 2)}\n`,
    },
  ];
}

/**
 * Quote a value for a YAML frontmatter scalar. Double-quoted YAML uses backslash escapes
 * for `"` and `\`, which is exactly JSON's string grammar for these characters — so
 * JSON.stringify is both correct and the least surprising way to spell it.
 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}
