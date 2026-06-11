# Papervine — Open-Source Docs Platform

**Status:** Draft v0.1
**Date:** 2026-06-07
**Owner:** jeff@loiselles.com

An open-source, multi-tenant documentation platform — a faithful clone of [the incumbent](https://example.com/). Users connect a Git repo containing MDX files + a `docs.json` config; Papervine renders a fast, beautiful, searchable docs site with an interactive API playground and an AI assistant. One deployment serves many tenants.

---

## 1. Vision & Principles

- **Docs-as-code.** Source of truth is MDX + `docs.json` in the user's Git repo. The platform is a renderer + control plane, never the source of truth.
- **Multi-tenant from day one.** A single app instance serves all customer doc sites, addressable by subdomain (`acme.papervine.io`) and custom domain (`docs.acme.com`).
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

**Platform theme.** Every Control-Plane surface (landing, auth, dashboard) shares one
dark, luminous design language — palette + Geist + atmosphere — codified in
`src/styles/platform.css` (scoped under `.db`) and applied via
`<PlatformShell variant="full" | "lite">` (`src/components/platform/`). `full` = glow +
grid + grain (marketing/auth); `lite` = glow only (the data-dense app, so the grid/grain
never sit behind tables). Brand accent is the blue→violet gradient; status colors
(green = live/success, red = failed) stay semantic. Pages compose the shared `Button`
and `Field` primitives — they don't redefine the look. This theme is deliberately
**separate from the docs renderer**, which is light-first and themed per tenant from
`docs.json` (`src/lib/theme.ts`, `globals.css`); the two must never leak into each other.

**Apex nav is session-aware.** The marketing landing (`src/app/home/page.tsx`) reads the
session: a signed-in visitor gets a single **Dashboard** link instead of **Log in / Sign
up** (which would dead-end them re-signing up). Reading the session opts the page into
dynamic rendering — acceptable for the apex. Smoke covers the logged-out shape (`/home`).

**UI primitives: shadcn/ui, mapped onto `.db` tokens.** The Control-Plane uses
[shadcn/ui](https://ui.shadcn.com) for its component primitives (`src/components/ui/`,
`cn()` in `src/lib/utils.ts`, `components.json`) — the same choice
[the incumbent made for their dashboard](https://app.example.com) (verified: `data-slot="button"`
+ the shadcn token constellation + Radix primitives in their shipped HTML/CSS). We follow
their pattern: keep the shadcn **skeleton** (cva variants, `data-slot`, Radix), but point
the variants at our `.db` palette rather than stock shadcn vars — so `Button`'s `primary`
is the brand CTA, not `bg-primary` (which stays bound to the tenant docs theme). The
neutral tokens (`border`/`ring`/`muted`/`accent`) are mapped to the `.db` CSS vars in
`tailwind.config.ts` and only resolve inside the `.db` scope, so they can't leak into the
docs renderer. A `<EnvBadge>` (top-right, non-prod only — `local`/`preview`, hidden when
`VERCEL_ENV=production`) is the first such primitive, mounted globally in the root layout.

### Tenant resolution
Next.js **middleware** (`src/middleware.ts`) inspects the `Host` header and rewrites
internally to `/sites/[tenant]/[...slug]`:
- `*.papervine.io` subdomain → tenant by **slug** (`resolveTenantSlug`, `src/lib/tenant-host.ts`) — **shipped**.
- custom domain (`docs.acme.com`) → tenant by **host** (`site.customDomain`, unique) — **shipped**. Owners connect/remove a domain and pick root vs `/docs` hosting at Settings → Domain setup (`customDomainSubpath`); connecting attaches the host to the Vercel project so its per-host cert issues (`vercel-domains.ts`, env-gated — see §2 → Custom domains), and a live check (`GET {domain}/api/site-identity`) flips the badge to Connected and stamps `customDomainVerifiedAt`.
- apex / `www` / reserved labels → the platform landing + control plane, never a tenant.

Keep the DB **out of edge middleware**: middleware classifies by suffix only (`isPlatformHost`).
A host that's neither apex nor `*.papervine.io` nor a preview/dev host is a custom-domain
candidate — middleware forwards the raw Host (`x-papervine-host`) and rewrites docs to the
dedicated `/custom-domain/[[...path]]` route (assets → `/api/tenant-asset-by-host`), *not* to
`/sites`, since the slug isn't known at the edge. That RSC route (Node runtime, has DB)
resolves the site via `getSiteByCustomDomain(host)` and `notFound()`s if unmatched; both
serving paths share `renderTenantDocs()` so they can't drift. In `/docs` mode the route owns
only the `/docs/*` subtree (404s elsewhere, so the owner keeps their apex). Promote to a
cached host→slug map (Edge Config / Redis, §12) only if edge resolution is later needed.

**Interim path-based serving (no wildcard domain).** Subdomain serving needs a wildcard
domain you own + wildcard TLS. A bare Vercel deploy (`*.vercel.app`) can't get either —
Vercel won't issue TLS for nested `acme.proj.vercel.app` subdomains, so the host route is
unreachable there. As a fallback, the same tenant docs are reachable by **path** on the
platform apex: `apex/sites/{slug}/…` (`src/app/sites/[site]`). The route detects the mode
(`resolveTenantSlug(host)` → null on the apex) and threads a tenant **base** through nav,
MDX links/images, and the navbar so root-absolute URLs (`/quickstart`, `/img/x.png`) are
prefixed (`withBase`, `src/lib/url-base.ts`) instead of escaping to the apex. Base is empty
in host mode → output is byte-identical. This is **additive**: when a real domain is added,
subdomain serving lights up through the unchanged resolver; the only follow-up is an optional
canonical redirect from the path form. The path form also stays useful as the no-custom-domain
/ self-host story (§13 portability). Search/assistant remain host-resolved (analytics only)
and are unchanged by this.

**Per-request content source — resolve it before the root layout reads, not just in the
page (fixed 2026-06-09).** A **memoization ordering bug**, not anything cross-request:
`contentContext` is request-scoped (`AsyncLocalStorage`) and `loadConfig`/`loadPage` are
memoized per-request with React `cache()`. The catch is that `loadConfig`'s cache key omits
the active source — it takes no args, so the first call's result is reused for the whole
render regardless of which `contentContext` source is in scope. The tenant page sets the
source via `contentContext.run(src, …)` around its own subtree, but the **root layout
renders first** and calls `loadConfig()` outside any context → the default `content/`
source fills the memo. The tenant page's later `loadConfig()` then gets that cached
*default* config (so the sidebar was built from `content/docs.json`) while `loadPage` ran
in-context and read the tenant's real content — so every page that existed only in
`content/` (e.g. the starter's `guides/markdown`) rendered as a phantom sidebar link that
404'd. Fix: a single `requestContentSource()` (`src/lib/request-source.ts`) resolves the
tenant source from the `x-papervine-site` header (stamped by middleware for both subdomain
rewrites and apex path-mode) or the host; the **root layout and the page both** read config
inside `contentContext.run(src)`, so the one memoized `loadConfig` is computed under the
correct source and config + pages stay on the same source. (The alternative — key the cache
on a source id, `loadConfig(sourceId)` — would thread an id through every call site; the
in-context read matches the existing `contentContext` design.) Regression guard:
`tests/e2e/tenant-render.spec.ts` (seeds a tenant in Postgres+MinIO, asserts the sidebar is
the tenant's, not the platform's).

**Same trap on the API routes — `/api/search` and `/api/assistant` (fixed 2026-06-09).**
Middleware deliberately does **not** rewrite `/api/*` (line ~38), so those handlers never
ran inside `contentContext` and their `runSearch`/`loadConfig`/tool calls fell back to the
default `content/` source — the tenant's Cmd-K and the AI assistant answered about *our*
docs (e.g. "Papervine documentation does not cover hidden pages" while reading
large-docs). Both routes now resolve the source via `requestContentSource(site)` and run
their whole body inside `contentContext.run(src, …)` — for the assistant this also scopes
the *streaming* tool executions, which inherit the AsyncLocalStorage store from the
`streamText()` call site. In subdomain mode the source resolves from the Host header; in
apex **path mode** the request hits the apex host with no tenant in the Host header, so the
client (`SearchDialog`, `Assistant`) passes the active slug explicitly (`?site=` / body
`site`), threaded from the tenant page → `Navbar`/`Assistant`. Separately, `buildIndex`
(`src/lib/search.ts`) now enumerates pages from the **nav** as well as `listPageSlugs()`,
so a source that can't cheaply enumerate every key still gets its nav pages indexed —
without it, search would index nothing for such a source. Regression guards:
`tests/unit/search-nav-fallback.test.ts` (nav fallback) and a search-scoping case in
`tests/e2e/tenant-render.spec.ts`.

### Custom domains (BYO `docs.acme.com`)

Two **independent** domain systems — don't conflate them:

1. **`*.papervine.io` (our domain).** One wildcard TLS cert, auto-issued by the host
   platform because **we control the DNS**. Setup (done 2026-06-09): point `papervine.io`
   nameservers at Vercel (`ns1/ns2.vercel-dns.com`) so Vercel can DNS-01 the wildcard cert;
   add `*.papervine.io` as a project domain. *Caveat that bit us:* a wildcard CNAME at the
   registrar is **not** enough — without Vercel-controlled DNS the wildcard cert never
   issues, every subdomain fails the TLS handshake (looks like a DNS bug, is actually a
   cert bug). Moving nameservers requires re-creating non-platform records in Vercel DNS —
   notably Namecheap email-forwarding **MX + SPF** — or inbound mail breaks.

2. **`docs.acme.com` (customer's domain).** Lives under the **customer's** nameservers,
   which we never control, so the wildcard trick can't apply — each custom domain needs its
   **own** cert. Customer adds a `CNAME docs.acme.com → {branded target}` (apex → `A`,
   can't CNAME); we attach the domain to the project; the platform issues a per-host cert via
   HTTP-01 (no nameserver change from the customer); we poll until verified; our middleware
   maps host → site. **Why a branded target, not `cname.vercel-dns.com` directly:** the branded
   host is a record in *our* zone (hosted: `cname.papervine.io → cname.vercel-dns.com`; Vercel
   chases the chain to its edge, so the cert still issues). It's the indirection seam for the
   Phase 2 cap escape below — the customer-facing contract stays constant, and we re-point one
   record on our side at migration instead of asking 50+ customers to edit their DNS. Pointing
   straight at `cname.vercel-dns.com` would bake Vercel into every customer zone and make the
   Phase 2 cutover a per-customer fire drill. The target is **operator-configurable**
   (`CUSTOM_DOMAIN_CNAME_TARGET` — hosted sets `cname.papervine.io`; a self-hoster sets their
   own host; unset falls back to the raw Vercel edge, then the apex), so the OSS code hardcodes
   no operator domain. (Apex `A`-record customers can't CNAME, so they fall outside this seam
   and would re-point at migration.) **Verified (2026-06-10):** Vercel
   cold-issues the per-host Let's Encrypt cert through the chain — a fresh test host
   (`docs.bugnjeff.com → cname.papervine.io → cname.vercel-dns.com`), having *only ever*
   pointed through the branded record, got a valid `CN=docs.bugnjeff.com` cert and routed to
   the right tenant (`/api/site-identity` → `{"site":"starter"}`). So the chain is sound for
   HTTP-01; the undocumented-by-Vercel concern (would it literal-match the immediate CNAME?)
   is empirically a non-issue.

**The cap, and the escape (decided 2026-06-09).** Attaching each customer domain to the
Vercel project hits Vercel's per-project domain cap (~50 on Pro) → an Enterprise upsell.
We **don't** get trapped, because our tenant resolution already keys off the host header, so
the platform never needs to know individual customer domains:

- **Phase 1 (first customers) — built:** use Vercel's domains **API** to attach/verify/remove
  each custom domain. Free up to the cap, zero extra infra. All four pieces exist:
  `getSiteByCustomDomain`, the middleware third branch, the **Vercel-domains client**
  (`src/lib/vercel-domains.ts` — `addProjectDomain`/`removeProjectDomain`/`getDomainStatus`),
  and the dashboard add/verify UI (`settings/domain`). Connecting a domain attaches it to the
  project (so the per-host cert issues — DNS alone never completes the TLS handshake);
  removing or re-pointing it detaches the old host (frees the project-domain slot). The client
  is **env-gated** on `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`(/`VERCEL_TEAM_ID`): unset locally/CI,
  where it's a no-op and the form degrades to the DNS-only live check (`/api/site-identity`).
  "Connected" stays gated on that end-to-end live check (strictly stronger than Vercel's
  `verified` flag — it can only pass once the cert issued *and* our middleware maps the host to
  the right slug); Vercel's `verification` records surface in the form only when the host's apex
  is already in use elsewhere and an ownership challenge is required. Customer CNAMEs to
  the operator's branded target (`CUSTOM_DOMAIN_CNAME_TARGET`, `cname.papervine.io` on hosted)
  when set, the raw Vercel edge if unset-but-Vercel-managed, the apex otherwise (the self-host
  path form). Pure `parseDomainStatus`, env-gating, and CNAME-target precedence unit-tested
  (`tests/unit/vercel-domains.test.ts`).
- **Phase 2 (trigger: ~40–50 custom domains):** front custom-domain traffic with a
  purpose-built SaaS-domains proxy that issues a cert per hostname and forwards to **one**
  origin we already serve (e.g. `origin.papervine.io`, under our wildcard), passing the real
  host in **`X-Forwarded-Host`**. Vercel then sees a single domain → cap is moot. Candidates:
  **Approximated** (drop-in, purpose-built, API), **Cloudflare for SaaS / Custom Hostnames**
  (cheapest at scale, more config), or self-hosted **Caddy on-demand-TLS** (cheapest, we
  operate it). Because customers CNAME at the **branded `cname.papervine.io`** (Phase 1
  above), the cutover is **zero customer DNS change** for the CNAME majority: we re-point that
  one record in our zone at the proxy. Migration is then front-door-only on *our* side —
  re-point + read `X-Forwarded-Host` (trusted-proxy gated) in `resolveTenantSlug`; the renderer
  doesn't move. (Provider-dependent: the proxy may want a one-time ownership/TXT step, and apex
  `A`-record customers still re-point.) Build the proxy only when the cap is in sight, not
  before.

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

- **Today (local / single-tenant):** streamed straight from `PAPERVINE_CONTENT`. Works in
  `papervine dev`; a production `next build` would need the content traced in (a dev-time
  concern only, not the SaaS path).

**Three serving models** (increasing maturity; the `/img/...` URL shape never changes):

| | Stored in | Served by | Used when |
|---|---|---|---|
| **A. Redirect to source** | the Git host | GitHub raw CDN | now — public repos |
| **B. Authenticated proxy** | the Git host | our server (live fetch + stream) | GitHub App / private repos |
| **C. Compile-on-sync → object storage** | **our object storage** | **our CDN** | the production target (§3) |

- **A (public, now):** `/dbasset` (or a redirect) resolves the tenant's repo and points the
  browser at `raw.githubusercontent.com/{owner}/{repo}/{branch}/…`. Zero infra, GitHub's CDN
  serves. Public repos only.
- **B (private):** you **cannot** redirect to a private raw URL — it needs an `Authorization`
  header, and exposing the install token to the browser is a leak. So private assets must be
  **proxied**: our server fetches from GitHub with the installation token (server-side) and
  streams the bytes back. Coupled to the GitHub App work, not a separate task.
- **C (target):** the sync worker (§3) copies content **and** assets into our object storage;
  the render plane serves from our CDN. GitHub becomes a sync-time input, not a per-request
  serving dependency — removes rate limits, latency, and the per-request token dance.

> **Current reality (slice):** multi-tenant rendering also live-fetches *content* from
> `raw.githubusercontent.com` — i.e. model **A applied to content**. A deliberate shortcut to
> prove multi-tenancy fast.

**Decision (2026-06-08): go straight to C; don't invest in A/B.** Models A and B are
described for context, but polishing them (e.g. a public-asset redirect) is throwaway work
once C lands. We build C next. C ships in two steps so it's incremental, not a big bang:

- **C-lite (landed 2026-06-09):** sync *copies* docs.json + MDX + assets from the repo into
  object storage; the render plane reads **only** from storage (`s3Source` behind the existing
  `ContentSource` abstraction) and **compiles MDX on request** (reuse today's pipeline). This
  removes GitHub-at-request-time entirely, fixes assets (root-absolute logo/image paths now
  resolve through `/api/tenant-asset/{slug}/…` against the synced bucket), and works for
  private repos (the worker holds the token). Public repos need no GitHub App; private add it.
- **C-full (in progress):** also **precompile** MDX → bundles at sync time so the render plane
  only executes (the §3 perf goal, still deferred), plus push webhooks for auto-sync.
  **Push auto-sync landed 2026-06-11** (below); precompile-on-sync remains the open piece.

**Push auto-sync (landed 2026-06-11).** A registered **GitHub App** delivers `push` events
to `POST /api/github/webhook` (on the **apex** host — middleware passes `/api/` through
ungated there; the app host would redirect GitHub's unauthed POST to `/login`). The route
(`src/app/api/github/webhook/route.ts`) verifies the `X-Hub-Signature-256` HMAC over the raw
body (`src/lib/github-webhook.ts`, all pure + unit-tested), maps the push to the site(s) on
that repo+branch, and runs the sync in `after()` so GitHub gets a fast `202`. Sync itself is
the shared **`runSync`** (`src/lib/sync-runner.ts`) — the session-less core also behind the
connect flow and the manual Re-sync button; the webhook's authorization is the signature, not
a session. Idempotent across redeliveries via `site.lastSyncedCommitSha` (skip a head we've
already synced). The App also replaces the pasted PAT for private repos: an installation
(stored in the `github_installation` table, tied to the org by the `/api/github/setup`
callback) mints a short-lived **installation token** (`src/lib/github-app.ts`, RS256 JWT via
`node:crypto` — no new deps) that flows through the same `ghHeaders(token?)` seam as the PAT,
so neither `sync.ts` nor the render path changed. All four env vars are optional: with no App
configured the webhook 401s every (unsignable) delivery and the connect form falls back to the
PAT field — public repos and self-host stay zero-config. See `.env.example` for registration.

**Private repos — PAT first, GitHub App next (landed 2026-06-10).** The connect flow now
accepts an optional **fine-grained PAT** (Contents: read) for a private repo. The token is
encrypted at rest (AES-256-GCM, `src/lib/crypto.ts`, key in `PAPERVINE_ENCRYPTION_KEY`) on the
`site` row (`repo_token_enc`, plus an `is_private` flag) and decrypted only server-side at sync.
The real renderer-path change is in `src/lib/sync.ts`: private repos **can't** use the
`raw.githubusercontent.com` CDN (no `Authorization`), so each file is pulled through the
authenticated **git blobs API** by sha (`Accept: application/vnd.github.raw`) with a correct
content-type inferred per extension; public repos keep the raw CDN. The token flows through one
seam — `ghHeaders(token?)` in `src/lib/github.ts` — so the **GitHub App** is a drop-in follow-up:
the install flow mints an installation token that takes the same parameter, no sync/render
changes. (App also unlocks push-webhook auto-sync, the C-full piece.)

The request-time GitHub fallback (`githubSource`) is **removed** — `requestContentSource`
serves a site only once it's synced (`isSynced` → `s3Source`), else 404; an unsynced site has
nothing to show rather than reaching back to the repo live. GitHub is touched only at *sync
time* (`src/lib/sync.ts`, via `raw.githubusercontent.com`). The dev seed (`scripts/seed-dev.mjs`)
syncs its sites into object storage too, so local docs render exactly like production.

**Asset serving within C — proxy now, direct-from-R2 later.** Model C as built
*proxies* asset bytes: `src/middleware.ts` rewrites `{slug}.papervine.io/img/x.png` →
`/api/tenant-asset/{slug}/…`, whose handler reads the object from R2 **server-side**
(S3 token, private bucket) and streams it back. The response carries
`cache-control: public, max-age=300`, so the host CDN (Vercel) edge-caches it — we
already get most of the CDN win, and the bucket stays **private with no CORS**.

- **Why this works on custom domains:** the page's hostname and the asset's hostname
  are independent. Today both are our app's origin (same-origin `/img/…`), so it works
  transparently whether the docs are on `{slug}.papervine.io` or a tenant's own
  `docs.acme.com` — no CORS ever.
- **Scale-up (deferred, 2026-06-09):** when Vercel function invocations / egress on
  assets show up as cost, serve assets **directly from R2** via a dedicated asset host
  — `assets.papervine.io`, a *Cloudflare custom domain bound to the bucket* (DNS →
  Cloudflare/R2, **not** Vercel). Rewrite asset URLs at render/sync time from `/img/…`
  to `https://assets.papervine.io/sites/{id}/…`. One shared asset host serves every
  tenant on any page domain. This is the only reason we'd touch **public access** (or
  presigned URLs) and **CORS**: cross-origin `<img>`/video needs neither, but **fonts**
  (and `fetch()`/`crossorigin` loads) require a CORS rule allowing `https://*.papervine.io`
  + tenant custom domains. Not worth it at launch given the proxy already CDN-caches.

---

## 4. Config: `docs.json` (docs.json-compatible)

Single config file at repo root. Mirror the incumbent's schema so migration is trivial. Core shape:

```jsonc
{
  "$schema": "https://papervine.io/schema.json",
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
- **CORS/proxy:** requests can route through a Papervine proxy endpoint to avoid CORS and to inject secrets safely (optional per tenant).
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

### 8.6 Control-plane page: Assistant settings

The dashboard page where a docs owner manages the assistant (the incumbent: **Automate →
Assistant**). Top of page shows three **overview cards** — *Total questions*, *Answered
properly*, *Not answered* — each with a month-over-month delta, plus a "Get insights into
your Assistant usage → View more" card linking to the **Analytics** page (§10.1).

Settings, grouped as the incumbent groups them:

- **Status & control** — an *Assistant Status* enable/disable toggle (Active/Inactive
  badge). This is an **operational kill switch** (DB state, not `docs.json`) so it takes
  effect instantly without a Git commit.
- **Response handling — Deflection** — when the assistant can't answer, point the user at
  a **support email** (input) and optionally render a **"Contact support" help button** in
  the in-docs widget ("Show help button on AI chat"). Drives the §8.1 low-confidence
  guardrail. *Save Changes* per group.
- **Search domains** — enable + manage a list of **extra domains** to include as retrieval
  context beyond the tenant's own docs (e.g. a marketing site). Add/remove with validation.
- **Bot protection** — an **invisible CAPTCHA** (hCaptcha) toggle on the public
  `/api/assistant` endpoint to limit automated abuse and runaway token cost.
- **Starter questions** — up to **3** suggested questions shown in the in-docs chat empty
  state (renders via AI Elements `Suggestions`, §8.2). Toggle + editable list ("0/3").
- **Plan / credits** — trial banner (free-credit % remaining, expiry date, *Upgrade plan*);
  per-tenant **credit metering + rate limits** (§8.1). Some controls are **plan-gated**
  (the incumbent shows "available for enterprise plans / Contact Sales"); gating is config, not
  hardcoded, so self-hosters get everything.

**Where each setting lives.** Published-behavior config (starter questions, deflection
email + help button, search domains) is **version-controlled in `docs.json`'s `assistant`
block** — the dashboard edits it through the authoring layer (§9.2) so it stays in Git.
Operational/metering state (enable toggle, CAPTCHA, credits, plan) lives in our **DB** for
instant effect. Self-host reads it all from `docs.json` + env, no dashboard required.

---

## 9. MCP Servers

Papervine exposes Model Context Protocol servers so AI tools can both **read** a docs site
and **edit** it — mirroring the incumbent, which ships two distinct MCP servers.

### 9.1 Generated read MCP (per docs site)

Auto-generated for every published site (no authoring needed), for the docs *readers'* AI
tools (Claude, Cursor, Windsurf). Exposes the **same tool layer as the AI Assistant (§8.1)**
— `search_docs`, `read_page`, `list_pages`, `search_api` — over Streamable HTTP at e.g.
`https://{tenant}/mcp`. One implementation, two transports (in-docs chat + MCP).

- Indexes published pages + OpenAPI specs; excludes hidden/noindex (per §8.4).
- Opt-in + configured via `docs.json`; per-tenant rate limits.
- ✅ **Slice 1 (done):** Streamable HTTP MCP server at `/mcp` (`src/app/mcp/route.ts`, via
  `mcp-handler`, stateless). Exposes `search_docs`, `read_page`, `list_pages`, and —
  only when the site has an OpenAPI reference — `search_api`. Tools are the shared
  `docs-tools.ts` capabilities (one implementation, two transports). Covered by
  `tests/smoke.mjs` (tools/list + tools/call). Connect Claude/Cursor to `https://<host>/mcp`.
- ✅ **Slice 2 (done, 2026-06-09):** tenant-routed + instrumented. Middleware lets `/mcp`
  serve on the tenant host (resolves the right content source per connection), and each
  connection logs agent analytics — `search_docs` → an MCP-search event, `read_page` → an
  agent page view (`source:"agent"`, named via UA, §10.1). This unblocks the Agents tab.
- ✅ **llms.txt (done, 2026-06-09):** `/llms.txt` + `/llms-full.txt` (`src/app/llms.txt/`,
  shared `src/lib/llms.ts`) — the llmstxt.org index of every page (full variant inlines page
  bodies), generated from the in-scope content source. Logged as agent traffic. Smoke-covered.
- ⏳ **Next:** `docs.json` opt-out + per-tenant rate limits; live API execution as MCP tools
  (depends on the M4 "Try it" auth/proxy slice); index built at sync (M2).

### 9.2 Authoring MCP (admin / write)

Lets a docs *owner* connect an AI tool to **edit their docs** (matches the incumbent's Admin
MCP). All edits happen on a session branch and land via a Pull Request — never directly on
the deploy branch. Tools:

- **Content:** `read`, `write_page` (full MDX), `edit_page` (targeted), `search`
- **Structure:** `create_node` / `move_node` / `update_node` / `delete_node` / `list_nodes`
  — pages, groups, tabs, anchors, versions — operating on our recursive `navigation` (§4)
- **Config:** `update_config` (edit `docs.json`)
- **Git:** `checkout` (**must be the first call** — opens a `papervine-mcp/<slug>-<sha>`
  branch off the deploy branch, or attaches to a named existing branch; returns an
  `editorUrl`, see below), `diff`, `save` (`mode: "pr" | "commit"`), `discard_session`
- **Auth:** a platform-auth (Layer 1, §11) token scoped to the org/repo; RBAC ≥ editor.
- This is the agent-native counterpart to the web editor (§10) and embodies AGENTS.md's
  "any action a user can take, an agent can too."

**One backend, two front-ends (verified against the incumbent, 2026-06-09).** The authoring MCP
and the web editor (§10) are *not* separate write paths — they operate on the **same session
branch and the same server-side draft buffer**. In the incumbent, `checkout`'s response includes
an `editorUrl` you open to "follow along" in the dashboard editor on that same branch; edits
"buffer on the session branch in real time," persisted server-side across tabs/devices, and
only reach the deploy branch on `save`/publish (direct commit if on the deploy branch, else a
PR with a returned link). **Build implication:** build the authoring layer (GitHub-App write
creds → session-branch + draft buffer → `save` as commit-or-PR) **once**, then put both the
MCP and the web editor on top of it. The draft buffer is real persistent state, not a
commit-on-save shortcut. *(Mechanics confirmed from the incumbent's [Admin MCP](https://example.com/docs/ai/incumbent-mcp)
+ [editor branching/publishing](https://example.com/docs/editor/branching-and-publishing)
docs; the "any action a user can take, an agent can too" framing is **ours** (AGENTS.md), but
it matches their actual architecture.)*

### Status & sequencing

The **read MCP is shipped** (§9.1 Slice 1) — it was a thin wrapper over the assistant tool
layer. The **authoring MCP is still post-M5**: it follows the Git-sync (§3) + platform-auth
(§11) foundations.

---

## 10. Dashboard / Control Plane (supporting v1)

Minimum to operate the SaaS:
- **Auth:** org + user accounts via **Better Auth** (see §11). RBAC: owner/admin/editor/viewer.
- **Workspace / site switcher:** an org may own several sites (§2), so the dashboard's
  **top-left switcher** selects the **active site** that per-site pages (Analytics, Editor,
  Settings) scope to — mirrors the incumbent's top-left switcher. Lists the sites the user can
  access + a **New site** action. *(Status 2026-06-10: the control plane is now
  **URL-scoped on its own host**, mirroring the incumbent's `app.example.com/{org}/{site}`.
  The active site is the URL (`app.papervine.io/:org/:site`, `app.localhost:3000` in dev),
  not a cookie — switching sites navigates (`SiteSwitcher` → `switchSiteHref`, preserving
  the sub-page), so URLs are shareable/bookmarkable and multi-tab works. **Why the app
  host:** this is one Next app with one route tree across every host, so a bare `[org]`
  segment at the apex root would shadow the docs catch-all (`(docs)/[[...slug]]`) — every
  `/guide`-style docs path would resolve to the dashboard. Keeping the control plane on
  `app.` frees the apex/tenant namespace for docs (and for our own dogfooded docs at
  `www/...`). The route files live at an **invisible `/app` mount**; `middleware.ts`
  Host-rewrites `app.*` bare `/:org/:site` → `/app/:org/:site` (the same trick tenant
  subdomains use → `/sites/{slug}`), and bounces auth + stray `/app` hits on the apex over
  to the app host so the session cookie is set there. `requireOrg`/`requireSite`
  (`dashboard-context.ts`) resolve + authorize org/site from the path; pure path helpers
  live in `dashboard-nav.ts` (public **bare** for links/redirects, internal **`/app`** for
  `revalidatePath` — mixing them is a bug). Cross-context redirects (connect, login) use a
  client hard-nav, since a soft RSC nav skips the Host rewrite (the documented
  tenant-URL gotcha). Tests: `tests/unit/dashboard-nav.test.ts`,
  `tests/e2e/site-switcher.spec.ts`; smoke exercises the app-host edge gate via a
  `Host: app.localhost` header.)*
  *(Status 2026-06-11: marketing/app session bridge. The session cookie stays host-only on
  the app host — sharing it on `.papervine.io` would send the auth token to every tenant docs
  subdomain (an XSS-exfil surface), so it never leaves `app.`. Instead: (1) a logged-in user
  who hits `/login`/`/signup` on the app host is bounced to their dashboard (mirrors
  `app.example.com/signup`), and (2) the marketing apex shows a **Dashboard →** link via a
  *benign* `pv_signed_in=1` flag cookie (`src/lib/signed-in-flag.ts`) set on the parent domain
  by the app-host middleware, read by the marketing nav — a boolean, never the session token.
  Being a parent-domain cookie it *does* reach tenant subdomains, so it's **`httpOnly`** (+
  `Secure` in prod) — tenant page JS can never read it; only our servers see it — and it's
  cleared **server-side in the middleware** on logout (a client clear can't touch an httpOnly
  cookie). The host split also means `www` is **always** the marketing site (never a
  Vercel-style forced redirect to the app). **Dev caveat:** Chrome rejects `Domain=localhost`
  cookies, so the `www` Dashboard link only appears in prod (`.papervine.io`); the
  redirect-to-dashboard works everywhere.)*
- **Overview (home):** the per-site landing page — greeting, live preview, status/identity,
  quick actions, and the deployment **Activity** feed. Expanded in **§10.3**.
- **Projects:** connect Git repo, pick branch, manual sync, view sync logs/errors.
  *(Status 2026-06-08: failed syncs now persist their error+stack on the `deployment`
  row and the dashboard Activity feed surfaces it under a "Why it failed" disclosure —
  previously the reason was `console.error`'d only, lost to serverless logs the tenant
  can't reach. Operator-facing error tracking (Sentry) is a fast-follow: it complements,
  not replaces, the persisted per-deployment error, which is what the tenant sees.)*
- **Domains:** assign `*.papervine.io` subdomain (shipped); add custom domain — show the CNAME to set, attach via the host-platform domains API, poll until verified + TLS issued (**built** — `settings/domain` + `vercel-domains.ts`; see **§2 → Custom domains, Phase 1**). Architecture, the per-project domain cap, and the proxy escape hatch are in **§2 → Custom domains**.
- **Assistant:** the AI assistant management page (enable/disable, deflection, search domains, bot protection, starter questions, credits) — specified in **§8.6**; its usage analytics live on the Analytics page (§10.1).
- **MCP:** manage the per-docs read MCP and authoring MCP (enable, opt-in, tokens) — see **§9**.
- **Analytics:** page views, top pages, search terms with no results, AI unanswered questions, plus the assistant deep-dive — expanded in **§10.1**. PostHog or a lightweight first-party events table.
- **Billing (later):** Stripe; usage tiers (seats, AI tokens, page views).
- **Web editor / live preview (later):** the incumbent has one; defer past v1. It is **the same
  capability as the authoring MCP (§9.2), not a parallel one** — both write to one shared
  session-branch + server-side draft buffer; the MCP's `checkout` even hands off an
  `editorUrl` into this editor. So the long pole is the **shared authoring backend**
  (GitHub-App write creds → session branch → draft buffer → `save` as commit-or-PR), not the
  editor UI. The incumbent also auto-deploys a **per-branch preview** so reviewers see changes
  before merging the PR — live preview of unsaved drafts needs compile-on-request (§3.1
  "C-full"), still deferred.

### 10.1 Analytics

The control-plane **Analytics** page (the incumbent: *Analytics*) — scoped to the **active site**
(the §10 switcher), with a **Humans vs Agents** toggle (human visitors vs agent/MCP traffic,
§9.1) and a **date-range** picker. The Assistant page (§8.6) links here via its "Get insights
→ View more" card.

> **Status (2026-06-09):** built — first-party `analytics_event` table (incl. an `agent`
> name column) + instrumentation (human page-view beacon, search + assistant logging). The
> **Humans** tab shows metric cards, visitors chart, top-pages + referrals. The **Agents** tab
> is now a distinct layout (built 2026-06-09): **Agent Visitors** + **MCP Searches** cards, an
> Agent-Visitors-Over-Time chart, and **Top pages** + **Top agents** (Claude/ChatGPT/…, keyed
> off the `agent` column). Agent traffic is logged live now that `/mcp` is tenant-routed (§9.1)
> and `/llms.txt` exists: UA detection (`src/lib/ua-detect.ts`) names the agent; `read_page`
> /llms.txt fetches → agent page views, `search_docs` → MCP searches. Scopes to the **active
> site** chosen by the top-left switcher (§10; defaults to the org's first site). The assistant
> deep-dive (usage chart, Claude-clustered categories + content-gap engine, chat history, CSV
> export) is not yet built.
>
> **Agent-visitor identity (fix 2026-06-11).** "Agent Visitors" = `count(distinct sessionId)`
> over agent page-views, the agent analogue of the Humans tab's distinct-visitor metric (which
> keys off a persisted `localStorage` UUID). The MCP server is **stateless** (no Redis), so it
> re-instantiates per tool call — minting a fresh `randomUUID()` sessionId each time counted
> every `read_page` as a *new* visitor (3 reads in one Claude session showed as "3 Agent
> Visitors" — effectively the page-view count wearing the Visitors label). Fixed in
> `src/lib/agent-session.ts`: `sessionId` is now a **stable per-client id** — the client's
> `Mcp-Session-Id` when supplied, else `sha256(agent + UA + IP)` (no time component, so it's
> stable across the window like the human UUID). A client's burst of calls now collapses to one
> visitor; distinct clients stay distinct. Matching the incumbent, the Agents tab keeps just two
> cards (**Agent Visitors** + **MCP Searches**) — no separate agent "Views" card; per-page agent
> volume lives in **Top pages**. Same derivation on the `/llms.txt` agent surface
> (`src/lib/llms-route.ts`). Regression: `tests/unit/agent-session.test.ts` (dedupe/stability)
> + `tests/e2e/analytics.spec.ts` (a 3-call session + a 2nd session → 2 visitors, not 4).

- **Metric cards** (each with a vs-previous delta): **Visitors**, **Views**, **Assistant**
  (queries), **Searches**, **Feedback** (👍/👎).
- **Assistant Usage chart** — daily **Answered vs Unanswered** over the period, with the
  split (e.g. "Answered 5 (100%) · Unanswered 0 (0%)").
- Two tabs over the assistant conversation log, each with **Export to CSV**:
  - **Categories** — questions auto-clustered into labeled categories (e.g. "Understanding
    roles", "File download timing") with an **Occurrence** count + **last-asked** date; rows
    **expand** to the underlying questions. The **content-gap engine**: high-occurrence +
    unanswered = the docs to write next. Clustering/labeling by Claude on a scheduled job.
  - **Chat history** — every conversation as **Query** + timestamp + **Chat length** (turns);
    a row **expands** to the full transcript (question, answer, citations, feedback).
    Browsable and searchable.
- Plus the standard docs analytics: page views, top pages, and search terms with no results.

**Data model.** Every assistant turn logs `{ tenant, ts, question, toolsUsed, retrievedPages,
answer, status: answered | deflected | unanswered, feedback, source: human | agent, sessionId }`.
The Assistant page's overview cards (§8.6), the usage chart, the categories, and "content
gaps" all derive from this. Backed by PostHog or a first-party events table; respect
`noindex`/privacy and per-tenant retention.

### 10.2 Automate — Workflows · Agent · Assistant (speculative)

The **Automate** rail section groups the three surfaces where Papervine *acts on* the
docs instead of just rendering them. All three mirror the incumbent's "Automate" area and are
gated behind a per-org **Trialing** entitlement (the rail/page badge). **Status
(2026-06-10): UI scaffolded, nothing wired.** The pages render the catalog, onboarding,
and empty states (`/dashboard/automate/{workflows,agent,assistant}`); none of the
toggles, prompts, or inputs post anywhere yet. This section is the speculative target the
scaffold is shaped toward — record decisions here as we build, don't treat it as built.

- **Workflows** — a catalog of scheduled/triggered jobs that open content changes as
  PRs. Two built-in families plus custom:
  - *Self-updating content* — `Update from code changes` (watch a source repo; when
    APIs/features change, draft doc updates), `Draft changelog`, `Draft improvements from
    assistant conversations` (feed the §10.1 content-gap engine into PRs), `Draft
    improvements from user feedback`.
  - *Maintenance* — `Translate content` (keep configured locales in sync), `Fix broken
    links`, `Audit SEO metadata`, `Fix grammar & typos`, `Apply style guide`.
  - *Custom* — user-defined `{ trigger, prompt, action }`.
  - Each workflow is `{ enabled, trigger (event | cron), config }`; runs land as
    **commits or PRs through the shared authoring backend (§9.2 / §10 web-editor)** — the
    same session-branch + draft-buffer pipeline, never a parallel write path. A
    `Workflows` vs `Configure` tab split: Configure is the catalog (this scaffold), the
    Workflows tab is the run history/log (not yet designed). Output quality and
    audit-ability of agent-authored PRs is the open risk.
- **Agent** — an interactive agent reachable from chat. **The surface is Slack-centric**
  (matching the incumbent, which built Agent as a Slack app first): you invoke it with
  `@papervine <prompt>` in a channel, and the onboarding's "Send your first message"
  posts a starter prompt to a **Slack channel** you pick. The channel selector is a
  dropdown populated from the connected workspace (`conversations.list`); in the scaffold
  it's a static list defaulting to `#general`. Steady state is a connected Slack app that
  answers questions and opens doc changes on request. Shares the authoring backend with
  Workflows; the distinction is **interactive (Agent) vs scheduled/triggered
  (Workflows)**, same underlying tools.
  - *Why Slack.* The reference product treats Agent as "your docs teammate in Slack" —
    it lives where the team already works rather than as a separate console, and
    threads/channels give it conversational context and an audit trail for the PRs it
    opens. Open question: whether to also offer non-Slack transports (Teams, Discord, a
    web console) or keep Slack the canonical home.
  - *Plumbing.* Needs a Slack OAuth app + per-org install (bot token), the
    `channels:read`/`chat:write` scopes, a channel allowlist, and an events endpoint for
    `app_mention`. None of this is built — the page is UI only.
- **Assistant** — the management page for the **same in-docs AI assistant specified in
  §8 / §8.6**, surfaced under Automate. Not a fourth system; this is the settings surface
  §8.6 calls for. Layout (per the reference): a **usage overview** strip (Total questions
  / Answered properly / Not Answered, each with a vs-last-month delta, plus a "Get
  insights → View more" card linking to the §10.1 Analytics deep-dive), then labeled
  setting rows — **Status and control** (enable/disable), **Response handling**
  (deflection to a support email + "show help button", with **Search Domains** gated
  behind an *enterprise plan* upsell), **Bot protection** (invisible hCaptcha), and
  **Starter questions** (0/3). Keep the overview cross-linked to §10.1, not duplicated.

**Why one section.** Workflows, Agent, and Assistant all run Claude over the tenant's
content with tools, and all three write through the single authoring backend. The long
pole is therefore shared (§9.2): GitHub-App write creds → session branch → draft buffer →
`save` as commit-or-PR. Building that once unblocks all three; until it exists these
remain scaffolds.

### 10.3 Site Overview (home)

The **per-site landing page** — what you see on entering a connected site (the incumbent's
`app.example.com/{org}/{site}`). Scoped to the **active site** (§10 switcher); it's the
default `/dashboard` destination once a site exists. It's a *consolidation* surface — every
panel is a window onto a system specified elsewhere (sync/§3, editor/§10 web-editor,
domains/§2, workflows/§10.2), not new capability. Layout, top to bottom:

- **Greeting** — time-of-day + the user's first name ("Good afternoon, Jeff"). Cosmetic.
- **Live preview** — a thumbnail of the rendered docs site (a real screenshot/iframe of the
  tenant's home page), so the operator sees their live site at a glance.
- **Status & identity panel** — site name, a **Live** status pill (green dot when the last
  deploy succeeded; degraded/failed states reuse the §10 deployment status), **Last updated
  {relative} by {avatar} {name}** (from the latest `deployment`), and quick actions:
  **Sync** (trigger a manual sync — same path as §10 Projects "manual sync") and **Open
  editor** (→ §10 web-editor / §9.2 shared authoring backend). Below: **Domain**
  (`docs.acme.com ↗`, §2 custom domains), the **repo** (`org/repo ↗`), and the **branch**.
- **Workflow upsell banner** — a dismissible CTA ("Keep your site up to date, automatically
  · Set up your first Workflow in minutes" → **Start setup**) linking into **Automate ›
  Workflows (§10.2)**. Shows until the org has configured a workflow.
- **Activity feed** — the deployment/sync history with a **Live / Previews** toggle (live
  deploys vs per-branch preview builds, §10 web-editor). Each row: **actor** (avatar + name,
  or a system actor like *Manual Update* / *Creating your site*), **relative time**,
  **Status** (Successful / failed — failures expand to the persisted "Why it failed"
  reason+stack, the §10 Projects 2026-06-08 note), and a **Changes** summary (commit
  message + file counts: "11 files added, 27 files edited"). Rows expand for detail. This is
  the same `deployment`-backed feed the dashboard already renders; the Overview is its home.

> **Status (2026-06-10):** built — `/dashboard` is now the per-site Overview, scoped to the
> active site (§10 switcher). Greeting + a **live-preview iframe** (scaled render of the
> tenant's home page) + the status/identity panel (Live pill off `site.status`, "Last updated
> {ago} by {avatar} {name}" from the latest live `deployment`, Re-sync + a disabled *Open
> editor*, Domain/Repo/branch), the dismissible **WorkflowUpsellBanner** (localStorage dismiss →
> Automate › Workflows), and the **Activity feed** with a **Live / Previews** toggle (URL
> `?feed=previews` → `deployment.target`), avatars, status pills, and the "Why it failed"
> disclosure. Pure bits (`partOfDay`, `parseFeedTarget`) extracted to `src/lib/overview.ts` and
> unit-tested (`tests/unit/overview.test.ts`); seed now includes `preview`-target deploys.
> Verified in-browser (the control plane is dark-only — `.db` shell — so there's no light
> variant). Not yet wired: *Open editor* (the §10 web-editor is still a "soon" surface), and
> "suppress the banner once a workflow is configured" (Workflows aren't built, §10.2).

---

## 11. Authentication & Access Control

Papervine has **two completely separate auth systems**. They have different users,
different urgency, and different security surfaces. Conflating them is the most common
way to over-build this, so the spec keeps them apart.

| | **Layer 1 — Platform auth** | **Layer 2 — Reader auth** |
|---|---|---|
| Who logs in | Our customers (docs owners + their team) | Our customers' *readers* (their end users) |
| Protects | The Papervine dashboard / control plane | Published docs *pages* (private/internal/gated docs) |
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

**Status (2026-06-10) — config surface + password enforcement shipped.** The dashboard
**Settings → Authentication** page (`settings/authentication/`) configures Layer 2: the
master enable toggle plus the JWT / OAuth 2.0 / Password method picker and per-method
config. It persists to **`site` columns** (`authEnabled`, `authMethod`, `authConfig`
jsonb, `authSecretEnc`), *not* docs.json — the incumbent configures this in the dashboard too,
and we have no Git-write authoring backend (§9.2) yet to round-trip a docs.json
`authentication` block. The one secret per method (JWT signing secret / OAuth client
secret / shared password) is AES-256-GCM-encrypted via `src/lib/crypto.ts`, same as
`repoTokenEnc`; switching methods resets it (a JWT signing secret is meaningless as an
OAuth client secret). Pure validation + types live in `src/lib/reader-auth.ts`.

**Enforcement.** The gate is the **node** chokepoint `renderTenantDocs` (not edge
middleware — the per-site config is a DB read the edge can't do, same constraint as
custom-domain resolution): an `authEnabled` site renders only to a reader holding a valid
docs session for it, else it 307s to the site's `/login` round-tripping the intended path.
The **password** method is wired end-to-end: a `/login` route per serving mode
(`sites/[site]/login`, `custom-domain/login`) → `submitReaderPassword` constant-time-checks
the shared secret → mints an encrypted, site-bound, 7-day session cookie (`pv_docs_session`,
`src/lib/reader-session.ts`) → bounces back (open-redirect-guarded). **Still to build:** the
**JWT** and **OAuth** handshakes (their `/login` shows a "not available yet" notice today);
per-page `public:` / per-group `"public": true` exemptions (currently the gate is
all-or-nothing per site); and gating of **assets + agent surfaces** (`/api/tenant-asset`,
`llms.txt`, `/mcp`) — today only HTML pages are gated, so a private site's images and
agent feeds remain reachable.

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
| CLI | `papervine dev <dir>` (`bin/papervine.mjs`) | preview any MDX + docs.json repo locally — the `docs dev` analogue; `tests/crawl.mjs` reuses it |
| Styling | **Tailwind CSS** + CSS variables | theme tokens from docs.json |
| Search | **Orama** (Algolia optional) | embeddable, multi-tenant |
| DB | **Postgres** (+ `pgvector`) — hosted: **Neon** | tenants, config, embeddings; Neon serverless for the Vercel deploy, provisioned via the Stripe Projects CLI (`stripe projects add neon/postgres`) |
| Cache | **Redis** | domain→tenant map, page cache |
| Object storage | **S3 API** — hosted: **Cloudflare R2**, local: **MinIO** | compiled bundles, assets. Code to the S3 API (pluggable `S3_ENDPOINT`); R2 chosen for **zero egress** (docs serving is read-heavy) + built-in CDN; self-hosters point at any S3-compatible store |
| Queue/workers | **BullMQ** / serverless functions | git sync jobs |
| AI | **Vercel AI SDK** + `@ai-sdk/anthropic` (Claude); **AI Elements** for chat UI | agentic assistant (§8) |
| Auth (platform) | **Better Auth** (+ `organization`) | OSS, self-hostable, orgs + RBAC; WorkOS for enterprise SSO later (§11) |
| Hosting | Vercel (render) + workers elsewhere | mirrors the incumbent's Vercel approach |
| Monorepo | pnpm + Turborepo | shared packages |

**Decision (see `GAP-REPORT.md`): built from scratch, not on Fumadocs** — multi-tenancy and full control over the renderer outweighed the head start. We still borrow OSS building blocks where they earn it (`@mintlify/mdx` for compile, `@scalar/openapi-parser` for OpenAPI). Prior art studied: [Fumadocs](https://github.com/fuma-nama/fumadocs), [unmint](https://github.com/gregce/unmint), [Scalar](https://github.com/scalar/scalar), [Nextra](https://nextra.site/), Docusaurus.

---

## 13. Proposed Monorepo Layout

```
papervine/
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
Three layers; the test lives where the logic does:

- **Unit** (`tests/unit/`, `npm run test:unit`, Vitest): pure logic, no infra —
  `resolveTenantSlug`, `parseRepoInput`, `slugify`, lenient config parsing. Helpers are
  kept pure (extracted out of `"use server"` files) so they're directly testable.
- **Fixtures smoke test** (`tests/smoke.mjs`, `npm test`): boots the real renderer against
  `tests/fixtures/` — a docs repo reproducing every fixed bug (object favicon, `languages`
  nav, `.md`, unknown/member-expression components, malformed frontmatter, snippet imports,
  hidden pages, standalone cards, OpenAPI endpoints, search, assistant route) — and asserts
  each page returns 200 (never 500) with the expected content. **Zero-dep, no Postgres**, so
  it runs in CI everywhere; DB-free control-plane checks (gate redirects, auth pages render
  in the platform theme) live in `CONTROL_PLANE_CHECKS`.
- **E2E** (`tests/e2e/`, `npm run test:e2e`, Playwright): authed control-plane journeys
  against a dedicated `papervine_test` Postgres + MinIO — signup → onboarding → connect repo →
  dashboard, plus the logged-out gate. `globalSetup` creates/migrates/truncates the test DB;
  `auth.setup.ts` logs in once and reuses the session (storageState). Network-dependent specs
  (the GitHub connect flow) are tagged `@external` so CI skips them for determinism.
- **Real-repo crawl** (`tests/crawl.mjs <dir>`): the `papervine dev` analogue used to validate
  against representative docs repos; reports rendered / degraded / 500, non-zero exit on any 500.
- **CI** (`.github/workflows/ci.yml`): `verify` job = typecheck + unit + build + smoke (no
  services); `e2e` job = Playwright against a Postgres service (skipping `@external`).
- **Migrations are GitOps** (versioned, not `push`): schema changes are committed SQL
  (`drizzle/`, via `npm run db:generate`), reviewed like code, and applied by
  `drizzle-kit migrate` — locally (`db:migrate`), in CI's e2e (rebuilds `papervine_test` from
  the same files), and in **prod on deploy** (`vercel.json` runs `migrate` before
  `next build`; each preview migrates its own Neon branch). Pushing a migration *is*
  shipping it; no manual prod step. See `AGENTS.md` → Database migrations.
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
  **per request (memoized)**, not at sync, so it stays fresh in `papervine dev`.
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
4. **Self-host story.** How easy must the OSS self-host path be vs. the hosted SaaS? Affects how much we hardwire to R2/Vercel/etc. **Resolved (2026-06-08):** code to portable interfaces, not vendors — Better Auth owns its schema in Postgres (§11.1), and storage is the **S3 API** (hosted default R2, local MinIO, self-host points `S3_ENDPOINT` anywhere; §3.1). Domain/TLS: **resolved (2026-06-09)** — `*.papervine.io` via host-platform wildcard cert; custom domains via the host-platform domains API, escaping the per-project cap with a SaaS-domains proxy (Approximated / Cloudflare-for-SaaS / Caddy) + `X-Forwarded-Host` when it nears (§2 → Custom domains). Self-host swaps the proxy or uses Caddy on-demand-TLS directly.
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
