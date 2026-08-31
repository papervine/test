# Papervine Cursor plugin

A Cursor plugin that gives Cursor a complete reference for building
[Papervine](https://papervine.io) docs sites — a Git repository of MDX pages plus one
`docs.json`, rendered by Papervine.

## What it does

Installs a `papervine` skill and writing rules that Cursor uses when working on a Papervine
docs repo.

The skill covers:

- **Components** — full syntax and props for every component Papervine ships (callouts, cards,
  steps, tabs, code groups, accordions, frames, badges, icons, tooltips, file trees, color
  swatches, changelog entries, prompts, API fields, panels, mermaid), plus how to define your
  own React components inside a page
- **Configuration** — the complete `docs.json` surface: the nine themes, colors, logo, favicon,
  appearance, navbar, banner, SEO metatags, `llms.txt`, `skill.md`, and the full page
  frontmatter table
- **Navigation** — groups, tabs, anchors, dropdowns, versions and languages, and how an
  OpenAPI spec becomes navigation
- **API docs** — OpenAPI and AsyncAPI setup, generated endpoint pages, the Try it playground,
  security requirements, and hand-written API pages
- **CLI** — `papervine new`, `dev`, and `serve`, their flags, and serving a site in production

It also spells out the things an agent otherwise guesses wrong: which config keys are accepted
but not yet acted on, that icons resolve **Lucide** names only, that `"hidden": true` on a tab
is ignored, that only the first entry of a `versions` / `languages` wrapper renders, and that
the CLI has no `deploy`, `login`, or `validate`.

## Installation

Install from the [Cursor Marketplace](https://cursor.com/marketplace). Plugins can be installed
at the user level or scoped to a project.

## MCP setup

The plugin activates one MCP server on install:

- **Papervine Docs** — read-only access to Papervine's published documentation at
  `https://docs.papervine.io/mcp`. Three tools: `search_docs`, `read_page`, `list_pages`. Use it
  to look up a component signature or config option the skill doesn't cover.

### Add your own docs site

Every Papervine site serves the same tools at `/mcp`, scoped to its own content — hosted,
self-hosted, or a running `papervine dev`. To give Cursor a live view of the docs you're
writing, add your host to `~/.cursor/mcp.json` (user-wide) or `.cursor/mcp.json` (this project):

```json
{
  "mcpServers": {
    "My Docs": { "type": "http", "url": "https://docs.example.com/mcp" }
  }
}
```

`http://localhost:3000/mcp` works against `papervine dev`. A site with an OpenAPI reference also
exposes `search_api`.

### Editing

There is no write MCP an editor can authenticate to yet — Papervine's authoring MCP requires a
dashboard session today, and token-scoped access is the follow-up. That is no great loss in
Cursor: a Papervine site *is* a Git repository, so edits are ordinary file edits, and publishing
is a push or a pull request.

## Skills included

### `papervine`

The skill loads a concise core reference and routes to detailed files only when the task needs
them.

| Reference file | Contents |
|----------------|----------|
| `reference/components.md` | Every component's syntax, props, and examples; author-defined React components; snippets |
| `reference/configuration.md` | The full `docs.json` schema, themes, frontmatter fields, hiding pages, reader access, `llms.txt`, `skill.md` |
| `reference/navigation.md` | Navigation patterns and what each division actually renders |
| `reference/api-docs.md` | OpenAPI/AsyncAPI setup, generated pages, playground, hand-written API pages |
| `reference/cli.md` | CLI commands, flags, production serving, trust model |
| `reference/product-context.md` | Gathering and persisting product context in `.papervine/product-brief.md` |

## Rules included

### `rules/papervine.mdc`

Writing guardrails that activate when editing `.mdx` files or `docs.json`:

- File conventions and naming
- Internal link format (root-relative, no extensions)
- Page frontmatter fields
- Writing standards (voice, headings, code blocks, alt text)
- Common mistakes

## Migrating from another docs platform

Papervine reads the same `docs.json` schema, so an existing docs repo generally renders
unchanged — including keys Papervine doesn't act on yet, which are passed through with a
warning rather than rejected. The skill documents where behavior differs so you don't have to
discover it page by page.

## Contributing

This repository is **published from the Papervine monorepo** and is one-directional: changes
made here would be reverted by the next publish. Open an issue instead, or a pull request that a
maintainer can port upstream — authorship is preserved when they do.

## License

MIT. Not affiliated with any other documentation platform.
