# Compatibility Gap Report

**Date:** 2026-06-07

**Method:** Ran the renderer against representative public `docs.json` repositories and
static-analyzed their `.md`, `.mdx`, and `docs.json` usage. Detailed repo names and
competitive notes belong in `_private/`, not in the public repository.

## Headline

The renderer must treat `docs.json` and MDX as a compatibility layer: unknown config fields,
unsupported components, malformed frontmatter, and unresolved imports should degrade
gracefully instead of taking down a page.

## Severity 1 — Blockers

### `favicon` as an object rejects the entire `docs.json`

Some real-world configs use `favicon: { "light": "...", "dark": "..." }`. Our first schema
declared only `favicon: z.string()`, so one field could 500 every page.

- **Fix:** accept `string | { light, dark }`.
- **Lesson:** config validation should warn and continue, not hard-fail.

### Recursive navigation divisions were incomplete

Real-world `docs.json` files nest pages under divisions such as languages, versions, tabs,
anchors, dropdowns, and groups. The renderer must walk the whole tree generically.

- **Fix:** make nav traversal recursive over every division type.
- **Regression guard:** smoke fixtures include languages, hidden pages, `.md`, and nested nav.

## Severity 2 — Major

### `.md` files not served

The renderer originally resolved only `.mdx`; real docs repos often contain both `.mdx` and
`.md`.

- **Fix:** resolve both extensions.

### ESM imports and snippets unresolved

Many docs repos use shared snippets or component imports. Until full snippet resolution lands,
import failures should render an inline notice rather than a 500.

- **Fix so far:** compile failures degrade gracefully.
- **Remaining work:** resolve shared snippet imports at sync time.

### Unknown components caused hard failures

Compiled MDX can reference components Papervine does not yet implement. The first renderer
threw when any one component was missing.

- **Fix:** scan compiled output and provide a passthrough fallback for unknown components,
  including member-expression components.

## M1 backlog

1. ✅ Config robustness: warn-don't-throw validation, object favicon, recursive nav.
2. ✅ `.md` support, hidden frontmatter, and `sidebarTitle`.
3. ✅ Graceful unknown-component fallback.
4. ⏳ Snippet/import resolution.
5. ⏳ Broader component coverage for changelog, layout, tooltip, badge, tile, panel, and API
   reference components.
6. ✅ Mermaid diagrams.

## Renderer Decision

The MDX engine is a hybrid: compile to serializable output, then execute the compiled source
with `@mdx-js/mdx`'s `run()` inside our own `try/catch`. This keeps unsupported content
catchable and lets the page degrade to an inline notice instead of throwing through RSC.

The public detail that matters is the invariant, not the competitor comparison: **zero page
500s beats slightly higher component fidelity**.

## Regression Protection

`tests/fixtures/` encodes the compatibility cases above; `npm test` boots the renderer and
asserts no page 500s. `node tests/crawl.mjs <docs-dir>` remains the manual/CI tool for
checking larger representative docs repositories.
