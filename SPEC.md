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

> **Status 2026-06-13 — full primitive set + responsive shell.** Grew `src/components/ui/`
> from 3 primitives to the working set the control plane needs — `input`, `label`,
> `textarea`, `select` (native, deliberately not Radix Select: the OS picker is the
> mobile-friendly choice — no viewport-clipping popover), `card`, `table`, `separator`,
> `skeleton`, plus the Radix-backed `sheet`, `dialog`, `alert-dialog`, `dropdown-menu`
> (added `@radix-ui/react-dialog` · `-alert-dialog` · `-dropdown-menu`). All still speak
> `.db`. The shared `platform/{Field,Button,Select}` were re-pointed at these primitives,
> so every auth/app form adopts them with no call-site churn; the Danger-zone confirm
> (§10.5) became a controlled `Dialog` (we own `open` so it survives the pending/error
> states a Radix `AlertDialog.Action` would auto-close through), the site switcher a
> `DropdownMenu`, the analytics panels `Card`s. **Mobile:** the control plane was
> desktop-only (two fixed sidebars, `w-60` AppRail + `w-56` SettingsNav, that crushed
> small screens). Now the shell is `flex-col lg:flex-row` with `min-w-0` content; on mobile
> the AppRail collapses behind a hamburger into a `Sheet` drawer and the SettingsNav becomes
> a horizontal pill strip, both swapping in via `hidden lg:flex` / `lg:hidden`. Page gutters
> are responsive (`px-4 sm:px-6 lg:px-8`). Verified in-browser at 390px and 1440px (light
> work is unaffected: `npm test` + `node tests/crawl.mjs docs` stay 0 × 500).

> **Status 2026-06-13 — platform light/dark.** The control plane is now light/dark-able
> (independent of the per-tenant docs theme). The mechanism that made it cheap: every
> dark-surface overlay in the components was a translucent *white* (`bg-white/[0.06]`…); all
> ~110 were swept to `rgba(var(--ink-rgb), α)`, where `--ink-rgb` is the **overlay channel**
> — `255,255,255` on dark, `0,0,0` on light, *same α*. So dark stays pixel-identical and light
> is its exact mirror; one channel flip re-tones every hover/active/border/card surface, and
> the `.db-*` helper classes (`db-input`/`db-feature`/`db-ring`/`db-glass`) plus `--line`/
> `--card` route through it too. Brand (blue/violet) and semantics (danger/amber) are
> theme-constant. Theme is set by `data-db-theme` on `<html>` (so it reaches the `.db-portal`
> overlays at `<body>` too), written **pre-paint** from `localStorage['pv-theme']`
> (`light`|`dark`|`system`, default dark — no flash, mirrors the docs theme script), with a
> `<ThemeToggle>` (sun/moon) in the AppRail footer. The art-directed marketing mockups
> (the dark "code window" panels) stay hardcoded-dark by intent — a dark editor screenshot
> reads correctly on a light page. Verified both themes in-browser across dashboard / settings
> / analytics / the portalled delete dialog. **Next (Tier 2 idea):** per-org *brand* accent
> on top of light/dark — now trivial, since the accent is already a token (`--blue`/`--violet`).
>
> **Fix (2026-06-15) — Tailwind `dark:` now follows the platform theme inside `.db`.** The
> platform toggles `data-db-theme`, but Tailwind's `dark:` variant was `darkMode: "class"`,
> keyed only on the `.dark` class (the *per-tenant docs* appearance, written from a different
> key, `localStorage['theme']`). So platform chrome built with `dark:` utilities — the web
> editor's nav tree, the Visual/Source toggle — rendered their **light** styles (`bg-neutral-200`,
> white nested-block fills) on the dark platform: the "everything's white in the editor" report.
> Fix: `darkMode` is now a two-selector variant — `.dark` (docs/marketing, unchanged) **plus**
> `[data-db-theme="dark"] .db` (platform), so `dark:` fires inside the `.db` scope exactly when
> the platform theme is dark, and turns off when it's light. Scoped to `.db`, so the docs renderer
> and marketing pages are untouched. Verified both platform themes in-browser via computed styles
> (editor + dashboard + analytics).

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

> **Cache invalidation is version-keyed, not tag-based (fixed 2026-06-12).** The render path
> reads config/pages/keys through the Next Data Cache (`unstable_cache`, `src/lib/s3-source.ts`,
> 1h TTL safety net). Invalidation originally relied solely on `revalidateTag` in `runSync`.
> That works for the **synchronous** paths (connect, manual Re-sync — server actions in a live
> request) but **not for the push webhook**: its `runSync` runs in `after()`, where
> `revalidateTag` doesn't propagate to the Data Cache (the request's revalidation set is
> committed before the callback runs). Symptom: a push synced fresh content + recorded a
> "Successful" deployment (DB-driven, cache-independent), yet the docs site served the stale
> copy until the TTL self-healed. **Fix:** the content cache key is stamped with the synced head
> sha (`site.lastSyncedCommitSha`, read live via the per-request `getSiteBySlug`), so a new sync
> writes new keys and serves fresh content with no revalidation needed — old versions age out via
> the TTL. The `revalidateTag` bust is kept (it still helps a same-sha re-sync drop stale entries
> promptly) but is no longer load-bearing. This also fixed a latent first-connect bug where
> `isSynced` cached `false` for the full TTL. Regression: `tests/unit/s3-source-version.test.ts`.

> **Known limitation — no sync queue/lock (2026-06-12).** `runSync` has no mutual exclusion:
> two concurrent runs on the same site (a manual Re-sync during an in-flight webhook sync, or
> two pushes in quick succession) both fetch + upload to the **same object-storage prefix**, so
> their writes interleave and a reader can briefly see a torn tree. The live Activity feed
> (§10.3) makes in-flight syncs visible, which *invites* a mid-build Re-sync — so as an interim
> guard, **`resyncSite` refuses while a sync is in flight** (a `building` row younger than the
> ~5-min function ceiling; older is treated as an orphaned timed-out run so it can't block
> forever — `syncInFlight`, unit-tested), and the Re-sync button surfaces *"A sync is already in
> progress."* This only covers the **manual** path; webhook↔webhook and webhook↔manual races are
> still open. **Real fix (deferred):** a per-site advisory lock (Postgres `pg_advisory_xact_lock`
> on a hash of the site id) or a proper job queue, so the second sync waits/coalesces instead of
> racing. Until then the guard + the idempotent `lastSyncedCommitSha` skip keep the common cases
> safe.

**Private repos — PAT first, GitHub App next (landed 2026-06-10).** The connect flow now
accepts an optional **fine-grained PAT** (Contents: read) for a private repo. The token is
encrypted at rest (AES-256-GCM, `src/lib/crypto.ts`, key in `PAPERVINE_ENCRYPTION_KEY`) on the
`site` row (`repo_token_enc`, plus an `is_private` flag) and decrypted only server-side at sync.
The real renderer-path change is in `src/lib/sync.ts`. *(Updated 2026-06-11:)* sync fetches
the repo as **one tarball** (`GET /repos/{o}/{r}/tarball/{ref}`, same endpoint public and
private — the token authenticates it), untars in memory (`src/lib/tar.ts`, a minimal
pax-aware reader, no tar dependency), and uploads to storage pool-parallel with content-types
inferred per extension. This replaced per-file fetching (tree API + one blob/raw request per
file), whose N round-trips put a ~240-file private repo right at the serverless time limit —
syncs *intermittently* 504'd. Measured after: ~0.4s warm / ~1.4s cold for `papervine/starter`
(previously multiple seconds, and minutes at repo scale). The token flows through one
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
- 🐛 **Fix (2026-06-15, PAPERVINE-3):** the per-connection tenant lookup (`getSiteByHost`)
  now swallows DB-connection errors and returns `null` instead of rejecting the `/mcp`
  request. It already no-ops on the apex/preview host; it must also no-op when the DB is
  unreachable (the DB-free smoke job, a transient outage) so a tenant-resolution failure
  never 500s an agent connection. Surfaced by Sentry as an `ECONNREFUSED :5432` unhandled
  rejection on `POST /mcp` in CI; the DB-free smoke `/mcp` check is the regression guard.
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
layer.

> **Authoring backend + editor — BUILT (2026-06-14).** The shared authoring backend and both
> its front-ends shipped together. Architecture, as built:
> - **One backend, two transports.** `authoring-core.ts` (`checkoutBranch` / `saveDraft` /
>   `publishDraft` / `discardSession`) sits behind both the human editor's server actions
>   (`actions/authoring.ts`) and the agent tools (`authoring-tools.ts`) — the editing-agent
>   chat (`/api/editor-agent`) and the authoring MCP (`/authoring/mcp`). Human and agent write
>   the **same Postgres draft buffer**, so there's no divergence. Mirrors the existing
>   `docs-tools.ts` → {assistant, read-MCP} split.
> - **Draft buffer is Postgres, not S3.** New tables `editor_session` + `draft_file` hold the
>   per-(site,branch,path) MDX edits. S3 stays the immutable synced content; drafts are small,
>   mutable, transactional. A `draftSource(siteId, branch)` overlay (`draft-source.ts`) reads
>   drafts **live (un-cached)** so agent↔human edits are instant, and **falls through to the
>   cached `s3Source`** for untouched files. The overlay is reachable only via an explicit
>   `requestContentSource(slug, { draftBranch })` param on editor surfaces — the public render
>   path and public `/mcp` are byte-for-byte unchanged, so a reader can never be served a draft.
> - **Publish = commit or PR.** The git-write client lives in `github.ts` (`getRef` /
>   `createBranch` / `commitFiles` / `updateRef` / `openPullRequest`, GitHub Git Data API).
>   `publishDraft` checks `baseCommitSha` divergence (optimistic) and relies on
>   `updateRef(force:false)` as the hard guard. **Commit mode delegates the re-sync to the
>   existing push webhook** (single sync path, no torn-tree race); it only runs an inline
>   `runSync` when the GitHub App isn't configured. PR mode creates the working branch,
>   commits, and opens the PR.
> - **Editing = Source + a real-renderer Preview** (revised 2026-06-15; superseded the original
>   MDXEditor WYSIWYG). The pane toggles between raw MDX (Source) and a Preview that is an
>   `<iframe>` onto `/app/preview/[org]/[site]`, which renders the current draft through THE REAL
>   renderer (`<Mdx>`) — same compile path, component map, and theme that ship to readers. The
>   preview route reads the draft via `requestContentSource(slug, {draftBranch})` (the overlay the
>   editor already loads from) and lives *outside* the `[org]` dashboard layout so the iframe shows
>   only the article, not the AppRail/PlatformShell — but still inherits `globals.css` (`.prose`,
>   Shiki, MDX component styles). Switching to Preview flushes the debounced draft save first, then
>   reloads the iframe, so it always reflects the latest keystroke.
>   **Why we dropped MDXEditor:** a WYSIWYG is a *second* rendering engine that only approximates
>   the MDX — real-world docs (a hand-coded hero with `<div>`/`<img>` layout and a grid of
>   `<HeroCard>`s) collapsed to opaque "component" boxes and `⚠️` error blocks. Using our own
>   renderer makes the preview byte-faithful to publish (what you see = what ships), removes the
>   `@mdxeditor/editor` dependency, and leans on the asset Papervine is built around. Editing moves
>   to source; git stays the source of truth, the draft buffer still stores one MDX string.
> - **Gated** behind the `editor.workspace` feature (admin-only while we dogfood; flip to
>   `everyone` to launch) at both the AppRail item (cosmetic) and `editor/layout.tsx` (real).
>
> Token-scoped *external* auth for the authoring MCP (a platform-auth PAT, §11) is the
> follow-up; today it authenticates via the app-host session + `x-papervine-org/site` headers.

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
  *(Status 2026-06-12: distinct switcher avatars. The little gradient mark next to each
  site was a single hardcoded blue→violet square, so a multi-site org was a wall of
  identical purple chips (and two sites sharing an initial — e.g. `large-docs` /
  `starter` — were indistinguishable). The mark now derives a per-site
  gradient from a stable key (the **slug**, not the display name, so it survives renames
  and never collides on a shared first letter) via `siteMarkGradient` (`src/lib/site-mark.ts`):
  an FNV-1a hash → hue, two-stop HSL gradient tuned to keep the bold white initial legible
  across the wheel on dark glass. Pure + deterministic (no server/client hydration drift),
  unit-tested in `tests/unit/site-mark.test.ts`; applied as an inline `background` since
  Tailwind can't generate arbitrary classes from a runtime value.)*
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
- **Web editor — BUILT (2026-06-14):** the 3-panel editor at `/:org/:site/editor` (editing-agent
  chat · navigation · multi-modal editor with a Visual⇄Source toggle, branch switcher, and a
  Publish→commit/PR button). It is **the same capability as the authoring MCP (§9.2), not a
  parallel one** — both write to one shared session-branch + server-side draft buffer. See the
  §9.2 build note for the architecture. The AppRail "Editor" item and the overview "Open editor"
  button are now wired (gated on `editor.workspace`). **Live preview** of unsaved drafts via a
  per-branch preview build (compile-on-request, §3.1 "C-full") is still deferred — today the
  editor previews through the draft overlay + the existing renderer, and publish surfaces the
  change through the normal sync/deploy on the deploy branch (or a PR).

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
>
> **Human "Searches" counted keystrokes, not searches (fix 2026-06-12).** The reader's search
> box fetches results on a 160ms keystroke debounce, and `GET /api/search` logged a `search`
> event for every query it served. Real typing is slower than 160ms, so each prefix settled and
> fetched on its own — typing `analytics` logged ~8 events (`a`, `an`, `ana`, …) for one search,
> inflating the **Searches** card several-fold. The debounce is a *fetch* throttle; it was wrong
> as an analytics trigger. **Fix:** `/api/search` no longer logs. The box now logs a single
> search *intent* via a beacon (`POST /api/search/track`, `navigator.sendBeacon`) on **settle /
> result-click / close**, collapsing a refinement chain to the one query the user meant —
> `reduceSearch` (`src/lib/search-track.ts`) treats a query that extends or trims the pending one
> as the same evolving search and only commits on a topic switch. This mirrors Algolia/DocSearch,
> which separate "searches" from result clicks and collapse keystroke-level queries server-side.
> Regression: `tests/unit/search-track.test.ts` (the 8-prefix chain → 0 commits mid-type, 1 on
> commit). **Verified in-browser**: typing `d-e-p-l-o-y` prefix-by-prefix then closing logged
> exactly 1 `deploy` event and 0 prefix rows (was up to 6).

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
  **The feed is live (2026-06-12):** a webhook sync that lands while you're on the page shows
  up — and resolves *Building → Successful* — without a reload.

> **Status (2026-06-12) — live Activity feed.** The feed now updates without a refresh. There's
> no realtime infra and none was added: we're on serverless (the webhook that starts a sync runs
> in a *different* invocation than any connection the browser holds — no shared memory to push
> from), and the trigger is a GitHub push, not a user action, so there's nothing to do
> optimistically. The durable `deployment` row is the event log — `runSync` inserts it `building`
> *before* the slow work and flips it to successful/failed at the end (`sync-runner`) — so the
> client just has to *read* it. **Approach:** the feed became a client component (`ActivityFeed`)
> seeded with the server-rendered rows (first paint unchanged, SSR stays source of truth), polling
> a bare **`/:org/:site/activity`** JSON endpoint (route under the `/app` mount, reached via the
> app-host rewrite; authorized like the page — session → membership → org-scoped site, so no
> cross-tenant leak). **Cadence is adaptive and self-regulating** (`pollDelayMs`): a `building`
> row in the payload means a sync is in flight, so poll ~2.5s to catch the transition; everything
> settled → idle at ~20s; backgrounded tab → pause and refresh on focus. Rows are uncontrolled
> `<details>` keyed by id, so React preserves each one's open/closed state across a poll. The
> shared feed query moved to `getActivityFeed` (`src/lib/activity-feed.ts`); pure bits
> (`feedParam`, `pollDelayMs`, `timeAgo`) live in `src/lib/overview.ts`, unit-tested; the endpoint's
> auth gate is locked by a `smoke.mjs` control-plane check. **Verified in-browser:** inserted a
> `building` deploy → it appeared within ~2s with a *Building* pill; flipped it to `successful` →
> the pill resolved within ~2s, no reload (the control plane is dark-only). **When to upgrade:**
> for sub-second feel or *intra-sync* progress (per-file upload, streaming logs), add a pub/sub
> (Pusher/Ably/Upstash) and have `runSync` emit progress events — polling's latency floor and
> lack of intra-job granularity are the ceiling, not worth paying until then.

> **Status (2026-06-13) — realtime feed over the Pusher protocol.** Took the "when to upgrade"
> step above: the feed now updates the *instant* a sync starts/finishes, not up to 2.5s later.
> **Why this shape:** Vercel functions can't hold a WebSocket open, so a self-hosted socket server
> isn't deployable on our target — the working pattern is a *protocol* that's identical in both
> environments with a managed equivalent in prod, the same swap we already do for Postgres
> (docker→Neon) and object storage (MinIO→R2). We chose the **Pusher protocol**: self-hosted
> **Soketi** in `docker-compose` locally, hosted **Pusher Channels** in prod — same `pusher` /
> `pusher-js` SDKs, only env (`PUSHER_*` / `NEXT_PUBLIC_PUSHER_*`) changes. Publishing is an HTTP
> trigger (a plain POST), which works fine inside a serverless function; the browser connects to the
> realtime host directly. Supabase Realtime was the alternative (presence + Postgres-CDC built in)
> but it drags a second Postgres-shaped stack alongside Neon for what is just broadcast — not worth
> the surface area. **Approach:** `runSync` calls `triggerActivity(siteId)` after the `building`
> insert and again after the resolve, publishing a *content-free* ping on a per-site **private**
> channel (`private-site-<id>`); the client reacts by re-running its existing authorized `/activity`
> fetch, so no row data transits the realtime host and the DB query stays the single source of
> truth. The channel is gated by `/api/pusher/auth`, which reuses the page's session→org-membership
> check so a tenant can't subscribe to another's channel. **Strictly additive:** the adaptive poll
> stays as the fallback, and when the `PUSHER_*` env is unset (CI, a bare checkout) every helper
> no-ops and the feed behaves exactly as before — realtime can never 500 a sync or a page.
> `realtime.ts` (server SDK + publish + auth-sign, `server-only`) and `realtime-client.ts` (shared
> channel/event names + browser config, no SDK import) keep the boundary clean; both are unit-tested
> (config shape for Soketi vs hosted; no-op when unconfigured). **Verified in-browser:** logged in,
> clicked Re-sync; the *Building* row appeared ~1.5s into the click — while the awaited `resyncSite`
> action was still running server-side (its `revalidatePath` hadn't fired) and the feed was on its
> 20s idle cadence, so it could *only* have arrived over the WebSocket — then flipped to *Successful*
> live, no reload. Confirmed an ESTABLISHED Chrome→Soketi socket on :6001. **Next upgrade (still
> open):** *intra-sync* progress (per-file upload, streaming logs) — now cheap to add, since the
> publish path exists; `runSync` would emit granular progress events on the same channel.

> **Active counter (2026-06-12).** An in-flight sync's `building` pill now counts up live —
> `Building 0:14`, with a pulsing dot — so a running sync reads as *active*, not a static label.
> Pure client-side: the row already carries `createdAt` (epoch ms), so `ActivityFeed` ticks a 1s
> clock (only while something is `building` — a quiet feed arms no timer) and renders
> `Date.now() − createdAt` via `formatElapsed` (m:ss, `src/lib/format-elapsed.ts` — split out
> standalone so the client component imports it without the server-coupled `overview` helpers,
> unit-tested). The
> tick state starts null so SSR and first client paint both show plain "Building" (no hydration
> mismatch). Scoped to *live* in-flight runs (younger than a 5-min ceiling, the sync route's
> maxDuration + slack): an older `building` row is a killed/orphaned run, so it drops the counter
> rather than ticking to infinity. The expanded Duration field shows the same live elapsed instead of "—". No new data,
> no extra requests — it rides the existing ~2.5s poll. **Verified in-browser** (dark): injected a
> `building` deploy → pill ticked 1:00 → 2:16, Duration matched.

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

### 10.4 Settings → Exports

The control-plane **Settings → Exports** surface (the incumbent: *Settings → Exports*) lets an
owner download the whole site as **one PDF for offline viewing** — "Export all content".
(the incumbent gates this behind Enterprise; we ship it ungated.)

**Approach — print, not a server-side PDF pipeline.** There is no headless-Chromium /
PDF-library dependency (heavy, and awkward on serverless). Instead the export is a
dedicated **print view** that reuses the real MDX renderer, and the browser's *Save as PDF*
produces the file. This is zero-new-deps, serverless-safe, and gives **full fidelity** —
components (Cards/Steps/callouts), Shiki-highlighted code, the lot — for free.

- **Route:** `src/app/sites/[site]/export/page.tsx` — a static segment that wins over the
  docs catch-all (`[[...path]]`), the same way `/login` does. Reachable both on the
  subdomain host (`{slug}.host/export`, middleware-rewritten → here) and via the apex path
  form (`/sites/{slug}/export`). It enumerates every page of the site **in sidebar order**
  and renders them stacked into one print-styled document (`renderExportDoc`), with a cover
  (site name + page count) and a `break-before: page` between pages.
- **Enumeration = the llms-full.txt walk.** `collectExportPages` (`src/lib/export-content.ts`)
  is structurally identical to `renderLlmsTxt(full)`: `listPages()` for the nav-ordered
  leaves, then `loadPage` each body, skipping any leaf with no loadable page (e.g. an API
  group entry, a stale nav ref) rather than failing the whole export. Runs inside the
  tenant's `contentContext`. Unit-tested (`tests/unit/export-content.test.ts`: order +
  skip-missing).
- **Always light.** A small client toolbar (`PrintControls`) strips `.dark` from the
  document (the export is a print artifact — black-on-white regardless of the reader's
  stored theme) and exposes the *Save as PDF* button. Hidden from the printout.
- **Auth-gated sites:** the export route applies the same Layer-2 reader-auth gate as
  `renderTenantDocs` (§11.2) — an auth-gated site must not leak its full corpus through
  `/export`; an unauthenticated reader is bounced to the site login.
- **Dashboard link:** the Settings surface (`settings/exports/`) links the **apex path-mode**
  URL (`/sites/{slug}/export`), so one route serves the export on every deploy regardless of
  wildcard-DNS / custom-domain routing. The button is disabled until the repo has synced
  (nothing to export while `site.status === "draft"`).
>
> **Status (2026-06-11):** built. Verified in-browser against the seeded `starter` site —
> the Settings surface renders the description + active "Export all content" button, and the
> export view renders the cover + every page (Introduction, Quickstart) with Cards, Steps,
> code blocks, and callouts intact, forced to light mode. A future server-rendered-PDF
> pipeline (true one-click download, no print dialog) could supersede the print view, but the
> print path is the pragmatic, full-fidelity v1.

### 10.5 Settings → Danger zone

The control-plane **Settings → Danger zone** surface — irreversible deletes, mirroring the
shape of the incumbent/Vercel's danger zone (a "Delete my deployment" section + a "Delete my
organization" section, each with a required *reason* and a red action). Two scopes:

- **Delete this site** (the incumbent's "deployment") — owner **or** admin. Drops the `site` row;
  the Postgres FK cascade takes its `deployment` + `analytics_event` rows. **Two resources
  don't cascade**, so the action sweeps them by hand *before* the row goes away (it's the
  only key to find them again): the object-storage prefix `sites/{id}/` (`deletePrefix`,
  `src/lib/storage.ts`), and — if the site set a custom domain — its attached Vercel
  project-domain (`removeProjectDomain`), which otherwise leaks a slot against the finite
  per-project cap (SPEC §2) exactly as a stale un-set would. Both run **best-effort**
  (logged, never fatal): the user asked to delete, and a leaked prefix/slot is recoverable
  while a half-deleted, stuck row isn't. Lands on the bare org (`/:org`), which forwards to
  the next site or the connect form.
- **Delete this organization** — **owner only** (Better Auth's `organization:delete`
  permission also enforces it server-side). Sweeps every site's out-of-band resources
  (storage prefix **and** Vercel domain, same best-effort cleanup), then hands off to
  `auth.api.deleteOrganization`, whose org-row delete fires our FK cascade (sites →
  deployments/analytics, installs, members). The user account survives; they land on the app
  root, which forwards to their next org or onboarding.

The out-of-band cleanup decision is a pure helper — `planResourceCleanup(sites)`
(`src/lib/danger-zone.ts`) folds a set of site rows into `{ storagePrefixes, domainsToDetach }`
— so both delete paths share it and it's unit-tested without a DB or the network
(`tests/unit/danger-zone.test.ts`), the same split as `parseDomainStatus` vs. its fetch.

**Two gates, both required.** A non-empty **reason** (persisted — see below) arms the
section's button; clicking opens a **type-to-confirm** modal (type the exact site/org
**slug**, case-sensitive, the GitHub/Vercel guard against a fat-fingered irreversible click)
that arms the final delete. Both checks are pure (`src/lib/danger-zone.ts`: `isReasonValid`,
`confirmationMatches`, `canDelete`) and unit-tested (`tests/unit/danger-zone.test.ts`).
**Confirm against the slug, not the display name** — the slug is the identifier the user
sees in the URL, the subdomain, and the sidebar, while a site's display name can diverge from
it (a site named `sdfdsf` whose slug deduped to `sdfdsf-3`). Confirming the *name* asked the
user to type a string they couldn't see anywhere, so the button never armed; the modal now
takes the slug (`siteSlug`/`orgSlug` straight from the URL params), exactly like GitHub's
"type the repository name" prints the URL path. The input has no placeholder echoing the
answer (it read as pre-filled).

- **Route:** `settings/danger/` overrides the `settings/[section]` placeholder for the
  `danger` slug (the same pattern as `domain`/`authentication`). The page (`requireSite`)
  gates org membership; the role decides which sections render, and the server actions
  re-check it — hiding a section is not gating the action.
- **Exit survey.** Each delete first records the reason in a `deletion_feedback` row
  (`scope`, snapshotted `subjectId`/`subjectName`, `reason`, `actorUserId`). Deliberately
  **not** FK'd to site/org — the whole point is to outlive the deleted thing, so the subject
  is snapshotted as plain text. Append-only product feedback ("why are you deleting this?"),
  nothing in the app reads it yet.
- **Cross-context redirect.** Like `connectRepo`, the actions return a bare `redirectTo` and
  the client hard-navigates (`window.location.assign`) — a soft RSC redirect would skip the
  app-host Host rewrite (the documented tenant-URL gotcha) and land on the apex.
>
> **Status (2026-06-11):** built. Verified end-to-end in-browser against the seeded
> `dev-org`/`starter`: the surface renders both sections (site + the amber "this cannot be
> undone" org warning), the reason gate disables the button until filled, the type-to-confirm
> modal disables the final delete until the exact slug is typed, and a real site delete
> removed the row, cascaded its children, recorded the `deletion_feedback` row, and
> hard-navigated to the next site. Org deletion verified against the same Better Auth
> `organization/delete` endpoint the action calls — org + sites + members cascade away, the
> user account remains.
>
> **Status (2026-06-12):** fixed a confirm-phrase mismatch. The type-to-confirm asked for the
> display *name*, but every visible identifier (URL, subdomain, sidebar) is the *slug* — so a
> site named `sdfdsf` with slug `sdfdsf-3` could never be confirmed (typing what the URL
> showed never matched the name, and the Delete button never armed). Now confirms the slug
> (`siteSlug`/`orgSlug` from the URL params), and dropped the input placeholder that echoed
> the answer (it read as pre-filled). Verified in-browser against the seeded `dev-org`/`starter`
> (name "Starter Docs", slug `starter`): the modal reads "Type starter to confirm" and the
> delete arms once the slug is typed.
>
> **Status (2026-06-12):** plugged a resource leak on delete. The action swept `sites/{id}/`
> storage but never detached the site's **Vercel custom domain** — so deleting a site (or org)
> with a connected domain left the project-domain slot claimed against a finite cap, and since
> the row delete dropped the only record of the host, it couldn't be found again to detach
> (an unrecoverable-in-band leak). `removeCustomDomain` already freed the slot on un-set;
> deletion now does too. Extracted the cleanup *decision* into a pure `planResourceCleanup`
> (storage prefixes + domains-to-detach for a set of sites) so both delete paths share it and
> it's unit-tested (the regression: a site with a `customDomain` must appear in
> `domainsToDetach`). Also made the cleanup **best-effort** — `deletePrefix` could throw and
> block the row delete, contradicting its own "we still delete the row" comment; now a sweep
> or detach failure is logged and the delete proceeds. Scoped: the Vercel seam is env-gated
> (no-op without `VERCEL_TOKEN`, so local/CI unaffected), affecting only hosted-prod sites
> that set a custom domain.

### 10.6 CLI (`papervine`) — local dev tool, published to npm

The CLI is a **local dev tool**, not a second front door to the control plane. It's the
`mint` analogue (the incumbent renamed `incumbent`→`mint`): you run it inside a repo of MDX +
`docs.json` and it renders the site locally. Today that's a single command —
`papervine dev [dir]` (`bin/papervine.mjs`), which boots the renderer with
`PAPERVINE_CONTENT` pointed at the folder; `tests/crawl.mjs` reuses the same path.

**The packaging boundary is the security decision.** The thing published to npm carries
only the **renderer** (the `src/lib/mdx.tsx` hybrid, `src/lib/content.ts`, the docs routes,
config parsing). It must **not** carry the control plane — `better-auth`, Postgres/Drizzle,
the S3 SDK, Pusher, the MCP handler, the dashboard. Those are the *hosted, deployable*
Papervine (`app.papervine.io`); bundling them into an `npx`-distributed tool ships auth + DB
+ cloud SDKs to every end user who just wants to preview docs — a transitive-CVE attack
surface and a heavy install, for code the CLI never invokes (middleware already suppresses
the control plane at runtime when `PAPERVINE_CONTENT` is set, but that's a runtime guard, not
a packaging boundary).

**Decision (2026-06-14): split, via an npm-workspace monorepo** — not a `files` allowlist.
The repo becomes `packages/renderer` (→ **`@papervine/renderer`**, the shared renderer-core,
published under the scope) consumed by two apps: `apps/cli` (→ the unscoped **`papervine`**,
what `npx papervine` runs — a thin Next app with only the local-folder `(docs)` route + `bin/`)
and `apps/web` (the private hosted control plane, today's app moved wholesale). The CLI's
`package.json` lists `next` + `react` + `@papervine/renderer` and *nothing* control-plane, so
better-auth/postgres/@aws-sdk/pusher/Drizzle/MCP are **physically absent** from the `npx`
tarball — the wall a `files` allowlist couldn't give (one `package.json` still *installs* those
deps even if their source files are excluded). The rationale is broader than CVEs: the control
plane isn't on the code path `papervine dev` executes, so shipping it is pure install-weight +
compile-surface + conceptual muddle regardless of security. **The boundary is already clean in
the code** — the local-folder route `(docs)/[[...slug]]` never touches the DB; all
DB/auth/assistant/analytics coupling lives in `render-tenant.tsx`, which backs the multi-tenant
`sites/[site]` route — so the split is mostly *moving* files behind the existing `ContentSource`
seam, not untangling logic. **Renderer-core** = lib `config`/`content`/`mdx`/`nav`/`openapi`/
`theme`/`tenant-host`/`url-base`/`slug`/`utils`/`fonts`/`format-elapsed` + components
`Navbar`/`Sidebar`/`TableOfContents`/`NavTabs`/`LucideIcon`/`Wordmark`/`ThemeToggle`/`mdx/*`/
`api/*`. **Four edge couplings** get cut: the `(docs)` layout's `<Assistant/>` (→ optional
slot the web app injects), `SearchDialog`→`search-track` (→ no-op without the endpoint), the
227-line tenant `middleware.ts` (→ near-empty for the CLI, which serves docs at the apex in
`PAPERVINE_CONTENT` mode), and local asset serving (→ a renderer-side route). The `.npmrc`
`legacy-peer-deps=true` and `next.config` `serverExternalPackages` both carry to the workspace.
Either published tarball is `npm pack --dry-run`-audited so no `.env.local`/seed/fixtures leak.

**Execution is phased**, each phase keeping typecheck + smoke + a real-repo crawl green:
(1) workspace scaffold + move today's app to `apps/web` unchanged; (2) extract
`@papervine/renderer`, repoint `apps/web` at it (`@/` imports → package-relative); (3) sever
the four couplings; (4) build `apps/cli`, tarball-audit; (5) ship `papervine@0.1.0` over the
placeholder, from CI with `--provenance`. Phase 1 is the disruptive-but-mechanical one (the
move touches every import path); 2–4 are contained; the destination is the full monorepo
regardless of where we pause.

**incumbent parity informs the surface.** `mint` has **no `deploy` and no `login`** —
deployment is Git-based (push → their GitHub app builds it), and the CLI only reaches the
hosted backend for *read-only live data* (`mint analytics` pulls real traffic). So a CLI
never *is* the control plane; at most it's a thin HTTPS client to it. Papervine mirrors this:
local dev commands now, an optional thin authenticated client (`papervine analytics`, a
hypothetical `papervine deploy`) later — never by embedding the server. The incumbent's one gap is
that it has **no offline `build`/static export** (prod rendering is server-side on their
infra); because Papervine is self-hostable, `papervine build` (static export of a docs repo)
is a genuine differentiator and a natural fit for the renderer-only package.

**v0.1.0 command surface** (each maps to renderer machinery we already have; ship in this
order, smallest lift first):

| Command | Does | Reuses |
| --- | --- | --- |
| `papervine dev [dir]` | Local preview w/ live reload (**built**) | `bin/papervine.mjs` → `next dev` + `PAPERVINE_CONTENT` |
| `papervine broken-links [dir]` | Report dead internal links / missing pages | `tests/crawl.mjs` link-graph |
| `papervine openapi-check [dir]` | Validate referenced OpenAPI specs | `src/lib/openapi.ts` + `@scalar/openapi-parser` |
| `papervine validate [dir]` | Strict-mode config + frontmatter + nav report (CI gate) | `src/lib/config.ts` run in *report* mode instead of its lenient warn-don't-throw default |
| `papervine build [dir]` | Static export to `./dist` (the incumbent-gap differentiator) | renderer + crawl; emits the rendered route tree |
| `papervine new [dir]` | Scaffold from the starter template | a vendored starter `docs.json` + MDX skeleton |

Deferred (thin-client, needs an API + token storage, not a pure renderer): `papervine
analytics`, `papervine login`, `papervine deploy`. Compatible with the split — they talk to
the hosted API over HTTPS, they don't embed it.

> **Status (2026-06-13):** reserved the npm namespace. Claimed the **`@papervine`** org/scope
> *and* the unscoped **`papervine`** name (so `npx papervine` resolves to the bare name, the
> `npx mint`-style invocation). Published a minimal **`papervine@0.0.1` placeholder** — a
> 3-file tarball (`cli.mjs` prints a "coming soon" pointer to the repo, `package.json`,
> `README.md`), built in a throwaway dir *outside* this repo so the main package's
> `private:true`/secrets couldn't leak; `npm pack --dry-run` confirmed the 3-file surface
> before publish. The real CLI ships as `papervine@0.1.0` over the top, from CI with
> `npm publish --provenance` (GitHub Actions OIDC + automation token) — supply-chain hardening
> the placeholder didn't need. Each `0.1.0` command earns a `docs/` page as it lands (the
> dogfooded CLI reference); the placeholder, having no real behavior, doesn't.
>
> **Status (2026-06-14):** chose the packaging boundary — **split via npm-workspace monorepo**
> (`packages/renderer` + `apps/cli` + `apps/web`), not a `files` allowlist. Rationale and the
> renderer-vs-control-plane file boundary captured above; execution is the 5-phase plan. Not yet
> started — the move (Phase 1) is next.
>
> **Status (2026-06-14):** built the split (Phases 1–4), reordering so the disruptive
> app-relocation is deferred to last — the value path (extract renderer → build CLI) lands
> first and the web app keeps working at the repo root for now (root `package.json` is both the
> web app and the workspace manager; the cosmetic `apps/web` move is Phase 4-of-the-original,
> still pending). What landed: **(1)** workspace scaffold (`workspaces: ["packages/*",
> "apps/*"]`, root renamed `papervine-monorepo` so it won't collide with the CLI's `papervine`).
> **(2)** `@papervine/renderer` extracted — the *exact* render closure, smaller than first
> scoped: lib `config`/`content`/`mdx`/`nav`/`openapi`/`url-base`/`theme` + components
> `Navbar`/`Sidebar`/`TableOfContents`/`NavTabs`/`LucideIcon`/`ThemeToggle`/`api/`/`mdx/*`.
> `utils`(`cn`)/`tenant-host`/`slug`/`fonts`/`format-elapsed` proved **not** on the render path
> (the first closure trace missed relative imports — Navbar pulled `./SearchDialog` +
> `./assistant/AskAssistantButton` via non-`@/` specifiers; re-traced including those). Consumed
> via `transpilePackages` + deep imports (`@papervine/renderer/lib/x`); no restrictive
> `exports`. **(3)** the four edge couplings severed: `Navbar` now takes optional `search` +
> `assistant` **slots** (web passes its real `SearchButton`/`AskAssistantButton`, the CLI passes
> nothing); the CLI ships a near-empty `middleware.ts` (asset-rewrite only — no tenant routing)
> and its own `dbasset` route to stream local images from `PAPERVINE_CONTENT`. **(4)**
> `apps/cli` → **`papervine`**: a thin Next app (root layout + `(docs)` route + bin) depending
> only on `next`/`react`/`@papervine/renderer`. Verified: web typecheck + smoke + unit (210) +
> crawl (`large-docs` 881pp, **0×500**) all green; `papervine dev` renders the dogfood docs
> (light **and** dark, browser-checked) and a real `starter` incl. asset serving
> (`/logo/light.svg` → 200); **tarball audit** = 10 files / 15.5 kB, **dependency audit** = zero
> control-plane packages (no better-auth/postgres/drizzle/@aws-sdk/pusher/mcp/ai-sdk). Remaining
> (Phase 5): publish `@papervine/renderer` + `papervine@0.1.0` from CI with `--provenance`
> (decision: publish the renderer vs. `bundledDependencies` — leaning publish, to keep the CLI
> tarball lean and the renderer reusable); tighten the renderer's declared deps before publish;
> the docs-CSS (`.prose`/shiki) is duplicated between web `globals.css` and the CLI's, to dedupe
> into the package later; the cosmetic web→`apps/web` move.
>
> **Status (2026-06-14):** stripped the incumbent from all **user-facing** surfaces — the published
> CLI (bin help, `package.json` description/keywords, the source comments) and the public docs
> site (19 pages + `docs.json`): positioning prose ("docs.json-compatible docs platform", "docs.json-compatible",
> "mirrors the incumbent") became neutral capability claims ("compatible with existing `docs.json`
> projects"). Kept where factual/functional: the `@mintlify/mdx` dependency name, the `mint`
> theme value, the broken-peer-dep gotcha — and **internal** design docs (this SPEC, CLAUDE.md,
> GAP-REPORT.md, the crawl fixtures), where the incumbent is the legitimate "what we clone" reference.
>
> **Status (2026-06-14):** wired Phase 5 (publish), publish itself deferred. Versioned
> `@papervine/renderer`→`0.1.0` and pointed the CLI's dep at `^0.1.0` (resolves to the local
> workspace in dev); added the renderer's `repository`/`files` (provenance needs `repository`).
> Renderer deps confirmed against actual imports (exact — clsx used, nothing missing/extra; no
> tighten needed). Added `.github/workflows/publish.yml` — **dormant** until a `v*` tag (or
> manual dispatch) *and* an `NPM_TOKEN` secret exist: it gates on typecheck+smoke, then
> `npm publish --provenance --access public` the renderer first (the CLI depends on it) then the
> CLI; `id-token: write` enables the OIDC build-provenance attestation. CI's `verify` job also
> now typechecks `apps/cli` against its own tsconfig. Dry-run packs clean:
> `@papervine/renderer@0.1.0` (26 files / 23.8 kB), `papervine@0.1.0` (12 files / 7.3 kB).
> **Not done on purpose:** the actual `npm publish` (awaiting go) — `papervine@0.1.0` will land
> over the `0.0.1` placeholder.

### 10.7 Error resilience (route boundaries)

The dashboard must never go to a **black full-screen crash** on a transient hiccup. The
control plane is a client-navigated App Router SPA: every tab switch fetches an RSC payload
(`?…&_rsc=…`). When such a fetch is **dropped at the network layer** — `TypeError: Failed to
fetch`, the browser saying it never got a response — React 19 surfaces the rejection as a
throw *during render*. With no route-level `error.tsx`, that throw escalates all the way to
the root `global-error.tsx` (bare `NextError`), which discards the whole app — on a dark-mode
Mac that paints as a **black screen**. The trigger is unavoidable (real networks drop
fetches, especially against a cold serverless/Neon path); the catastrophic UX is not.

The fix is two route-level error boundaries:

- **`src/app/app/[org]/error.tsx`** — the primary boundary. It renders *inside*
  `[org]/layout.tsx`, so the `PlatformShell` + `AppRail` survive and only the content column
  shows a recoverable, themed card with **Try again** (`reset()` re-renders just the failed
  segment — on a transient blip the retry simply succeeds). This is what catches the actual
  dashboard-navigation crash.
- **`src/app/app/error.tsx`** — a backstop for the whole app-host mount, catching what the
  per-org boundary can't (e.g. a throw in `[org]/layout.tsx` itself). It renders *above* that
  layout, so it brings its own `PlatformShell` — otherwise the backstop would itself paint
  unstyled/black, defeating the purpose. `redirect()`/`notFound()` from `requireOrg` are
  re-thrown by the boundary (Next handles them), not swallowed.

Both still `Sentry.captureException`, so we keep the report — but now as a *handled,
recovered* error, not a dead page. The "is this a dropped fetch vs. a real app bug?" copy
choice is a pure helper (`src/lib/dashboard-error.ts` `isNetworkError`), unit-tested, so the
network-vs-generic branch can't silently regress.

> **Status (2026-06-15):** landed after a production black-screen (Sentry PAPERVINE-4,
> `TypeError: Failed to fetch` on the site-overview tab nav, one user on a cold backend — the
> same trace showed a 1.6s session query, i.e. a cold Neon connection). Root cause of the
> *severity* was the missing boundary, not the fetch: the trace logged **0 server errors** and
> no server span for the failed request, confirming a network-layer drop, not a 5xx. Verified
> in-browser (forced throw, light + dark) — chrome intact, themed card, no black screen.
> Smoke's control-plane checks exercise the app-host gate around the new boundaries.

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
| CLI | `papervine dev <dir>` (`bin/papervine.mjs`) | preview any MDX + docs.json repo locally — the `mint dev` analogue; `tests/crawl.mjs` reuses it. Local dev tool only (renderer, never the control plane); published to npm as the unscoped `papervine`. Command surface + packaging boundary: **§10.6** |
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
7. ~~**Web editor** — defer past v1? The incumbent treats it as a differentiator.~~ **DECIDED & BUILT (2026-06-14): build it now, agent-native.** Shipped the full 3-panel editor (editing-agent chat · navigation · multi-modal editor) on a shared authoring backend — see §9.2's build note. We chose to lead with the differentiating axes (open-source + agent-native) rather than defer. Editing is **Source MDX + a Preview rendered by our own renderer** (revised 2026-06-15 — the original MDXEditor WYSIWYG was dropped because a second rendering engine only approximates real-world MDX; see §9.2). Git stays the source of truth and the preview is byte-faithful to publish.

---

## 17. Non-Goals (v1)

- In-place WYSIWYG editing (we ship Source + a faithful real-renderer Preview instead; §9.2)
- Migrating from non-hosted docs sources (Docusaurus/GitBook importers)
- Embeddable AI on third-party sites
- Marketplace / plugin ecosystem
- On-prem enterprise deploys
