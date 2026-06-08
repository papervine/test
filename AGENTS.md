# Working on Docbot

Docbot is an open-source, multi-tenant **docs.json-compatible docs platform**: it renders a docs site
from a Git repo of MDX + a `docs.json`. Read [`SPEC.md`](./SPEC.md) for the
architecture and roadmap, and [`GAP-REPORT.md`](./GAP-REPORT.md) for what does and
doesn't render yet vs. representative docs repos.

This file is the contract for how to work in this repo. Follow it for every change.

## Definition of done

A feature/fix is not done until **all** of these pass:

1. `npm run typecheck` — clean.
2. `npm test` — the fixtures smoke test (boots the real renderer, asserts no page 500s).
3. **A regression test exists for what you changed** — see "Always write tests" below.
4. **Verified in a real browser** — screenshot the affected page (`agent-browser`, light
   AND dark mode if visual). Don't claim a UI change works from the DOM alone; layout
   bugs (e.g. the card `h-full` height bug) only show visually.
5. For renderer/config/nav changes: **crawl a representative docs repo** and confirm no
   regressions — `node tests/crawl.mjs <cloned-incumbent-repo>` (expect 0 × HTTP 500).

State plainly what you ran and what passed. If something is unverified, say so.

## Always write tests

Regression protection is a hard requirement, not optional.

- Tests live in `tests/`. The core gate is `tests/smoke.mjs` (zero-dep, fetch-based):
  it serves `tests/fixtures/` and asserts each page renders without a 500.
- **To cover a new case, add a fixture** under `tests/fixtures/` that exercises it
  (and register it in `tests/fixtures/docs.json` nav), then add a check to the
  `CHECKS` array in `tests/smoke.mjs`. Prefer this over mocks — it tests the real
  pipeline end to end.
- Fixtures should reproduce the *actual failure shape* you're fixing. Every fixture
  page maps to a bug we found (object favicon, `languages` nav, `.md`, unknown/
  member-expr components, bad frontmatter, snippet imports, hidden pages, card height).
- CI (`.github/workflows/ci.yml`) runs typecheck + build + smoke test. Keep it green.

## How the renderer works (don't break this)

MDX rendering is a **hybrid** (`src/lib/mdx.tsx`): compile with `@mintlify/mdx`'s
`serialize` (the third-party MDX serializer — Shiki dual-theme highlighting + snippet
handling), then execute the compiled output with `@mdx-js/mdx`'s `run()` inside a
`try/catch`. Do not "simplify" this to their `MDXRemote` — it throws compile errors
at RSC render time, which can't be caught without an error boundary (and a boundary
breaks RSC streaming). The hybrid keeps the whole step catchable. See GAP-REPORT.

Core principles, in priority order:

- **Never let one unsupported feature 500 a page.** Unknown components degrade to
  their children (`componentsForCompiled` scans the compiled source for every
  referenced component and supplies a passthrough `Fallback`, incl. member-expression
  components via a Proxy). Compile failures render an inline notice, not a 500.
- **Config is a compatibility layer: warn, don't throw** (`src/lib/config.ts`). A
  single unexpected `docs.json` field must never break the site. Every field is
  lenient (`.catch`), unknown keys are passed through with a warning.
- **`docs.json` is docs.json-compatible.** Match their schema/behavior so real repos
  migrate unchanged. When unsure how something should behave, check against a real
  docs.json repo, don't guess.

## Gotchas (learned the hard way — don't rediscover these)

- **dev/prod JSX runtime must match.** Compile (`serialize`) and `run()` must use the
  same `development` flag / runtime, or React 19 throws "production element rendered
  in development". This is why we left plain `next-mdx-remote`.
- **`@mintlify/mdx@4` has a broken peer dep** (`@radix-ui/react-popover@^19.2.1`,
  nonexistent) → `.npmrc` sets `legacy-peer-deps=true`. Keep it.
- **MDX packages must be in `serverExternalPackages`** (`next.config.mjs`) or they
  fail to compile in the Next bundle.
- **Percentage heights + flex stretch.** `h-full` resolves against the nearest
  definite-height ancestor; a stretched flex item (e.g. `<article>`) can give cards
  full-page height. Use `items-start` on content rows; this bit the Card component.
- **Tests fetch `127.0.0.1`, not `localhost`**, and bind the dev server to `0.0.0.0`
  — some runners resolve `localhost` to IPv6 `::1` while Next listens on IPv4.

## Commands

```bash
npm run dev                 # serve ./content
npm run build               # production build
npm run typecheck           # tsc --noEmit
npm test                    # fixtures smoke test (the regression gate)
node bin/docbot.mjs dev <dir>     # preview any docs repo (docs dev analogue)
node tests/crawl.mjs <dir>        # crawl a real repo, report rendered/degraded/500
```

## Conventions

- TypeScript strict, App Router / RSC. Server components by default; add `"use client"`
  only for interactivity (see `src/components/mdx/Tabs.tsx`, `Accordion.tsx`).
- Match the surrounding code's style, comment density, and naming. Comments explain
  *why* (especially the non-obvious gotchas above), not *what*.
- Keep `SPEC.md` / `GAP-REPORT.md` current when you make architectural decisions or
  change what renders — record the decision and the measured result.
- Don't commit unless asked. When you do, end commit messages with the Co-Authored-By
  trailer already used in this repo's history.
