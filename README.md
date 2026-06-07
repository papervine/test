# Docbot

An open-source, multi-tenant documentation platform — a clone of [the incumbent](https://example.com/). Point it at a folder of **MDX** + a single **`docs.json`** and get a fast, themeable docs site.

See [`SPEC.md`](./SPEC.md) for the full architecture and roadmap.

## Status: M0 — renderer skeleton

The single-tenant rendering core (SPEC.md milestone M0). What works today:

- **`docs.json` parsing** — Zod-validated, docs.json-compatible schema with a recursive `navigation` tree (`src/lib/config.ts`)
- **MDX rendering** — compiled with `@mdx-js/mdx` + Shiki syntax highlighting (`src/lib/mdx.tsx`)
- **Component library** — Cards, Tabs, Steps, Callouts, CodeGroups, Accordions, Frame (`src/components/mdx/`)
- **Navigation + TOC** — recursive sidebar with active states, on-page table of contents
- **Theming** — colors from `docs.json` drive CSS variables; light/dark mode

Not yet built (later milestones): multi-tenancy + Git sync (M2), search (M3), API playground (M4), AI assistant (M5), dashboard (M6).

## Run

```bash
npm install
npm run dev      # serves ./content at http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run typecheck`.

## CLI — preview any docs repo

`docbot dev` boots the renderer pointed at any folder of MDX + `docs.json`
(the analogue of `docs dev`):

```bash
docbot dev              # preview the current directory
docbot dev ./docs       # preview ./docs
docbot dev -p 4000      # custom port
```

Run it inside a docs repo and it renders that repo — no copying into `./content`.
Under the hood it sets `DOCBOT_CONTENT` to the target folder and runs the renderer
from the Docbot package, so the same env var works directly too:

```bash
DOCBOT_CONTENT=/path/to/docs-repo npm run dev
```

Pre-release, invoke the CLI via `npm run docbot -- dev ./docs` or `./bin/docbot.mjs
dev ./docs`. Once published it's `npx docbot dev`.

## Content

Docs live in [`./content`](./content), fully separate from the app — read at request
time so nothing tenant-specific is baked into the build (the M2 multi-tenant model).

```
content/
├── docs.json        # config + recursive navigation
├── index.mdx        # home (slug "")
├── quickstart.mdx
└── guides/
    ├── markdown.mdx
    └── components.mdx
```

A page's sidebar label comes from its frontmatter `title` (falling back to a
title-cased slug). Register pages by adding their slug to a group's `pages` array
in `docs.json`.

## Testing

```bash
npm test                              # smoke test: render every fixture page, assert no 500s
node tests/crawl.mjs <docs-dir>       # crawl any real docs repo, report rendered/degraded/500
node tests/crawl.mjs <dir> --sample=120
```

`tests/fixtures/` is a docs repo that deliberately exercises every M1 fix (object
`favicon`, `languages` nav, `.md` files, unknown + member-expression components,
malformed frontmatter, unresolved snippet imports, `hidden` pages). The smoke test
boots the real renderer against it and asserts each page returns 200 — so the
[GAP-REPORT](./GAP-REPORT.md) fixes can't silently regress. CI (GitHub Actions)
runs typecheck + build + smoke test.

`tests/crawl.mjs` is the real-repo probe (run it locally against a cloned
docs.json repo, e.g. `papervine/starter` or `papervine/docs`); it isn't in CI because
booting a dev server per run is flaky on hosted runners.

## Tech

Next.js (App Router / RSC) · TypeScript · Tailwind · Zod · Shiki.
**MDX rendering is a hybrid:** compile with `@mintlify/mdx` (the third-party MDX serializer
— their Shiki dual-theme highlighting + snippet handling) and execute the compiled
output with `@mdx-js/mdx`'s `run()` inside a `try/catch`, so unsupported features
degrade to a notice instead of crashing the page.
