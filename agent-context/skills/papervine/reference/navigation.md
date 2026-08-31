# Navigation

`navigation` in `docs.json` is the whole sidebar. **Papervine never infers structure from
folder layout** — the sidebar is exactly what `docs.json` says it is, so moving a page in the
sidebar never means moving a file, and a page nobody listed appears in no sidebar.

## Page paths

Each string under `pages` is a path relative to the docs root, **without the extension**:

- `"guides/auth"` → `guides/auth.mdx` (or `.md`)
- `"index"` → the site's index page, served at `/`

The index page has two spellings — write `"index"` in `docs.json`; its route is `/`.

## The smallest useful config

```json
{
  "name": "Acme Docs",
  "navigation": {
    "groups": [
      { "group": "Get started", "pages": ["index", "quickstart"] },
      { "group": "Guides", "pages": ["guides/auth", "guides/webhooks"] }
    ]
  }
}
```

## One recursive tree

`navigation` is a nested tree of *division* types, each of which can contain the next,
bottoming out in page slugs:

```
languages → versions → tabs → anchors / dropdowns → groups → pages
```

A repo uses only the layers it needs. Every layer is optional and composable, and the tree is
walked fully recursively — a small site declaring just `groups` and a large one nesting
`languages[].versions[].tabs[]…` both work.

An **unlabeled wrapper** splices its children up a level, so an extra layer of nesting with no
`group`/`anchor`/`dropdown` label is harmless.

## Groups

A group is a labelled sidebar section. Order matters: groups render top to bottom in the order
listed, and so do the pages inside them.

```json
{
  "group": "API",
  "icon": "code",
  "pages": [
    "api/overview",
    {
      "group": "Endpoints",
      "pages": ["api/users", "api/orders"]
    }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `group` | string | The section label. |
| `pages` | array | Page slugs and/or nested divisions. |
| `icon` | string | Lucide icon name beside the group header. |
| `tag` | string | Small badge beside the group header. |
| `root` | string | A page slug rendered as the group's own landing entry, before its children. |
| `expanded` | boolean | Default a collapsible group to open. |
| `hidden` | boolean | Drop the group from the published sidebar. Its pages still render at their URLs. |

Groups can nest. Keep it to one level of nesting — deeper and readers lose track of where they
are. Nested groups are always collapsible; a top-level group is a static header unless it is an
OpenAPI tag group.

**A group with no reachable pages is dropped**, not rendered as a bare label. That is how a
fully reader-gated group disappears for readers who can't see any of it, and it recurses: an
empty subgroup is dropped, so its parent may be dropped in turn.

## Tabs

Tabs split a site into areas shown across the top, each with its own sidebar. They suit
documentation with genuinely different audiences or modes — a user guide and an API reference.

```json
{
  "navigation": {
    "tabs": [
      {
        "tab": "Guides",
        "groups": [
          { "group": "Get started", "pages": ["index", "quickstart"] }
        ]
      },
      {
        "tab": "API Reference",
        "groups": [
          { "group": "Widgets", "openapi": "openapi.json" }
        ]
      }
    ]
  }
}
```

Each tab links to its first page, and the active tab is the one containing the current page.

Three behaviors worth knowing:

- **The tab bar only appears with two or more tabs.** A single tab renders its sidebar with no
  bar above it.
- **A tab with no reachable pages is dropped automatically** — so hiding every group inside a
  tab hides the tab.
- **`"hidden": true` on a tab is ignored.** It looks like it should work. Mark the tab's groups
  instead.

A tab takes no `icon`.

Reach for tabs when a reader would otherwise scroll past a whole section that is never relevant
to them. If every reader needs everything, groups alone are simpler — a tab the reader never
opens is a section you've hidden from them.

## Anchors and dropdowns

`anchors` and `dropdowns` are labelled containers, the same shape as `groups` with `anchor` /
`dropdown` as the label key:

```json
{
  "navigation": {
    "anchors": [
      { "anchor": "Documentation", "pages": ["index", "quickstart"] },
      { "anchor": "SDKs", "groups": [{ "group": "JavaScript", "pages": ["sdk/js"] }] }
    ]
  }
}
```

They render as labelled sidebar sections, like groups.

**An anchor with no pages is dropped.** So this does not produce an off-site link:

```json
{ "anchor": "Community", "href": "https://discord.gg/…", "icon": "discord" }
```

Off-site links belong in `navbar.links` (or `navbar.primary` for the emphasised button) — see
`configuration.md`.

`navigation.global` is parsed but not rendered. Put the divisions directly on `navigation`.

## Versions and languages

Both are accepted, and **only the first entry renders**. There is no switcher yet, so a config
with two versions or two languages silently shows the first one and its whole subtree.

```json
{
  "navigation": {
    "versions": [
      { "version": "v2", "groups": [{ "group": "Get started", "pages": ["v2/index"] }] },
      { "version": "v1", "groups": [{ "group": "Get started", "pages": ["v1/index"] }] }
    ]
  }
}
```

The `v1` subtree above renders no sidebar entries. Its pages are still reachable by URL. Don't
introduce a `versions` or `languages` wrapper on a site that doesn't already have one — the
second entry becomes invisible. An existing repo that has one keeps rendering, which is the
point of accepting it.

## OpenAPI in the navigation

A division with an `openapi` property generates one nav entry per operation. Point it at a spec
path relative to the docs root, and give it no `pages`:

```json
{ "group": "Widgets", "openapi": "openapi.json" }
```

```json
{ "tab": "API Reference", "openapi": "openapi.json" }
```

Operations are **grouped by their first OpenAPI tag** — each tag becomes a collapsible nav
group with its operations in spec order, tags in first-encounter order, untagged operations as
bare entries above them. A spec with no tags at all renders a flat list. Every entry carries a
colored HTTP-method badge.

To select or reorder operations, list them as `"METHOD /path"` selectors. Strings that don't
look like a selector are treated as ordinary page slugs, so hand-written pages can mix in:

```json
{
  "group": "Widgets",
  "openapi": "openapi.json",
  "pages": [
    "api/authentication",
    "GET /widgets",
    "POST /widgets",
    "DELETE /widgets/{id}"
  ]
}
```

A selector matching no operation in the spec is dropped silently. Supplying `pages` turns off
the tag grouping — you get exactly the entries you listed, in that order.

More than one spec can be referenced; every `openapi` value found anywhere in the tree is
loaded. See `api-docs.md`.

## Diagnosing a nav problem

**A page isn't in the sidebar.** Its path is probably missing from `docs.json` or has a typo.
The path is relative to the docs folder with no extension. Also check the page's frontmatter
for `hidden: true` or a `groups:` restriction.

**A group renders as an empty label.** It won't — an empty group is dropped. If a group
vanished, every page in it was filtered out by `hidden`, `groups:`, or a bad path.

**An external anchor shows nothing.** Anchors need pages. Use `navbar.links`.

**A whole version or language is missing.** Only the first entry of a `versions` / `languages`
wrapper renders.

**Everything renders but looks unstyled.** `docs.json` is probably invalid JSON — a trailing
comma is the usual culprit. `papervine dev` surfaces it immediately.

**An unfamiliar key.** Unknown fields are ignored with a warning rather than failing the build.
Some keys are accepted but not yet acted on; `configuration.md` lists them.
