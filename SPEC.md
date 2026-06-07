# Docbot — Open-Source Docs Platform

**Status:** Draft v0.1
**Date:** 2026-06-07
**Owner:** jeff@loiselles.com

An open-source, multi-tenant documentation platform — a faithful clone of [the incumbent](https://example.com/). Users connect a Git repo containing MDX files + a `docs.json` config; Docbot renders a fast, beautiful, searchable docs site with an interactive API playground and an AI assistant. One deployment serves many tenants.

---

## 1. Vision & Principles

- **Docs-as-code.** Source of truth is MDX + `docs.json` in the user's Git repo. The platform is a renderer + control plane, never the source of truth.
- **Multi-tenant from day one.** A single app instance serves all customer doc sites, addressable by subdomain (`acme.docbot.app`) and custom domain (`docs.acme.com`).
- **`docs.json`-compatible.** Adopt the incumbent's `docs.json` schema so existing docs.json projects migrate with minimal changes. This is our primary adoption hook.
- **Runtime rendering, no content at build time.** Like the incumbent, the deployed app has no tenant content baked in. Content is fetched + rendered on demand (with aggressive caching). New deploys don't require rebuilding every tenant.
- **Fast by default.** React Server Components, edge caching, minimal client JS.
- **Open source.** Permissive license (MIT/Apache-2.0). Self-hostable; the hosted SaaS is a convenience, not a lock-in.

---

## 2. Architecture Overview

```
                    ┌─────────────────────────────────────────┐
                    │              Git Provider                 │
                    │        (GitHub / GitLab repos)            │
                    │   MDX files + docs.json + openapi.yaml    │
                    └───────────────┬───────────────────────────┘
                                    │ webhook on push
                                    ▼
┌──────────────┐         ┌──────────────────────┐
│  Dashboard   │────────▶│   Control Plane API   │
│ (Next.js app)│         │  - tenant mgmt        │
│  - settings  │         │  - git sync workers   │
│  - members   │         │  - domain mgmt        │
│  - analytics │         │  - billing            │
└──────────────┘         └──────────┬────────────┘
                                    │ writes
                                    ▼
                         ┌──────────────────────┐
                         │   Content Store        │
                         │  - object storage (S3) │ ← compiled MDX bundles
                         │  - Postgres (metadata) │ ← tenants, domains, config
                         │  - Redis (cache)       │
                         │  - Vector DB (AI)      │ ← embeddings for AI assistant
                         └──────────┬─────────────┘
                                    │ reads
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│            Render Plane — single Next.js app (multi-tenant)         │
│  Request: docs.acme.com/guides/intro                                │
│   1. Resolve host → tenant (middleware)                             │
│   2. Load tenant docs.json + page bundle from cache/store           │
│   3. Render RSC: nav tree + MDX + components                        │
│   4. Serve with edge cache (ISR / stale-while-revalidate)           │
│  Routes: /[...slug] docs · /api/search · /api/chat · /api/playground│
└──────────────────────────────────────────────────────────────────┘
```

### Two deployable planes
1. **Render Plane** — the public-facing Next.js app that serves every tenant's docs site. Stateless, horizontally scalable, reads from the Content Store. This is where 99% of traffic goes.
2. **Control Plane** — dashboard + API for tenant management, Git sync, billing, analytics. Lower traffic, write-heavy.

They can be the same Next.js codebase (different route groups) or split later for scaling. **v1: single Next.js monorepo app, split when needed.**

### Tenant resolution
Next.js **middleware** inspects the `Host` header:
- `*.docbot.app` subdomain → look up tenant by slug
- custom domain → look up tenant by domain (cached map in Redis)
- rewrites internally to `/_sites/[tenant]/[...slug]`

---

## 3. Content Pipeline (Git Sync)

1. User connects repo via GitHub App / OAuth (read access to one repo).
2. On `push` webhook (or manual "sync"), a **sync worker**:
   - clones/pulls the repo at the target ref
   - validates `docs.json` against schema (fail loudly with line numbers)
   - **compiles** each `.mdx` → serializable bundle (via `next-mdx-remote` / `mdx-bundler` / `@mdx-js/mdx`), resolving our component set
   - extracts headings → builds search index + per-page TOC
   - parses any referenced OpenAPI/AsyncAPI specs → playground page definitions
   - generates embeddings for changed pages → vector store (AI assistant)
   - writes compiled bundles + manifest to object storage, metadata to Postgres
   - invalidates CDN/Redis cache for changed paths
3. Render Plane reads compiled bundles at request time. **No live MDX compilation on the hot path** (compile-on-sync, not compile-on-request) — this is the key perf decision.

> Note: the incumbent compiles some things (e.g. Twoslash) on the fly via serverless. We prefer compile-on-sync for predictability; revisit if it limits dynamic features.

---

## 4. Config: `docs.json` (docs.json-compatible)

Single config file at repo root. Mirror the incumbent's schema so migration is trivial. Core shape:

```jsonc
{
  "$schema": "https://docbot.app/schema.json",
  "name": "Acme Docs",
  "theme": "mint",                    // built-in layout/theme preset
  "logo": { "light": "/logo-light.svg", "dark": "/logo-dark.svg" },
  "favicon": "/favicon.png",
  "colors": {
    "primary": "#16A34A",
    "light": "#4ADE80",
    "dark": "#15803D"
  },
  "navigation": {                     // ← single recursive structure
    "tabs": [
      {
        "tab": "Guides",
        "groups": [
          { "group": "Getting Started",
            "pages": ["index", "quickstart", "guides/auth"] }
        ]
      },
      {
        "tab": "API Reference",
        "openapi": "/openapi.yaml"     // auto-generates playground pages
      }
    ],
    "global": {
      "anchors": [
        { "anchor": "Community", "href": "https://...", "icon": "discord" }
      ]
    }
  },
  "navbar": { "links": [...], "primary": { "type": "button", "label": "Dashboard", "href": "..." } },
  "footer": { "socials": { "github": "https://..." } },
  "search": { "prompt": "Search docs..." },
  "ai": { "assistant": true }
}
```

**Schema strategy:** publish a JSON Schema; validate on sync; support the subset of docs.json keys we implement and warn (don't error) on unrecognized keys so docs.json configs work out of the box. Track schema parity in a compatibility matrix doc.

The `navigation` field is **one recursive tree** — tabs contain groups/anchors/versions/languages, which contain pages — matching the incumbent's docs.json refactor. Model it as a single recursive TypeScript type.

---

## 5. MDX Component Library (v1)

Ship a styled component set resolved at compile time. Parity targets with the incumbent:

| Component | Notes |
|---|---|
| `<Card>` / `<CardGroup>` | linkable cards w/ icon, grid layout |
| `<Tabs>` / `<Tab>` | tabbed content |
| `<Accordion>` / `<AccordionGroup>` | collapsible |
| `<Steps>` / `<Step>` | numbered walkthroughs |
| `<Note>` `<Warning>` `<Info>` `<Tip>` `<Check>` | callouts |
| `<CodeGroup>` | multi-language code tabs |
| Code blocks | Shiki syntax highlighting, copy button, titles, line highlights |
| `<Frame>` | image/embed framing w/ caption |
| `<Tooltip>` `<Expandable>` `<Icon>` | inline helpers |
| Mermaid | diagrams |
| `<ParamField>` `<ResponseField>` | API param docs |
| `<Update>` | changelog entries |

- **Theming:** CSS variables driven by `docs.json` colors; light/dark mode; one or two layout presets in v1.
- **Markdown features:** GFM, footnotes, auto-linked headings, frontmatter (title, description, icon, sidebar overrides), `og:` image generation per page.

---

## 6. Search (v1)

- **Engine:** [Orama](https://oramasearch.com/) (embeddable, runs in-process or as a service) or **Pagefind** for static-leaning setups. Lean Orama for the SaaS.
- Index built during sync (titles, headings, body, code). Stored per-tenant.
- `Cmd/Ctrl-K` command palette UI; keyboard nav; recent/suggested.
- `/api/search?q=` endpoint per tenant, edge-cached.
- Pluggable: allow Algolia as an alternative provider via config.

---

## 7. API Playground (v1)

- **Input:** OpenAPI 3.0+ (YAML/JSON) and AsyncAPI; referenced from `docs.json` (`"openapi": "..."`).
- **Generation (at sync time):** parse spec → one page per operation (or grouped by tag), with:
  - method + path header, description, auth requirements
  - request param/body docs (`<ParamField>`), schema explorer
  - response schemas + examples (`<ResponseField>`)
  - **interactive "Try it"** panel: fill params/headers/body, send request, see response
- **Auth methods:** API key, Bearer, Basic, OAuth2 (config-driven).
- **CORS/proxy:** requests can route through a Docbot proxy endpoint to avoid CORS and to inject secrets safely (optional per tenant).
- **Code samples:** auto-generate curl/JS/Python/etc. snippets per endpoint.
- Libraries to evaluate: `openapi-types`, `@scalar/*` (open-source API reference, worth studying/reusing), `openapi-sampler`.

---

## 8. AI Assistant (v1)

- **Conversational search** over the tenant's docs + OpenAPI specs.
- **Pipeline:** RAG — embed pages at sync time → vector store (pgvector / Turbopuffer / Pinecone) → on query, retrieve top-k chunks → answer with **Claude** (`claude-sonnet-4-6` for cost/latency; `claude-opus-4-8` optional) → stream response with inline citations linking back to source pages.
- **Surfaces:** in-docs chat widget (the `Cmd-K` panel can switch between search and "Ask AI"); `/api/chat` SSE endpoint; embeddable script for external sites (later).
- **Guardrails:** answer only from retrieved tenant content; cite sources; "I don't know" when low confidence. Per-tenant rate limits + token budgets.
- **Analytics:** log queries, retrieval hits, and "unanswered" questions → surface in dashboard (content gaps).
- Use the Anthropic API; see `claude-api` skill for current model IDs, streaming, and tool-use patterns.

---

## 9. Dashboard / Control Plane (supporting v1)

Minimum to operate the SaaS:
- **Auth:** org + user accounts (e.g. Auth.js / Clerk / WorkOS). RBAC: owner/admin/editor/viewer.
- **Projects:** connect Git repo, pick branch, manual sync, view sync logs/errors.
- **Domains:** assign `*.docbot.app` subdomain; add custom domain (DNS verification + auto TLS via the host platform / `caddy` / ACME).
- **Analytics:** page views, top pages, search terms with no results, AI unanswered questions. PostHog or a lightweight first-party events table.
- **Billing (later):** Stripe; usage tiers (seats, AI tokens, page views).
- **Web editor / live preview (later):** the incumbent has one; defer past v1.

---

## 10. Tech Stack (proposed)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router, RSC)** | Matches the incumbent; multi-tenant middleware; streaming |
| Language | **TypeScript** strict | |
| MDX | `@mdx-js/mdx` + `mdx-bundler` / `next-mdx-remote` | compile-on-sync |
| Syntax highlight | **Shiki** | fast, accurate, themes |
| Styling | **Tailwind CSS** + CSS variables | theme tokens from docs.json |
| Search | **Orama** (Algolia optional) | embeddable, multi-tenant |
| DB | **Postgres** (+ `pgvector`) | tenants, config, embeddings |
| Cache | **Redis** | domain→tenant map, page cache |
| Object storage | **S3-compatible** (R2) | compiled bundles, assets |
| Queue/workers | **BullMQ** / serverless functions | git sync jobs |
| AI | **Anthropic Claude** API | assistant + RAG |
| Auth | Auth.js / Clerk / WorkOS | orgs + RBAC |
| Hosting | Vercel (render) + workers elsewhere | mirrors the incumbent's Vercel approach |
| Monorepo | pnpm + Turborepo | shared packages |

**Prior art to study/borrow (all OSS):** [Fumadocs](https://github.com/fuma-nama/fumadocs) (Next.js docs framework), [unmint](https://github.com/gregce/unmint) (incumbent-style on Fumadocs), [Scalar](https://github.com/scalar/scalar) (API reference/playground), [Nextra](https://nextra.site/), Docusaurus. Strongly consider building the renderer *on top of* Fumadocs primitives rather than from scratch.

---

## 11. Proposed Monorepo Layout

```
docbot/
├── apps/
│   ├── render/          # public docs site (multi-tenant Next.js)
│   └── dashboard/       # control plane UI + API
├── packages/
│   ├── config/          # docs.json schema, parser, validator, TS types
│   ├── mdx/             # MDX compile pipeline + component resolution
│   ├── ui/              # shared component library (Card, Tabs, Steps…)
│   ├── search/          # search index build + query
│   ├── openapi/         # spec parsing → playground page model
│   ├── ai/              # RAG pipeline, embeddings, chat
│   ├── sync/            # git sync workers
│   └── db/              # Postgres schema + access (Prisma/Drizzle)
└── SPEC.md
```

---

## 12. Milestones

**M0 — Foundations (renderer skeleton)**
Single-tenant happy path: read a local `docs.json` + MDX folder, render nav tree + pages + core components + Shiki. No multi-tenancy yet. Proves the rendering core.

**M1 — `docs.json` parity + components**
Full schema parser/validator, recursive navigation, theming from colors, the full v1 component library, dark mode, per-page TOC, frontmatter.

**M2 — Multi-tenancy + Git sync**
Middleware host→tenant resolution, subdomains, GitHub App connect, sync workers, compiled-bundle storage, cache invalidation. Now it's a SaaS.

**M3 — Search**
Orama index at sync, Cmd-K palette, `/api/search`.

**M4 — API Playground**
OpenAPI parse → reference pages, "Try it" panel, code samples, auth.

**M5 — AI Assistant**
Embeddings at sync, RAG + Claude, streaming chat widget with citations, unanswered-question analytics.

**M6 — Dashboard + Domains + Analytics**
Org/auth/RBAC, custom domains + TLS, analytics views. Beta-ready.

(Order is roughly dependency-driven; M3–M5 can parallelize after M2.)

---

## 13. Open Questions

1. **Compile-on-sync vs. on-request.** Spec assumes compile-on-sync for perf/predictability. Does that block any dynamic features we care about (e.g. live Twoslash)?
2. ~~**Build on Fumadocs vs. from scratch.**~~ **DECIDED (2026-06-07): from scratch.** Multi-tenancy and full control over the architecture outweigh the head start. M0 is a single Next.js app; refactor into the monorepo packages at M2 when multi-tenancy lands.
3. **Versioning & i18n.** docs.json supports versions + languages in the nav tree. In v1 scope or fast-follow?
4. **Self-host story.** How easy must the OSS self-host path be vs. the hosted SaaS? Affects how much we hardwire to R2/Vercel/etc.
5. **License & governance.** MIT vs. Apache-2.0; CLA; what (if anything) is SaaS-only (open-core) vs. fully open.
6. **Pricing/limits** for the hosted version (out of scope for build, but shapes tenancy/metering design).
7. **Web editor** — defer past v1? The incumbent treats it as a differentiator.

---

## 14. Non-Goals (v1)

- Visual/WYSIWYG web editor (fast-follow)
- Migrating from non-hosted docs sources (Docusaurus/GitBook importers)
- Embeddable AI on third-party sites
- Marketplace / plugin ecosystem
- On-prem enterprise deploys
