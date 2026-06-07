# Compatibility Gap Report — Docbot vs. representative docs repos

**Date:** 2026-06-07
**Method:** Ran the M0 renderer (`docbot dev`) against two unmodified docs repos, plus static analysis of every `.md(x)` file and `docs.json`.

| Repo | Size | Result |
|---|---|---|
| [`papervine/starter`](https://github.com/papervine/starter) | 2 doc pages | ✅ **Renders fully** — both pages HTTP 200, no errors |
| [`papervine/docs`](https://github.com/papervine/docs) (the incumbent's own production docs) | 877 `.mdx` + 28 `.md`, 12 snippets | ❌ **Fails to load** — `docs.json` rejected, 500 on every page |

**Headline:** a real starter-kit repo works in Docbot today. The incumbent's *production* docs expose the M1 backlog — and the first blocker is a single over-strict schema field that takes down the whole site.

---

## Severity 1 — Blockers (whole site fails)

### 1.1 `favicon` as an object rejects the entire `docs.json`
Our schema declares `favicon: z.string()`. The incumbent allows `{ "light": "...", "dark": "..." }`. Because config parsing throws on *any* schema miss, this single field 500s **every page**.
- **Fix:** accept `string | { light, dark }` (one line). Same pattern as our `logo`.
- **Lesson:** config validation should **warn-and-skip** unknown/mismatched fields, not hard-fail (SPEC.md §4 said this — we didn't honor it). Strict-throw is the wrong default for a compatibility layer.

### 1.2 `navigation.languages` (and `versions`) layers not handled
`papervine/docs` nests nav as `navigation.languages[].tabs[]…`. Our `buildNav` only walks `tabs`/`groups`/`pages`, so even once config parses, the sidebar is empty.
- **Fix:** make nav traversal fully recursive over all division types: `languages`, `versions`, `tabs`, `anchors`, `dropdowns`, `groups`, `pages` (SPEC.md §4 "single recursive structure"). Add `group.root` and `group.icon` support.

---

## Severity 2 — Major (pages fail or content missing)

### 2.1 `.md` files not served
We only resolve `.mdx`. The incumbent serves `.md` too (28 in their docs). Add `.md` to slug resolution + listing.

### 2.2 ESM imports / snippets unresolved
37 distinct `import` statements in `papervine/docs`, e.g. `import { PreviewButton } from "/snippets/previewbutton.jsx"` and `import X from "/snippets/icons-optional.mdx"`. Our compile doesn't resolve imports or the `/snippets` convention → those pages throw.
- **Fix:** resolve `/snippets/*` (and `/shared/*`) imports relative to the content root; support `.mdx`, `.jsx`, `.js` snippet modules. This is a meaningful chunk of work.

### 2.3 46 unsupported components used
Top offenders by usage in `papervine/docs`:

| Component | Uses | Notes |
|---|---|---|
| `ResponseField` / `ParamField` | 1495 / 178 | API param docs — pairs with M4 playground |
| `Update` | 295 | changelog entries |
| `Expandable` | 270 | nested field disclosure |
| `Columns` / `Column` | 50 / 16 | layout grid |
| `Icon` | 54 | inline icon |
| `RequestExample` / `ResponseExample` | 52 / 32 | API examples (M4) |
| `Tooltip` | 36 | inline |
| `Badge`, `Tile`, `Panel`, `Card` variants… | — | misc |

Many are long-tail/doc-specific (`ColorGenerator`, `VercelJsonGenerator`) and safe to ignore. The **core dozen** (`Update`, `Expandable`, `Columns`/`Column`, `Icon`, `Tooltip`, `Badge`, `Tile`, `Panel`, plus the API set) cover the vast majority of real usage.

**Note:** unknown components currently throw a hard "Expected component X to be defined." We should render unknown components as a graceful fallback (render children + a dev warning) so one stray component doesn't 500 a page.

---

## Severity 3 — Minor / config surface

Unsupported `docs.json` top-level keys seen (currently passthrough-ignored, which is fine, but several affect output):

| Key | Seen in | Impact |
|---|---|---|
| `contextual` | both | "Ask AI"/copy-page actions → M5 |
| `api` | docs | OpenAPI defaults → M4 |
| `seo`, `redirects`, `icons`, `interaction`, `integrations`, `thumbnails`, `description` | docs | metadata/redirects/analytics — low render impact |

Frontmatter keys we ignore but should honor: `sidebarTitle` (130×), `keywords`/`boost` (SEO/search → M3), `openapi`/`asyncapi` (80× → M4), `mode`, `noindex`, `hidden` (4× — should drop from nav).

---

## M1 backlog (priority order)

1. ✅ **Config robustness** — warn-don't-throw validation; `favicon` object; fully recursive nav incl. `languages`/`versions`/`anchors`/`root`. *(unblocked `papervine/docs` entirely)*
2. ✅ **`.md` support** + `hidden` frontmatter + `sidebarTitle`.
3. ✅ **Graceful unknown-component fallback** — passthrough `Fallback` (Proxy-based, so `<Color.Item>` member components degrade too); defensive components (`Card` icon accepts JSX nodes); safe frontmatter YAML parsing; compile-time try/catch → inline notice.
4. ⏳ **Snippet/import resolution** (`/snippets`, `/shared`) — the only remaining cause of degraded pages.
5. ⏳ **Core component coverage** — `Update`, `Expandable`, `Columns`/`Column`, `Icon`, `Tooltip`, `Badge`, `Tile`, `Panel`. *(API + changelog-heavy components defer to M4.)*

### Result of items 1–3 (measured on a 125-page sample of `papervine/docs`)

| Outcome | Before | After |
|---|---|---|
| Fully rendered | 0 | **114** |
| Graceful notice (no crash) | 0 | 11 *(all `/snippets` imports → item 4)* |
| **HTTP 500** | **every page** | **0** |

**M1 finish line for items 1–3 reached: any representative docs repo renders without crashing.** The starter renders 100%; `papervine/docs` renders with only snippet-import pages stubbed (item 4 next). Regression: our own `./content` still builds/prerenders, starter still 200s.

### Renderer decision (2026-06-07): hybrid on @mintlify/mdx

After prototyping, the MDX engine is now a **hybrid**: compile with `@mintlify/mdx`'s
`serialize` (the third-party MDX serializer — built-in Shiki dual-theme highlighting and
snippet handling), then execute the compiled output with `@mdx-js/mdx`'s `run()`
inside our `try/catch`. We use `serialize`+`run` rather than their `MDXRemote`
because `MDXRemote` throws compile errors at RSC render time (uncatchable without an
error boundary, which breaks streaming); running the compiled source ourselves keeps
the whole step catchable.

Measured on the same 125-page `papervine/docs` sample:

| Renderer | Fully rendered | Graceful notice | HTTP 500 |
|---|---|---|---|
| Our `@mdx-js/mdx` | 114 | 11 | 0 |
| `@mintlify/mdx` (`MDXRemote`) | 120 | 0 | 5 |
| **Hybrid (chosen)** | **115** | 10 | **0** |

Notes: `@mintlify/mdx@4` ships a broken peer dep (`@radix-ui/react-popover@^19.2.1`,
nonexistent) → needs `legacy-peer-deps`; and must be in `serverExternalPackages` or
it won't compile in the Next bundle. Known polish gaps from the switch: code titles
(`title="…"`) aren't emitted by their highlighter, and CodeGroup labels fall back to
the language name.

### Regression protection (added 2026-06-07)
`tests/fixtures/` encodes every fix above; `npm test` boots the renderer and asserts
no page 500s; CI also crawls `papervine/starter`. See README → Testing.
