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
   - **compiles** each `.md(x)` to a serializable bundle with the **hybrid renderer**: `@mintlify/mdx`'s `serialize` (the third-party MDX serializer — Shiki dual-theme highlighting + snippet handling) executed via `@mdx-js/mdx`'s `run` inside a try/catch, so an unsupported feature degrades to an inline notice rather than a 500 (rationale + measurements in `GAP-REPORT.md`). Resolves our component set, with a passthrough fallback for unknown/member-expression components.
   - extracts headings → builds search index + per-page TOC
   - parses any referenced OpenAPI/AsyncAPI specs → playground page definitions
   - generates embeddings for changed pages → vector store (AI assistant)
   - writes compiled bundles + manifest to object storage, metadata to Postgres
   - invalidates CDN/Redis cache for changed paths
3. Render Plane reads compiled bundles at request time. **No live MDX compilation on the hot path** (compile-on-sync, not compile-on-request) — this is the key perf decision.

> Note: the incumbent compiles some things (e.g. Twoslash) on the fly via serverless. We prefer compile-on-sync for predictability; revisit if it limits dynamic features.

### 3.1 Static assets

Docs reference assets by absolute path from the repo root (e.g. `![](/img/hero.png)`, and
the `logo`/`favicon` paths in `docs.json`). Those files live alongside the MDX, **outside
the app**, so they aren't served from Next's `public/`. `src/middleware.ts` rewrites any
request ending in a static-asset extension to `/dbasset/[...path]`, a route handler that
streams the file from the content dir with the correct `Content-Type` and a
path-traversal guard.

- **Today (local / single-tenant):** streamed straight from `DOCBOT_CONTENT`. Works in
  `docbot dev`; a production `next build` would need the content traced in (a dev-time
  concern only, not the SaaS path).
- **M2 (multi-tenant):** the same `/img/...` URLs resolve to the tenant's asset bucket
  (signed-URL redirect or proxy) — the URL shape is unchanged.

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

**Themes & appearance:** `theme` selects a named visual preset — one of `mint` (default),
`maple`, `palm`, `willow`, `linden`, `almond`, `aspen`, `sequoia`, `luma` (the incumbent's set).
Each preset is a small token bundle (font stacks, corner radius, …) applied as CSS variables
on `<html data-theme="…">`; unknown names fall back to `mint`. `appearance` controls
light/dark — `{ "default": "light" | "dark" | "system", "strict": boolean }`: `default` sets
the initial mode (a stored user toggle wins; `system` follows the OS), and `strict` (later)
hides the light/dark switcher. `colors` (`primary`/`light`/`dark`) drives the brand accent
independently of the theme.

---

## 5. MDX Component Library (v1)

Ship a styled component set resolved at compile time. Parity targets with the incumbent:

| Component | Notes |
|---|---|
| `<Card>` / `<CardGroup>` / `<Columns>` | linkable cards w/ icon; `<Columns>` is the incumbent's current name for the grid, `<CardGroup>` the legacy alias |
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

- **Theming:** named theme presets (`theme` in docs.json — `mint`/`maple`/`palm`/`willow`/`linden`/`almond`/`aspen`/`sequoia`/`luma`, the incumbent's set) defined as token bundles in `src/lib/theme.ts` and applied as CSS variables on `<html data-theme="…">`, so the whole UI re-skins from one config value. Adding/tuning a theme = one registry entry (+ optional CSS keyed on `[data-theme="…"]`). Brand accent from `docs.json` `colors`; light/dark default from `appearance.default`.
- **Markdown features:** GFM, footnotes, auto-linked headings, frontmatter (title, description, icon, sidebar overrides), `og:` image generation per page.
- **Page chrome (incumbent parity):**
  - Top-level `navigation.tabs` render as a horizontal **tab bar**; the sidebar is **scoped
    to the active tab** (the one containing the current page). Nested groups are collapsible.
  - **Section eyebrow:** the group label the page belongs to is shown in the primary color
    above the page `<h1>`.
  - **"On this page" TOC** with scroll-spy — the heading currently in view is highlighted
    (IntersectionObserver) and the panel stays sticky below the navbar + tab bar.
  - **Default appearance is light** (matches the incumbent); the OS preference is not followed
    unless the reader toggles.
  - **Prose links** use the default text color with a primary-colored underline (not
    colored text); heading auto-link anchors keep the heading's own color.

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

## 8. AI Assistant (M5)

A conversational assistant over the tenant's docs + OpenAPI, modeled on the incumbent's
"Ask Assistant" (right-hand slide-out panel). Verified behaviors we target are
cited from the incumbent's own docs/blog where noted.

> **Status — slice 1 built (2026-06-08):** agentic `/api/assistant` route (Claude via
> Vercel AI SDK v6 + tool calling over `searchDocs`/`readPage`/`listPages`/`searchApi`
> in `src/lib/assistant-tools.ts`), slide-out panel (`src/components/assistant/`) using
> `useChat` + `streamdown`, navbar "Ask Assistant" button, `Cmd/Ctrl-I`, and
> `?assistant=` deep link. Requires `ANTHROPIC_API_KEY` (graceful 503 without it).
> **Next:** dedicated `Sources` citation UI, multi-modal attach, current-page context
> polish, embeddings-backed `searchDocs`.

### 8.1 Architecture: agentic retrieval, not single-shot RAG

The incumbent's assistant is **agentic RAG with tool calling, powered by Claude** — it
*decides how to search* the docs per question rather than doing one top-k lookup, and
they replaced RAG sandboxes with a "virtual filesystem over their vector DB" so the
model navigates docs via filesystem-like tools ([the incumbent's blog](https://example.com/blog/how-we-built-a-virtual-filesystem-for-our-assistant)).
We adopt the same shape — and it's cheap for us because **the tools are thin wrappers
over capabilities we already have** (M1 content loader, M2 nav, M3 search, M4 OpenAPI):

```
User question ──▶ /api/assistant (Vercel AI SDK streamText, Claude)
                    │  loop: model calls tools until it can answer
                    ├─ search_docs(query)      → M3 search index (titles/headings/body)
                    ├─ read_page(slug)         → full MDX (src/lib/content.ts)
                    ├─ list_pages()            → nav tree (src/lib/nav.ts)
                    └─ search_api(query)       → OpenAPI operations (src/lib/openapi.ts)
                    ▼
                 streamed answer + Sources (cited page hrefs / #anchors)
```

- **Model:** Claude via the Vercel AI SDK (`@ai-sdk/anthropic`). Default
  `claude-sonnet-4-6` (cost/latency); `claude-opus-4-8` as an optional "high quality"
  tier. See the `claude-api` skill for current IDs, streaming, and tool-use patterns.
- **Why tools over pure top-k:** multi-step retrieval handles vague questions, lets the
  model read a whole page when a snippet isn't enough, and unifies with §8.5.
- **Embeddings are optional for v1.** Agentic search can run on the M3 keyword/Orama
  index first (the model iterates); add a `pgvector` semantic `search_docs` backend
  later without changing the tool contract.
- **Current-page context:** the page the user is on is injected into the system prompt
  as starting context (the incumbent does this), so "how do I do *this*?" resolves locally.
- **Guardrails:** answer only from tool results; cite every claim; say "I don't know"
  and surface the tenant's **deflection email** (configurable, like the incumbent) when
  confidence is low. Per-tenant rate limits + token budget.

### 8.2 UI — built on AI Elements

Use **[AI Elements](https://elements.ai-sdk.dev/)** (shadcn/ui + Vercel AI SDK
components) so we don't hand-roll chat UI:

- `Conversation` + `Message` — the transcript
- `Response` — streaming markdown (renders our same MDX-ish content, code blocks)
- `Sources` — the cited pages/anchors under each answer (navigable, like the incumbent)
- `PromptInput` — the "Ask a question…" box with file/image attach (the paperclip in
  the reference screenshot — multi-modal input, which Claude supports)
- `Suggestions` — starter / follow-up questions
- `Reasoning` / `Chain of Thought` — optional, to show tool-call/search steps

Chrome: a right-hand **slide-out panel** ("Assistant", expand + close), an **"Ask
Assistant"** button in the navbar, and the disclaimer "Responses are generated using AI
and may contain mistakes." Themed via our CSS variables (matches the docs site).

### 8.3 Invocation (match the incumbent)

- **"Ask Assistant"** navbar button → opens the panel.
- **Keyboard:** `Cmd/Ctrl-I` (the incumbent's shortcut). `Cmd-K` stays search; the two are
  distinct surfaces.
- **Text selection:** "Ask about this" on highlighted text.
- **Deep link:** `?assistant=YOUR_QUERY` on any page auto-opens the panel and asks —
  used for "Ask AI" links and shareable answers.

### 8.4 Indexing & freshness

- Index **published pages + OpenAPI specs** at sync time (M2); re-index changed pages
  on publish. Exclude `hidden`/`noindex` pages unless `docs.json` `seo.indexing: "all"`
  (the incumbent's exact toggle; we already parse `hidden`/`noindex` frontmatter).

### 8.5 Surfaces beyond the docs site

- `/api/assistant` SSE endpoint (AI SDK data stream). Offer a docs.json-compatible alias
  path so existing integrations port over.
- **Embeddable** in external apps/portals; **Slack + Discord bots** later (the incumbent has
  both).
- **Shared tool layer = the planned per-docs MCP server:** `search_docs` / `read_page` /
  `list_pages` / `search_api` are exactly the tools a generated read-MCP would expose, so
  the in-docs assistant and the MCP server become one implementation, two transports.

### 8.6 Analytics

Log queries, which tools/pages were retrieved, citations, and **unanswered questions**
→ surface "content gaps" in the dashboard (the incumbent does this; high product value).

---

## 9. MCP Servers

Docbot exposes Model Context Protocol servers so AI tools can both **read** a docs site
and **edit** it — mirroring the incumbent, which ships two distinct MCP servers.

### 9.1 Generated read MCP (per docs site)

Auto-generated for every published site (no authoring needed), for the docs *readers'* AI
tools (Claude, Cursor, Windsurf). Exposes the **same tool layer as the AI Assistant (§8.1)**
— `search_docs`, `read_page`, `list_pages`, `search_api` — over Streamable HTTP at e.g.
`https://{tenant}/mcp`. One implementation, two transports (in-docs chat + MCP).

- Indexes published pages + OpenAPI specs; excludes hidden/noindex (per §8.4).
- Opt-in + configured via `docs.json`; per-tenant rate limits.

### 9.2 Authoring MCP (admin / write)

Lets a docs *owner* connect an AI tool to **edit their docs** (matches the incumbent's Admin
MCP). All edits happen on a session branch and land via a Pull Request — never directly on
the deploy branch. Tools:

- **Content:** `read`, `write_page` (full MDX), `edit_page` (targeted), `search`
- **Structure:** `create_node` / `move_node` / `update_node` / `delete_node` / `list_nodes`
  — pages, groups, tabs, anchors, versions — operating on our recursive `navigation` (§4)
- **Config:** `update_config` (edit `docs.json`)
- **Git:** `checkout` (first call — opens a `docbot-mcp/<slug>` branch), `diff`,
  `save` (`mode: "pr" | "commit"`), `discard_session`
- **Auth:** a platform-auth (Layer 1, §11) token scoped to the org/repo; RBAC ≥ editor.
- This is the agent-native counterpart to the web editor (§10) and embodies AGENTS.md's
  "any action a user can take, an agent can too."

### Status & sequencing

Both are post-M5. The read MCP is a thin wrapper once the assistant tools exist; the
authoring MCP follows the Git-sync (§3) + platform-auth (§11) foundations.

---

## 10. Dashboard / Control Plane (supporting v1)

Minimum to operate the SaaS:
- **Auth:** org + user accounts via **Better Auth** (see §11). RBAC: owner/admin/editor/viewer.
- **Projects:** connect Git repo, pick branch, manual sync, view sync logs/errors.
- **Domains:** assign `*.docbot.app` subdomain; add custom domain (DNS verification + auto TLS via the host platform / `caddy` / ACME).
- **Analytics:** page views, top pages, search terms with no results, AI unanswered questions. PostHog or a lightweight first-party events table.
- **Billing (later):** Stripe; usage tiers (seats, AI tokens, page views).
- **Web editor / live preview (later):** the incumbent has one; defer past v1.

---

## 11. Authentication & Access Control

Docbot has **two completely separate auth systems**. They have different users,
different urgency, and different security surfaces. Conflating them is the most common
way to over-build this, so the spec keeps them apart.

| | **Layer 1 — Platform auth** | **Layer 2 — Reader auth** |
|---|---|---|
| Who logs in | Our customers (docs owners + their team) | Our customers' *readers* (their end users) |
| Protects | The Docbot dashboard / control plane | Published docs *pages* (private/internal/gated docs) |
| Who owns identity | **We do** (we are the IdP) | **The customer does** (we only *verify* an assertion) |
| Needed by | Every tenant — prerequisite for multi-tenancy | Only some tenants (enterprise) |
| Maps to the incumbent | Their dashboard account | Their "Authentication & Personalization" |

### 11.1 Layer 1 — Platform auth (we build this)

Standard SaaS account auth: sign up, create/join an **organization** (= tenant), invite
team members, connect a repo, manage billing. RBAC roles: owner/admin/editor/viewer.

**Choice: [Better Auth](https://www.better-auth.com/).** Rationale:

- **Open-source & self-hostable, owns its own schema in our Postgres.** A self-hoster
  runs the exact same code with zero third-party accounts; no OSS-vs-SaaS fork (resolves
  the spirit of Open Question §16.4). This rules out Clerk/Auth0 as the *core* — they'd
  bake a vendor dependency into the open-source product.
- **First-class `organization` plugin** = tenants/teams/roles/invites out of the box.
  "Multi-tenant" here means orgs, not just users, so this is the exact shape we need
  instead of hand-rolling it (which is the main reason we pick it over Auth.js v5).
- **TypeScript-native, App Router / RSC-first** — sessions read cleanly in
  `middleware.ts` and server components; fits the strict-TS codebase.
- **JWT/JWKS plugins** — the *same* library that issues platform sessions also signs the
  per-tenant tokens Layer 2 needs. One mental model covers both layers.

Other options, and why not now: **WorkOS** — not the core, but the planned path for
enterprise **SAML/SSO into the platform** (the same enterprise buyers who want Layer 2).
Add it behind Better Auth's org model when the first enterprise deal lands. **Clerk** —
fastest DX, only if we decide OSS self-hosting is *not* a real goal (we've decided it is).
**Auth.js v5** — viable but minimal; Better Auth ≈ Auth.js + the org layer we'd otherwise
write by hand.

### 11.2 Layer 2 — Reader auth (docs.json-compatible handshake)

We never run an IdP for readers and never store reader credentials. We **verify a signed
assertion** from the customer's own login system, then mint a short docs session. This is
a much smaller security surface than real auth — the customer's IdP does the hard part.
Match the incumbent's model exactly so their configs migrate unchanged.

**Handshake methods** (in build order):

1. **JWT** (simplest, build first). Per-tenant Ed25519 keypair; tenant stores the private
   key. After the user logs into *their* app, their backend signs a JWT (**EdDSA only**)
   and redirects the browser to `https://{DOCS_HOST}/login/jwt-callback#{JWT}` (token in
   the URL **hash**, never logged). Payload (docs.json-compatible):
   ```ts
   type User = {
     host?: string;          // must equal the docs domain — blocks token replay
     expiresAt?: number;     // docs session length (hours–weeks)
     groups?: string[];      // → page access control
     content?: Record<string, any>;             // → personalization, exposed as `user` in MDX
     apiPlaygroundInputs?: { server; header; query; cookie; path };  // pre-fill API keys
   };
   ```
   The JWT's own `exp` is kept ≤10s — it's a one-time handoff, distinct from `expiresAt`.
   We verify signature + `host`, then set our own session cookie. Unauthenticated
   deep-links round-trip through `?redirect=%2Fintended-path`.
2. **OAuth 2.0** (PKCE). For tenants with an existing OAuth/OIDC server: they expose a
   user-info `GET` endpoint returning the `User` JSON above; we run the auth-code+PKCE
   flow and read groups/content from it.
3. **Password** — single shared secret, no per-user identity. Cheapest to ship.

**Access control (partial authentication):**

- Default: every page requires auth. Opt out per page with `public: true` in frontmatter,
  or per nav group with `"public": true` in `docs.json`.
- Group gating: `groups: ["admin"]` in frontmatter; user must be in ≥1 listed group.
- **Denial returns 404, not 403** (deliberate — don't leak that a protected page exists).
- Enforced in **middleware**, before `[[...slug]]` renders — the same interception point
  that already handles asset rewrites (`src/middleware.ts`).

**Personalization:** the `content` blob is exposed as a `user` variable in MDX scope
(threaded through `src/lib/mdx.tsx`), letting a page render conditionally per user/group.
This forces per-request rendering, which fights compile-on-sync caching — defer to v2+.

### 11.3 Sequencing (v1 → enterprise)

1. **v1 (now):** Layer 1 only — Better Auth + `organization` plugin, **email/password**
   first (GitHub OAuth a fast-follow), **Neon** Postgres (provisioned via Stripe Projects),
   middleware session check, RBAC, repo connect. Nothing multi-tenant works without it.
   Deploy sequencing: ship the public renderer first (single-tenant, already live on
   Vercel + git-connected), then layer auth on — auth does not block going online.
2. **v2 (first paying customers ask):** Layer 2 **JWT** handshake + `public:`/`groups:`
   page gating. Personalization (`user` in MDX) after that.
3. **Enterprise (when a deal demands it):** WorkOS SAML/SSO into the platform; OAuth-2.0
   reader handshake; per-user personalization at scale.

---

## 12. Tech Stack (proposed)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router, RSC)** | Matches the incumbent; multi-tenant middleware; streaming |
| Language | **TypeScript** strict | |
| MDX | **hybrid**: `@mintlify/mdx` `serialize` + `@mdx-js/mdx` `run` (see §3) | the incumbent-fidelity highlighting/snippets + catchable, never-500 render |
| Syntax highlight | **Shiki** (via `@mintlify/mdx`) | fast, accurate, dual light/dark themes |
| API reference | `@scalar/openapi-parser` (parse/dereference) + our native renderer | incumbent model: in-nav endpoint pages, not a foreign embed (§7) |
| CLI | `docbot dev <dir>` (`bin/docbot.mjs`) | preview any MDX + docs.json repo locally — the `docs dev` analogue; `tests/crawl.mjs` reuses it |
| Styling | **Tailwind CSS** + CSS variables | theme tokens from docs.json |
| Search | **Orama** (Algolia optional) | embeddable, multi-tenant |
| DB | **Postgres** (+ `pgvector`) — hosted: **Neon** | tenants, config, embeddings; Neon serverless for the Vercel deploy, provisioned via the Stripe Projects CLI (`stripe projects add neon/postgres`) |
| Cache | **Redis** | domain→tenant map, page cache |
| Object storage | **S3-compatible** (R2) | compiled bundles, assets |
| Queue/workers | **BullMQ** / serverless functions | git sync jobs |
| AI | **Vercel AI SDK** + `@ai-sdk/anthropic` (Claude); **AI Elements** for chat UI | agentic assistant (§8) |
| Auth (platform) | **Better Auth** (+ `organization`) | OSS, self-hostable, orgs + RBAC; WorkOS for enterprise SSO later (§11) |
| Hosting | Vercel (render) + workers elsewhere | mirrors the incumbent's Vercel approach |
| Monorepo | pnpm + Turborepo | shared packages |

**Decision (see `GAP-REPORT.md`): built from scratch, not on Fumadocs** — multi-tenancy and full control over the renderer outweighed the head start. We still borrow OSS building blocks where they earn it (`@mintlify/mdx` for compile, `@scalar/openapi-parser` for OpenAPI). Prior art studied: [Fumadocs](https://github.com/fuma-nama/fumadocs), [unmint](https://github.com/gregce/unmint), [Scalar](https://github.com/scalar/scalar), [Nextra](https://nextra.site/), Docusaurus.

---

## 13. Proposed Monorepo Layout

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

## 14. Quality & Testing

Regression protection is a hard requirement (enforced — see `AGENTS.md` → Definition of Done).

- **Fixtures smoke test** (`tests/smoke.mjs`, `npm test`): boots the real renderer against
  `tests/fixtures/` — a docs repo reproducing every fixed bug (object favicon, `languages`
  nav, `.md`, unknown/member-expression components, malformed frontmatter, snippet imports,
  hidden pages, standalone cards, OpenAPI endpoints, search, assistant route) — and asserts
  each page returns 200 (never 500) with the expected content.
- **Real-repo crawl** (`tests/crawl.mjs <dir>`): the `docbot dev` analogue used to validate
  against representative docs repos; reports rendered / degraded / 500, non-zero exit on any 500.
- **CI** (`.github/workflows/ci.yml`): typecheck + build + smoke test on every push / PR.
- **Compatibility findings** vs. representative docs repos are tracked in `GAP-REPORT.md`.

---

## 15. Milestones

**M0 — Foundations (renderer skeleton)**
Single-tenant happy path: read a local `docs.json` + MDX folder, render nav tree + pages + core components + Shiki. No multi-tenancy yet. Proves the rendering core.

**M1 — `docs.json` parity + components**
Full schema parser/validator, recursive navigation, theming from colors, the full v1 component library, dark mode, per-page TOC, frontmatter.

**M2 — Multi-tenancy + Git sync**
Middleware host→tenant resolution, subdomains, GitHub App connect, sync workers, compiled-bundle storage, cache invalidation. Now it's a SaaS.

**M3 — Search**
Orama index at sync, Cmd-K palette, `/api/search`.
- ✅ **Slice 1 (done):** full-text search over page titles + per-heading sections (so hits
  jump to the right `#anchor`), with prefix/typo tolerance, the `⌘K` command palette, and
  the `/api/search` endpoint. Engine: Orama (`src/lib/search.ts`, `src/components/SearchDialog.tsx`);
  `hidden`/`noindex` pages are excluded; covered by `tests/smoke.mjs`. The index is built
  **per request (memoized)**, not at sync, so it stays fresh in `docbot dev`.
- ⏳ **Next:** build the index **at sync time** per tenant (depends on M2) instead of per
  request; an "Ask AI" toggle in the palette (shares the M5 assistant); recent/suggested terms.

**M4 — API Playground**
OpenAPI parse → reference pages, "Try it" panel, code samples, auth.
- ✅ **Slice 1 (done):** `docs.json` `openapi` on a nav division auto-generates in-theme,
  in-nav endpoint pages (method/path, params, request/response schemas via
  `ParamField`/`ResponseField`/`Expandable`, static cURL). Spec parsed/dereferenced with
  Scalar's MIT `@scalar/openapi-parser`; rendering is ours (`src/lib/openapi.ts`,
  `src/components/api/EndpointReference.tsx`). Decision rationale + incumbent model
  verification in chat history; matches the incumbent's `openapi`-nav model.
- ⏳ **Next:** interactive "Try it" panel (request execution, auth, proxy), per-operation
  MDX stubs (`openapi: METHOD /path` frontmatter), multi-language code samples
  (`x-codeSamples`), AsyncAPI.

**M5 — AI Assistant** (full design in §8)
Agentic retrieval (Claude + tool calling over `search_docs`/`read_page`/`list_pages`/
`search_api`) via the Vercel AI SDK; slide-out "Ask Assistant" panel built on AI Elements
with streamed answers + citations; `Cmd-I` / navbar button / `?assistant=` deep link;
current-page context; unanswered-question analytics. Embeddings (`pgvector`) are an
optional later upgrade to the `search_docs` tool, not a v1 blocker.

**M6 — Dashboard + Domains + Analytics**
Org/auth/RBAC, custom domains + TLS, analytics views. Beta-ready.

(Order is roughly dependency-driven; M3–M5 can parallelize after M2.)

---

## 16. Open Questions

1. **Compile-on-sync vs. on-request.** Spec assumes compile-on-sync for perf/predictability. Does that block any dynamic features we care about (e.g. live Twoslash)?
2. ~~**Build on Fumadocs vs. from scratch.**~~ **DECIDED (2026-06-07): from scratch.** Multi-tenancy and full control over the architecture outweigh the head start. M0 is a single Next.js app; refactor into the monorepo packages at M2 when multi-tenancy lands.
3. **Versioning & i18n.** docs.json supports versions + languages in the nav tree. In v1 scope or fast-follow?
4. **Self-host story.** How easy must the OSS self-host path be vs. the hosted SaaS? Affects how much we hardwire to R2/Vercel/etc. **Partially resolved (2026-06-07):** chose Better Auth specifically so platform auth self-hosts with no third-party account (§11.1); object storage / domain plumbing still open.
5. **License & governance.** MIT vs. Apache-2.0; CLA; what (if anything) is SaaS-only (open-core) vs. fully open.
6. **Pricing/limits** for the hosted version (out of scope for build, but shapes tenancy/metering design).
7. **Web editor** — defer past v1? The incumbent treats it as a differentiator.

---

## 17. Non-Goals (v1)

- Visual/WYSIWYG web editor (fast-follow)
- Migrating from non-hosted docs sources (Docusaurus/GitBook importers)
- Embeddable AI on third-party sites
- Marketplace / plugin ecosystem
- On-prem enterprise deploys
