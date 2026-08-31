# Configuration

One `docs.json` at the root of the docs folder configures the whole site. It follows the
established `docs.json` schema, so an existing docs repo renders unchanged.

```jsonc
{
  "$schema": "https://papervine.io/docs.json",
  "name": "Acme Docs",
  "description": "Everything you need to build on Acme.",
  "theme": "mint",
  "logo": { "light": "/logo/light.svg", "dark": "/logo/dark.svg" },
  "favicon": "/favicon.svg",
  "colors": { "primary": "#16A34A", "light": "#4ADE80", "dark": "#15803D" },
  "appearance": { "default": "light" },
  "navigation": {
    "tabs": [
      {
        "tab": "Guides",
        "groups": [
          { "group": "Get started", "pages": ["index", "quickstart"] }
        ]
      },
      { "tab": "API Reference", "openapi": "openapi.json" }
    ]
  },
  "navbar": {
    "links": [{ "label": "Support", "href": "https://acme.com/support" }],
    "primary": { "label": "Dashboard", "href": "https://acme.com/app" }
  },
  "banner": { "content": "Version 2.0 is live.", "type": "info", "dismissible": true },
  "seo": { "metatags": { "og:image": "/images/social.png", "twitter:site": "@acme" } }
}
```

`navigation` has its own reference — see `navigation.md`.

## Warn, don't throw

**A single unexpected field never breaks the site.** Every field parses leniently, and unknown
top-level keys are passed through with a warning rather than rejected.

Two consequences for how you work on a config:

- **Don't delete keys because Papervine doesn't act on them.** A config carried over from
  another platform is meant to keep rendering; the keys light up as features land.
- **Don't tighten a config by making fields required.** A malformed value degrades to the
  field's default, which is the intended behavior.

What *can* break a site is invalid JSON. A trailing comma is the usual culprit, and it presents
as a site that renders but looks unstyled.

## Branding

| Key | Type | Description |
| --- | --- | --- |
| `name` | string | Site name. Shown in the navbar when there is no logo. Defaults to `Docs`. |
| `description` | string | One-line summary of the whole site. Rendered as the blockquote in `/llms.txt` — the first thing an AI client reads to decide what these docs are. |
| `logo` | string \| `{ light, dark }` | Navbar logo. Give both variants — a dark logo on a dark background is the most common first-day complaint. |
| `favicon` | string \| `{ light, dark }` | Emitted as `<link rel="icon">`. A `{ light, dark }` pair emits one link per `prefers-color-scheme`, so the tab icon tracks light/dark. |
| `colors` | `{ primary, light, dark }` | The brand accent: links, active states, accents. `light`/`dark` let each appearance use a shade with enough contrast against its own background. |

Logo, favicon, and image paths are served from the site's own assets, so they are
root-relative to the docs folder.

## Themes

`theme` selects a named preset. Each changes typography, density, and layout proportions
together, so one value re-skins the site.

| Theme | Character | What sets it apart |
| --- | --- | --- |
| `mint` | Classic (**default**) | The baseline — sans type, moderate radii, open chrome |
| `maple` | Modern SaaS | Rounder surfaces, a wide navigation column with a divider |
| `palm` | Enterprise | Dense and rectilinear: tight radii, heavy headings, uppercase group labels |
| `willow` | Stripped back | Serif headings over a sans body, a narrower measure, airy leading |
| `linden` | Retro terminal | Monospace throughout, square corners, letterspaced uppercase labels |
| `almond` | Card-based | Rounded type, fully-pill navigation, generous surfaces |
| `aspen` | Deep navigation | The widest nav column, a divider, softly rounded surfaces |
| `sequoia` | Editorial | Serif body *and* headings, light weights, the airiest leading |
| `luma` | Clean and wide | The narrowest nav, the widest content, the lightest headings |

An unknown or misspelled theme name falls back to `mint`.

Themes use **system font stacks only** — no webfont is fetched, so a themed site renders
identically offline and never shifts layout on a cold cache. A theme is entirely a set of CSS
custom properties applied on `<html data-theme="…">`.

## Appearance (light and dark)

```json
"appearance": { "default": "light", "strict": false }
```

| Field | Values | Description |
| --- | --- | --- |
| `default` | `light` \| `dark` \| `system` | The initial mode. A reader's stored toggle wins; `system` follows the OS. Defaults to `light`. |
| `strict` | boolean | Hides the light/dark switcher **and** pins the mode to `default`, ignoring any stored choice. |

## Navbar

```json
"navbar": {
  "links": [{ "label": "Support", "href": "https://acme.com/support" }],
  "primary": { "label": "Dashboard", "href": "https://acme.com/app" }
}
```

`links` renders as plain text links; `primary` renders as the emphasised button at the right
end. Both take `label` and `href`.

## Site-wide banner

An announcement bar above the navbar on every page.

```json
"banner": {
  "content": "Version 2.0 is live. See the [changelog](/changelog).",
  "type": "info",
  "dismissible": true
}
```

| Field | Type | Description |
| --- | --- | --- |
| `content` | string | The message. Markdown links work. **The only required field** — a banner without it is dropped and the site renders as though it weren't there. |
| `type` | string | `info`, `warning`, or `critical`. |
| `color` | string \| `{ light, dark }` | Hex override for the background. |
| `dismissible` | boolean | Adds a close button. Dismissal is not remembered between page loads. |

For a notice on a single page, use the `<Banner>` component instead.

## SEO and social metadata

Every page emits a full set of `og:` / `twitter:` tags, with a generated 1200×630 social card
when the repo supplies no image of its own.

```json
"seo": {
  "metatags": {
    "og:image": "/images/social-card.png",
    "twitter:site": "@acme",
    "google-site-verification": "abc123"
  },
  "indexing": "navigable"
}
```

`metatags` is an open name → content map emitted in the `<head>` of every page. Tags Papervine
models itself are folded into the metadata it already builds; anything else is passed through
verbatim. **A page's own frontmatter overrides the site-wide value.**

`indexing` selects what the AI-discovery feed publishes: `navigable` (default — pages the
navigation reaches) or `all`. It does not affect the HTML `robots` meta tag; per-page `noindex`
is what controls that.

## Instructions for AI clients

```json
"markdown": {
  "instructions": "Cite the version you read. The v2 pages supersede v1."
}
```

Emitted verbatim into `/llms.txt` after the site summary — the place to tell an agent how to
use these docs.

## AI-discovery surfaces

Every site publishes these with no configuration:

| Path | What it is |
| --- | --- |
| `/llms.txt` | An index carrying the navigation's structure as headings, each page's `description`, and the OpenAPI specs the nav points at. `noindex` pages are excluded. |
| `/llms-full.txt` | The whole corpus in one document. |
| `<path>.md` | A Markdown twin of every page (`/guides/auth.md`), so a client following a link gets prose rather than a page to strip. |
| `/mcp` | An MCP server over the same content — `search_docs`, `read_page`, `list_pages`, and `search_api` when the site has an OpenAPI reference. |

`/.well-known/llms.txt` and `/.well-known/llms-full.txt` are aliases, and docs pages carry
`X-Llms-Txt` / `Link` discovery headers.

## skill.md

`llms.txt` tells an agent where to **read**; `skill.md` tells it what your product can **do**.
Put a `skill.md` at the docs root, beside `docs.json`:

```md
---
name: Acme Payments
description: Take and refund payments. Use when charging a customer, issuing a refund, or reconciling a payout.
license: MIT
compatibility: Requires an API key with the payments scope.
metadata:
  author: acme
  version: "1.0"
---

# Acme Payments

## Capabilities
...
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | The skill's name. Its slug is how the discovery endpoints address it. |
| `description` | string | One or two sentences on what the skill does. Shown in every index. |
| `license` | string | The skill's license. |
| `compatibility` | string | Requirements or runtime notes. |
| `metadata` | object | Anything else, as string key-value pairs. |
| `groups` | array | Restrict the skill to those reader groups. A restricted skill is withheld entirely — absent from every index, and its own URL answers `404`. |

For several distinct capabilities, give each its own directory under `.papervine/skills/`:

```
.papervine/
  skills/
    payments/
      SKILL.md
    analytics/
      SKILL.md
docs.json
```

A a legacy skills directory directory is read too, so a migrated repo keeps working; `.papervine/`
wins if a skill exists in both.

Served at `/skill.md`, `/.well-known/agent-skills/index.json`,
`/.well-known/agent-skills/{name}/SKILL.md`, `/.well-known/skills/index.json`, and
`/.well-known/agent-card.json` (an A2A 0.3 agent card). With more than one skill, `/skill.md`
redirects to the discovery index.

**A skill file is not a page.** It doesn't render, doesn't appear in navigation, and isn't
included in `llms.txt`.

A site with no skill file gets one generated from its documentation, served at the same paths.
**Writing your own turns generation off** — the moment a `skill.md` or a skills directory
appears in the repository, that is what's served and nothing regenerates. There's no merge.

## Keys that are accepted but not acted on

These parse without a warning but currently change nothing. Leave them in place — deleting them
would only make a migration back harder.

| Key | Status |
| --- | --- |
| `$schema` | Read and ignored. Keep whatever value the repo already has. |
| `footer` | Parsed, not yet rendered. |
| `authentication` | Passed through. Reader access is configured in the Papervine dashboard, not here — see [Reader access](#reader-access). |

Keys common in real repos that pass through **with a warning**, having no effect yet, include
`redirects`, `icons`, `integrations`, `contextual`, and `api`.

## Page frontmatter

```yaml
---
title: "Installing the SDK"
description: "Add the client library to your project and make your first call."
---
```

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | Page `<h1>`, sidebar label, browser title. Derived from the slug if omitted. |
| `description` | string | Summary under the heading; used by search results, `llms.txt`, and social previews. |
| `sidebarTitle` | string | Shorter label for the sidebar when the real title is long. |
| `icon` | string | Lucide icon name shown beside the sidebar entry. |
| `tag` | string | Small badge next to the sidebar entry (e.g. `NEW`). |
| `hidden` | boolean | Omit from the sidebar. The page still renders at its URL. |
| `noindex` | boolean | Exclude from search, `llms.txt`, and search engines. |
| `keywords` | string[] | Extra search terms. |
| `url` | string | The sidebar entry links here instead of to the page, opening in a new tab. |
| `groups` | string[] | Restrict the page to those reader-auth groups. |
| `public` | boolean | Opt the page out of group gating. |

**Any key containing a colon becomes a `<meta>` tag** and overrides the site-wide
`seo.metatags` value for that page:

```yaml
---
title: "Launch week"
og:image: "/images/launch-card.png"
twitter:card: "summary_large_image"
---
```

Unknown frontmatter keys are ignored, so a stray key from another tool won't break a build.
Malformed frontmatter degrades to a body-only page rather than an error.

### Fields that do not exist

- **`mode`** — there is no per-page layout switch (`wide`, `custom`, `frame`, `center`).
- **`openapi` / `api`** — a page cannot declare itself an endpoint page. Endpoint pages come
  from a navigation division pointing at a spec; see `api-docs.md`.
- **`searchable`, `boost`, `deprecated`, `related`** — not read.

## Hiding pages

Three different jobs, three mechanisms:

| Goal | How |
| --- | --- |
| Not in the sidebar, still reachable by URL | Leave the page out of every nav group, or set `hidden: true` in its frontmatter. |
| Not in the sidebar **and** not in search or search engines | `noindex: true` in frontmatter. |
| Not readable without signing in | Reader auth — `groups: [...]` in frontmatter, with groups configured in the dashboard. |

A whole **group** drops out of the sidebar with `"hidden": true` on the group. Pages inside it
still render. `"hidden": true` written on a **tab** is ignored — hide the tab's groups instead,
and a tab with no reachable pages disappears on its own.

There is **no ignore file** (no `.mintignore` equivalent). A page's visibility is nav
membership plus the frontmatter above.

## Reader access

`groups: ["admin"]` in a page's frontmatter restricts that page to signed-in readers in at
least one of the listed groups, and hides it from the navigation for everyone else. `public:
true` opts a page out of group gating.

The groups themselves, and the identity provider behind them, are configured in the Papervine
dashboard — not in `docs.json`. A self-hosted site served by the CLI has no reader auth at all,
so `groups:` has no effect there and the pages are public (including through its `/mcp`
endpoint).

## Snippets

Reusable MDX fragments live in `/snippets/`:

```mdx
import Prerequisites from "/snippets/prerequisites.mdx";

<Prerequisites />
```

`/snippets/` is the only import source a page may reach for. See `components.md`.
