---
name: papervine
description: Comprehensive reference for building Papervine documentation sites. Use when creating pages, configuring docs.json, adding components, setting up navigation, working with API references, or running the papervine CLI. Routes to detailed reference files for all components and configuration options.
---

<!-- Generated from papervine/papervine's agent-context. Edit the canonical source, not this copy. -->

# Papervine reference

Reference for working on Papervine docs sites. A site is a Git repository of MDX pages plus
one `docs.json`, rendered by Papervine — hosted, or served yourself with the `papervine` CLI.

This file covers what applies to every task. Read a reference file only when the task needs it.

## Reference index

The files below live in the `reference/` directory next to this one.

| File | When to read |
|------|-------------|
| `reference/components.md` | Adding or modifying components (callouts, cards, steps, tabs, code groups, accordions, frames, badges, icons, tooltips, trees, colors, updates, prompts, panels, views, mermaid) — full props for each. |
| `reference/configuration.md` | Changing `docs.json` (theme, colors, logo, favicon, appearance, navbar, banner, SEO) or page frontmatter. Also snippets, hidden pages, reader-auth gating, `llms.txt`, `skill.md`, and which keys are accepted but not yet acted on. |
| `reference/navigation.md` | Modifying navigation structure (groups, tabs, anchors, dropdowns, versions, languages) or adding an OpenAPI reference to the nav. |
| `reference/api-docs.md` | Setting up API documentation (OpenAPI/AsyncAPI, endpoint pages, the Try it playground, manual API pages). |
| `reference/cli.md` | Running the CLI (`papervine new`, `dev`, `serve`) and serving a site in production. |

## MCP servers

Two servers ship with this plugin. They are different surfaces, not two halves of one.

### Papervine Docs (read)

`https://docs.papervine.io/mcp` — read-only access to Papervine's own published documentation,
no authentication. Reach for it when these reference files don't cover a detail, or to check
current behavior before telling the user something is unsupported.

Tools: `search_docs` (full-text search; call this first), `read_page` (a page's Markdown by
slug), `list_pages` (every page's title and href).

### Papervine Authoring (write)

`https://app.papervine.io/authoring/mcp` — read **and edit** a docs site the user can edit.
Authorize on first use: the client opens a browser tab, the user approves the request, and the
grant is an expiring OAuth token. Nothing to paste, nothing to revoke by hand.

Name the target site with two headers on every request:

```
x-papervine-org: acme
x-papervine-site: docs
```

Tools: `read`, `search`, `list_pages` (all draft-aware), `write_page` (full MDX, frontmatter
included), `edit_page` (find/replace on the raw MDX), and `save` (`mode: "pr" | "commit"`).

**Edits buffer on a draft branch and are not live until `save`.** A working branch is checked
out automatically on first write (or name one with `x-papervine-branch`). `save` with
`mode: "pr"` opens a pull request; `mode: "commit"` writes to the deploy branch. The same draft
buffer backs Papervine's browser editor, so a person can open the site and watch the changes.

Requires an org role that can edit docs. A refusal names its reason — not signed in, not a
member, role too low, no such site — so read the message rather than retrying.

### Which one, and when

**Working in a Git checkout of the docs? Edit the files.** That is the ordinary case in an
editor, and it keeps the change in the user's normal review and commit flow. The authoring MCP
is for editing a site whose repository you do *not* have open — a hosted site, someone else's
repo, a quick fix from a machine with no checkout.

Never use both on the same site in one task: a file edit and a draft-branch edit are two
uncoordinated copies of the same page, and whichever publishes last silently wins.

## Before you start

Read the project's `docs.json` first — it defines the navigation, theme, and colors, and it is
the only thing that decides what appears in the sidebar.

Search for existing content before creating a page. Read 2-3 similar pages to match the
site's voice, structure, and formatting.

## File format

Pages are MDX (`.mdx`, and `.md` also renders) with YAML frontmatter.

```
my-docs/
├── docs.json           # Site configuration (required, at the docs root)
├── index.mdx
├── quickstart.mdx
├── guides/
│   └── example.mdx
├── openapi.json        # API specification (optional)
├── images/             # Referenced root-relative from pages
│   └── example.png
└── snippets/           # Reusable MDX fragments
    └── prerequisites.mdx
```

### File naming

- Match the existing pattern in the directory.
- With no pattern to match, use kebab-case: `getting-started.mdx`.
- Add the page to `docs.json` navigation or it appears in no sidebar (it still renders at its
  URL — which is a legitimate way to park a draft).

### Internal links

Root-relative, no extension: `/getting-started/quickstart`. Never relative (`../page`), never
an absolute URL for an internal page — a site may be served from a subdomain, a custom domain,
or a path prefix, and only root-relative links survive all three.

### Images

Keep them in the repository and reference them root-relative. Alt text is required.

```mdx
![The deploy log after a successful sync](/images/deploy-log.png)
```

Papervine measures images at sync time and reserves their space as the page loads, so pictures
don't shove text around while a reader is reading.

## Page frontmatter

```yaml
---
title: "Connect a repository"
description: "Point Papervine at a Git repo of MDX and docs.json, and publish on push."
---
```

`title` becomes the `<h1>`, the sidebar label, and the browser title. `description` is the line
a reader uses to decide whether this is the page they wanted, and it feeds search, `llms.txt`,
and social cards — write a real one on every page.

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Page heading, sidebar label, browser title. Derived from the slug if omitted. |
| `description` | string | Summary under the heading; used by search and social previews. |
| `sidebarTitle` | string | Shorter label for the sidebar. |
| `icon` | string | Lucide icon name for the sidebar entry. |
| `tag` | string | Small badge beside the sidebar entry (e.g. `NEW`). |
| `hidden` | boolean | Omit from the sidebar; still reachable by URL. |
| `noindex` | boolean | Exclude from search, `llms.txt`, and search engines. |
| `keywords` | string[] | Extra search terms. |
| `url` | string | The sidebar entry links here instead of to the page. |
| `groups` | string[] | Restrict the page to those reader-auth groups. |
| `public` | boolean | Opt the page out of group gating. |

Any key containing a colon (`og:image`, `twitter:card`) is emitted as a `<meta>` tag,
overriding the site-wide value. Unknown keys are ignored rather than erroring.

There is **no `mode` field** and **no page-level `openapi`/`api` field** — endpoint pages come
from a navigation division that points at a spec. See `reference/api-docs.md`.

## Quick component reference

The most-used components. Full props for all of them are in `reference/components.md`.

### Callouts

```mdx
<Note>Worth knowing, but you can keep going without it.</Note>
<Info>Background or a prerequisite — what you needed to know first.</Info>
<Tip>A shortcut, or the way we would do it.</Tip>
<Warning>This one bites. Read it before you run the command.</Warning>
<Check>Done — this is what success looks like.</Check>
<Danger>Destructive or irreversible. Data goes away.</Danger>
```

### Steps

```mdx
<Steps>
  <Step title="First step">
    Instructions for step one.
  </Step>
  <Step title="Second step">
    Instructions for step two.
  </Step>
</Steps>
```

### Tabs and code groups

```mdx
<Tabs>
  <Tab title="npm">
    ```bash
    npm install package-name
    ```
  </Tab>
  <Tab title="pnpm">
    ```bash
    pnpm add package-name
    ```
  </Tab>
</Tabs>
```

````mdx
<CodeGroup>

```javascript example.js
export const site = "acme-docs";
```

```python example.py
site = "acme-docs"
```

</CodeGroup>
````

Give every fence in a `<CodeGroup>` a title — tab labels fall back to the language name, so
three `bash` blocks all read the same.

### Cards and columns

```mdx
<Columns cols={2}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    From an empty folder to a rendered site.
  </Card>
  <Card title="Components" icon="book" href="/components">
    Every component, with its props.
  </Card>
</Columns>
```

`<Columns>` arranges cards in a grid; `cols` is the count for a screen wide enough to hold it
(phone width is always one column). `<CardGroup>` is the same component under its legacy name.

### Accordions

```mdx
<AccordionGroup>
  <Accordion title="Why is my page missing?">It is probably not in docs.json.</Accordion>
  <Accordion title="Why is it unstyled?">docs.json probably has a trailing comma.</Accordion>
</AccordionGroup>
```

### Code blocks

Text after the language becomes the block's title, shown in a header bar:

````mdx
```ts lib/greet.ts
export function greet(name: string) {
  return `Hello, ${name}`;
}
```
````

Highlighting is generated when the docs are built, in both light and dark themes at once, and
every block gets a copy button. Line-highlight ranges (```` ```js {2,4-6} ````) are parsed as
"not a title" and otherwise ignored — they render no differently from a plain block.

### Diagrams

A fence tagged `mermaid` renders as a diagram, drawn in the browser and following the page's
light/dark appearance. A diagram that fails to parse falls back to showing its source.

### Video and embeds

There is **no video component** — video and embeds are plain HTML, which is deliberate, so a
page moves between platforms untouched:

```mdx
<video controls className="w-full aspect-video rounded-xl" src="/videos/demo.mp4"></video>

<iframe
  className="w-full aspect-video rounded-xl"
  src="https://www.youtube.com/embed/VIDEO_ID"
  title="YouTube video player"
  allowFullScreen
></iframe>
```

Use a provider's **embed** URL — a `youtube.com/watch?v=…` link won't play in a frame.

## Your own React components

A page can define a component and use it immediately, with React hooks in scope and nothing to
import:

```mdx
export const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>;
};

<Counter />
```

Available without importing: `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`,
`useContext`, `useReducer`.

The rules — a component must be a **named arrow function assigned to a `const`**. These forms
render an inline notice instead of the page:

- `export default` (use a named export)
- `function` declarations (use an arrow function)
- importing npm packages, JSON, or relative paths
- dynamic `import()` and `React.lazy`

The only import a page may make is a snippet: `import Thing from "/snippets/thing.mdx"`.

Author components run **in the reader's browser**, so they appear a moment after the
surrounding text, and an expression that inspects the server (`{process.env.SOMETHING}`) has
nothing to read. Values fixed at publish time belong in `docs.json` or frontmatter.

## Degradation: the renderer never 500s a page

Worth knowing because it changes how failures present:

- An **unknown component** degrades to its children — it renders as plain content, and the
  rest of the page is unaffected. A component appearing as plain text usually means a
  misspelled name.
- A **page that can't compile** shows an inline notice on that page. The rest of the site keeps
  working.
- An **unexpected `docs.json` key** is passed through with a warning, never rejected. This is
  what lets an existing docs repo render unchanged — do not "fix" a config by deleting keys
  Papervine doesn't act on.

## CLI

```bash
npx papervine new my-docs   # scaffold a site from the starter template
npx papervine dev           # preview ./ (needs a docs.json)
npx papervine dev ./docs    # preview a subfolder
papervine serve ./docs      # serve it for real (binds 0.0.0.0)
```

Three commands, and that is the whole surface: **there is no `deploy`, no `login`, no
`validate`, no `broken-links`, no `a11y`, and no `score`.** Publishing happens through Git and
the hosted control plane. Requires Node 20.9+. Saving a file and refreshing shows the change;
there is no hot reload. See `reference/cli.md`.

## Writing standards

- **Second person, present tense.** "You connect a repo", not "the user connects a repo".
- **Say what it does before how to configure it.** A reader who lands mid-page from search
  needs the sentence that orients them.
- **Sentence case in headings and code-block titles.** Title Case reads as branding.
- **Every fence gets a language.** It is what produces highlighting, and an untagged block is
  rendered as plain grey text.
- **Every image gets alt text describing what it shows**, not what it is — "the dashboard after
  a first sync" beats "screenshot".
- **A `description` on every page.** It is the line search results, `llms.txt` and social cards
  use, so a missing one costs a reader the choice of whether to open the page.
- **No emoji, no filler, no superlatives.** "Simply", "just", "powerful" and "seamless" all
  survive deletion.
- **Prefer a shorter page to a longer one.** Two pages with real titles beat one with four
  levels of heading.
- **Don't repeat the `title` as an `# H1`.** The title already renders as the page heading, so
  a second one gives the page two competing headings and a confusing outline.

## Common mistakes

- Relative links (`../page`) instead of root-relative (`/section/page`).
- File extensions in internal links (`/page.mdx` instead of `/page`).
- Forgetting to add a new page to `docs.json` navigation.
- A code block with no language tag.
- Images without alt text.
- A Font Awesome or Tabler icon name — Papervine resolves **Lucide** names only, and an
  unknown name renders nothing. `<Icon src="/path.svg" />` takes any file or URL.
- `"hidden": true` on a **tab** — ignored. Mark its groups instead.
- Assuming a `mint`-family CLI command exists (`validate`, `broken-links`, `a11y`, `score`,
  `automations`, `deploy`, `login`). None of them do.
- Writing `openapi:` in a page's frontmatter to make an endpoint page. Point a navigation
  division at the spec instead.
- A trailing comma in `docs.json` — it is strict JSON.
