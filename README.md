<h1 align="center">Papervine</h1>

<p align="center">
  <strong>The docs platform alternative built for humans and AI.</strong><br />
  Point it at a folder of MDX + a <code>docs.json</code> and get a fast, themeable docs site.
</p>

<p align="center">
  <a href="https://papervine.io">Website</a> ·
  <a href="./SPEC.md">Architecture & roadmap</a> ·
  <a href="https://github.com/papervine/papervine/issues">Issues</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

## Why Papervine?

Hosted docs platforms are great — until you hit a paywall for basic customization, or your compliance team asks where the data lives. Papervine is a docs platform alternative with the polish of a hosted docs platform and none of the lock-in:

- **Own your docs.** MDX files in your repo, rendered by software you control. Your content is always just files.
- **Drop-in `docs.json` compatibility.** Papervine reads MDX content and a recursive `docs.json` navigation file, then renders the site without a proprietary build step.
- **Built for AI too.** llms.txt and MCP out of the box, plus an agentic docs assistant — your docs work as well for AI agents as for people.

## Features

- ✍️ **MDX rendering** with Shiki dual-theme syntax highlighting — unsupported features degrade to a notice instead of crashing the page
- 🧩 **Component library** — Cards, Tabs, Steps, Callouts, CodeGroups, Accordions, Frame
- 🧭 **Navigation + TOC** — recursive, docs.json-compatible `navigation` tree with active states and on-page table of contents
- 🎨 **Theming** — colors in `docs.json` drive CSS variables; light/dark mode out of the box
- ✅ **Validated config** — Zod-validated `docs.json`, so misconfiguration fails loudly with useful errors
- 🏢 **Multi-tenant hosting** — serve each connected site at `{slug}.papervine.io` or a custom domain, with an automatic path-based fallback (`/sites/{slug}`) for deploys without wildcard TLS
- 🤖 **AI docs assistant** — an "Ask Assistant" panel powered by Claude with agentic docs retrieval (bring your own `ANTHROPIC_API_KEY`)

### Roadmap

Search, OpenAPI playground, and the full dashboard are in progress — see [`SPEC.md`](./SPEC.md) for milestones and [open issues](https://github.com/papervine/papervine/issues) to vote on what we build next.

## Quick start

```bash
npm install
npm run dev      # serves ./content at http://localhost:3000
```

### Preview any docs repo with the CLI

Run `papervine dev` inside any folder of MDX + `docs.json`:

```bash
papervine dev              # preview the current directory
papervine dev ./docs       # preview ./docs
papervine dev -p 4000      # custom port
```

Pre-release, invoke it via `npm run papervine -- dev ./docs`. Once published: `npx papervine dev`. Under the hood it sets `PAPERVINE_CONTENT` to the target folder, so the env var works directly too:

```bash
PAPERVINE_CONTENT=/path/to/docs-repo npm run dev
```

## Migrating existing docs

There is no import step. Papervine reads MDX files and `docs.json` directly:

```bash
git clone https://github.com/your-org/your-docs
papervine dev ./your-docs
```

Pages, navigation, frontmatter titles, snippets, and components render as-is; anything Papervine doesn't support yet degrades gracefully rather than 500ing. You can verify coverage on your own repo:

```bash
node tests/crawl.mjs /path/to/your-docs   # reports rendered / degraded / errored pages
```

## Project structure

```
content/
├── docs.json        # config + recursive navigation
├── index.mdx        # home (slug "")
├── quickstart.mdx
└── guides/
    ├── markdown.mdx
    └── components.mdx
```

Docs live fully separate from the app and are read at request time — nothing tenant-specific is baked into the build. A page's sidebar label comes from its frontmatter `title` (falling back to a title-cased slug); register pages in a group's `pages` array in `docs.json`.

## Tenant domains

Each connected site is served at its own host — `{slug}.papervine.io` in production, `{slug}.localhost:3100` in dev — or a custom domain. Subdomain serving requires a wildcard domain + wildcard TLS; deploys that can't provide that (e.g. a bare `*.vercel.app`) automatically fall back to path-based serving at `/sites/{slug}` with links and assets correctly prefixed. See [`SPEC.md`](./SPEC.md) §2 for switching a deploy from paths to subdomains.

## Development

**Seed a dev account:** `npm run db:seed` (with the Docker Postgres running) creates a known login — `dev@papervine.local` / `dev-password-123` — with an org, a connected site, an activity feed, and analytics data, so you can sign in at `/login` and see a populated dashboard without walking signup → onboarding → connect. The seed is idempotent and refuses any non-local `DATABASE_URL`. Run dev on the port `BETTER_AUTH_URL` points at (`:3000`) so sign-in's origin check passes.

**AI assistant:** set `ANTHROPIC_API_KEY` in `.env.local`. Without it the panel still opens and the API returns a graceful 503. Optional: `PAPERVINE_AI_MODEL` (default `claude-sonnet-4-6`).

**Other scripts:** `npm run build`, `npm run start`, `npm run typecheck`.

## Testing

```bash
npm test                              # render every fixture page, assert no 500s
node tests/crawl.mjs <docs-dir>       # crawl a real docs repo, report rendered/degraded/500
node tests/crawl.mjs <dir> --sample=120
npm run eval                          # benchmark automation models (paid; not CI — see evals/README.md)
npm run eval:web                      # same, as a local web UI with live color-coded diffs
```

`tests/fixtures/` deliberately exercises edge cases (object `favicon`, `languages` nav, `.md` files, unknown components, malformed frontmatter, unresolved snippet imports, `hidden` pages) so fixes can't silently regress. CI runs typecheck + build + smoke test.

`npm run eval` ([`evals/`](./evals/)) is a **model benchmark**, not a CI test: it runs candidate automation models through the real agent loop over a corpus with planted errors and scores accuracy / over-editing / code-safety. It calls paid, non-deterministic models (needs `AI_GATEWAY_API_KEY`), so it's run on demand when choosing an automations model — never in CI.

## Tech

Next.js (App Router / RSC) · TypeScript · Tailwind · Zod · Shiki.

MDX rendering is a hybrid: compiled with a third-party serializer for highlighting/snippet support and executed with `@mdx-js/mdx`'s `run()` inside a `try/catch`, so unsupported features degrade to a notice instead of crashing the page.

## Contributing

We love contributions of every size — bug reports, docs fixes, themes, and features.

1. Fork the repo and create a branch
2. `npm install && npm run dev`
3. Open a PR — we review fast

Check [good first issues](https://github.com/papervine/papervine/labels/good%20first%20issue) to get started.

## License

Papervine Cloud and enterprise features are commercial offerings built on top of the core platform.

Papervine is an independent project.
