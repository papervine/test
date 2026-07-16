# Papervine — Open-Source Docs Platform

**Status:** Draft v0.1
**Date:** 2026-06-07
**Owner:** jeff@loiselles.com

An open-source, multi-tenant docs platform alternative for Git-backed MDX docs. Users connect
a repo containing MDX files + a `docs.json` config; Papervine renders a fast, searchable
docs site with an interactive API playground and an AI assistant. The technical target is
`docs.json` compatibility at the migration boundary, with room to diverge where Papervine
can be simpler, cheaper, or more open. One deployment serves many tenants.

---

## 1. Vision & Principles

- **Docs-as-code.** Source of truth is MDX + `docs.json` in the user's Git repo. The platform is a renderer + control plane, never the source of truth.
- **Multi-tenant from day one.** A single app instance serves all customer doc sites, addressable by subdomain (`acme.papervine.io`) and custom domain (`docs.example.com`).
- **`docs.json`-compatible.** Use the public `docs.json` schema as the compatibility target
  so existing MDX docs repos migrate with minimal changes. The schema link remains
  `https://papervine.io/docs.json`.
- **Runtime rendering, no content at build time.** The deployed app has no tenant content
  baked in. Content is fetched + rendered on demand (with aggressive caching). New deploys
  don't require rebuilding every tenant.
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
│  Request: docs.example.com/guides/intro                                │
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
`<PlatformShell variant="full" | "home" | "lite">` (`src/components/platform/`). `full` =
glow + grid + grain (auth); `home` = glow + **growing vine** + grain (the marketing
landing); `lite` = glow only (the data-dense app, so the grid/grain never sit behind
tables). Brand accent is the blue→violet gradient; status colors
(green = live/success, red = failed) stay semantic. Pages compose the shared `Button`
and `Field` primitives — they don't redefine the look. This theme is deliberately
**separate from the docs renderer**, which is light-first and themed per tenant from
`docs.json` (`src/lib/theme.ts`, `globals.css`); the two must never leak into each other.

**Apex nav is session-aware.** The marketing landing (`src/app/home/page.tsx`) reads the
session: a signed-in visitor gets a single **Dashboard** link instead of **Log in / Sign
up** (which would dead-end them re-signing up). Reading the session opts the page into
dynamic rendering — acceptable for the apex. Smoke covers the logged-out shape (`/home`).

**Pricing thesis: all features included, paid by scale (drafted 2026-07-07).** The
incumbent pattern is to make public docs cheap while gating security and AI behind
high tiers. Papervine's sharper public wedge is **feature-complete by default**: auth,
docs RBAC, custom domains, MCP, API playground, assistant, writing agent, analytics,
preview deployments, and workflows should be available from Free onward, with limits
based on scale rather than capability. Paid plans meter the real costs: docs sites,
editors, traffic/bandwidth, AI usage, analytics retention, support, and procurement.
Enterprise remains for SCIM, audit logs, BYOK/private model routing, legal/security
review, custom retention, SLAs, migration, and dedicated support. Detailed pricing
research and go-to-market planning are private strategy material and stay outside
tracked public docs; locally, `_private/` is gitignored for that work. The current
`/pricing` implementation is still presentational and may lag this thesis until the
next page update; there is no billing backend, plan enforcement, or credit metering
yet (§10 "Billing (later)").

**Landing backdrop: a growing vine, not a grid (landed 2026-06-28).** The marketing
landing swaps the static `.db-grid` for `VineField` (`src/components/platform/VineField.tsx`,
the `"home"` variant) — three vines that slowly *draw* upward via an animated
`stroke-dashoffset`, leaves unfurling in sequence as each strand climbs, glowing buds at
the tips, then a near-imperceptible perpetual sway. It plays on the name (a vine sprouting
from a page) and the motion leads the eye up to the headline. **Pure SVG + CSS** (keyframes
in `platform.css`, `.db-vine*`), so the landing stays a server component — no JS ships — and
it's masked like the grid and built from the same blue→violet brand gradient.
`prefers-reduced-motion` collapses it to the fully-grown vine at rest. Auth pages keep the
grid (`"full"`). Behind the vines, `SproutField` lays a whisper-faint, full-viewport bed of
tiny seedlings that grow → hold → wither → regrow on staggered loops (a jittered, seeded
grid — deterministic, no `Math.random`, so SSR is stable; keyed off `--ink-rgb` like the
grid, so it's theme-adaptive and stays barely-there) — ambient "little things growing"
texture in place of the flat grid. Smoke asserts the landing renders `db-vine` + `pv-sprouts`
and not `db-grid`.

**UI primitives: shadcn/ui, mapped onto `.db` tokens.** The Control-Plane uses
[shadcn/ui](https://ui.shadcn.com) for its component primitives (`src/components/ui/`,
`cn()` in `src/lib/utils.ts`, `components.json`). We keep the shadcn **skeleton** (cva
variants, `data-slot`, Radix), but point the variants at our `.db` palette rather than
stock shadcn vars — so `Button`'s `primary`
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
- custom domain (`docs.example.com`) → tenant by **host** (`site.customDomain`, unique) — **shipped**. Owners connect/remove a domain and pick root vs `/docs` hosting at Settings → Domain setup (`customDomainSubpath`); connecting attaches the host to the Vercel project so its per-host cert issues (`vercel-domains.ts`, env-gated — see §2 → Custom domains), and a live check (`GET {domain}/api/site-identity`) flips the badge to Connected and stamps `customDomainVerifiedAt`.
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

**Custom-domain gap in the above (fixed 2026-06-26).** `requestContentSource()` resolved the
tenant from `x-papervine-site` / `resolveTenantSlug(host)` — but a **custom domain**
(`doc.example.com`) yields neither (middleware forwards the raw Host as `x-papervine-host`, and
the slug resolvers return null for a non-papervine host). So on a custom domain the **root
layout** got a null source and primed the React-`cache()`'d `loadConfig()` with the **default**
content — re-triggering the exact memoization bug above, *only on custom domains*: pages read
the tenant's S3 content (so they rendered) while the sidebar/tabs read the cached default
docs.json (so they were wrong/empty — "it's like it's not reading docs.json"). Invisible on
subdomains/apex and via `papervine dev` (single-repo `fsSource`); the `(docs)` layout already
resolved correctly (it passes `record.slug` to `requestContentSource`). Fix:
`requestContentSource` falls back to `getSiteByCustomDomain(x-papervine-host ?? host)` when
there's no slug, so the root layout primes the tenant source on custom domains too.

**Same trap on the web editor — but the layout can't pre-resolve it (fixed 2026-06-29).** The
editor (`/app/:org/:site/editor`, §9.2/§10) lives on the **app host**, which has no tenant slug
and no custom domain — so `requestContentSource()` (no args) returns null and the **root layout**
primes the React-`cache()`'d `loadConfig()` with the **default** `content/` config, exactly as
above. But the layout-priming fix doesn't apply here: the layout can't resolve the editor's source
because that source is a **draft overlay keyed on a branch** the layout never sees (and an app-host
page legitimately wants default branding). So the editor's `contentContext.run(draftSrc, …)`
couldn't override the already-poisoned memo, and `buildNav` built the **navigation from our own
docs.json** — the editor sidebar showed Papervine's pages, not the edited site's (only `loadConfig`
was poisoned; the layout never calls `loadPage`, so page bodies read the draft correctly). Fix: the
editor reads config **straight from its resolved `src`** (`src.loadConfig()`), bypassing the
per-request memo entirely — the in-context read is unavailable here, so we sidestep the memo rather
than prime it. Regression guard: `tests/unit/editor-config-source.test.ts` models the request-scoped
memo over the real `buildNav` and asserts the editor's nav is the edited site's, not the default's.

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

### Custom domains (BYO `docs.example.com`)

Two **independent** domain systems — don't conflate them:

1. **`*.papervine.io` (our domain).** One wildcard TLS cert, auto-issued by the host
   platform because **we control the DNS**. Setup (done 2026-06-09): point `papervine.io`
   nameservers at Vercel (`ns1/ns2.vercel-dns.com`) so Vercel can DNS-01 the wildcard cert;
   add `*.papervine.io` as a project domain. *Caveat that bit us:* a wildcard CNAME at the
   registrar is **not** enough — without Vercel-controlled DNS the wildcard cert never
   issues, every subdomain fails the TLS handshake (looks like a DNS bug, is actually a
   cert bug). Moving nameservers requires re-creating non-platform records in Vercel DNS —
   notably Namecheap email-forwarding **MX + SPF** — or inbound mail breaks.

2. **`docs.example.com` (customer's domain).** Lives under the **customer's** nameservers,
   which we never control, so the wildcard trick can't apply — each custom domain needs its
   **own** cert. Customer adds a `CNAME docs.example.com → {branded target}` (apex → `A`,
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

#### Durability: intent in Postgres, Vercel as a projection (reconciler)

The Phase-1 client made the Vercel calls **synchronously and best-effort**: a failed detach
silently orphaned a host on the project (finite-slot leak), and `addProjectDomain` errored when
re-attaching a host already on *our* project (Vercel's `409 domain_already_in_use` doesn't say
*which* project), so re-saving an unchanged domain — e.g. toggling `/docs` — failed in prod. The
durable model treats **the database row as desired state and Vercel as a projection** driven toward
it by a reconcile loop. Both hard requirements — *a domain is always eventually deleted when asked*,
and *a new site can take over a domain from an old one if it proves DNS control* — are
state-convergence problems, so a reconciler (idempotent, self-healing) is the right shape, not a
fire-and-forget queue (the same reconcile-against-reality pattern the sync uses).

> **Status — slice 1 shipped (2026-06-28): idempotent attach + durable deletion.**
> (1) `addProjectDomain` is now idempotent — on a 409 it reads our own project's domains
> (`projectOwnsDomain`) and treats an already-ours host as success, fixing the same-domain
> re-save. (2) Durable deletion via a `domain_removal` **tombstone** table (`domain` PK so
> duplicate requests collapse): `releaseDomain` (`src/lib/domain-reconcile.ts`) enqueues a
> tombstone, attempts the detach inline, and drops it only on success — every place that frees a
> host (change domain, remove domain, delete site) now calls it instead of a bare
> `removeProjectDomain`. (3) `reconcileDomainRemovals` drains the tombstones — drop on Vercel's
> confirm/404, bump `attempts`/`lastError` otherwise — driven by a `/api/reconcile/domains`
> route (`CRON_SECRET`-gated; allowed locally when unset) on a **Vercel Cron** (`*/10 * * * *`
> in `vercel.json`). So a transient Vercel failure can never strand a domain — the next sweep
> retries until it's gone. Reconciler + idempotency are unit-tested with an injectable store
> (`tests/unit/domain-reconcile.test.ts`, `vercel-domain-idempotent.test.ts`), no DB needed.
>
> **Executor choice (is it time for trigger.dev?):** not yet. Vercel Cron + the Postgres state
> machine delivers durable deletion with no new vendor, and — because intent lives in Postgres —
> the executor is swappable later (cron → trigger.dev/Inngest) with no change to the correctness
> model. Adopt a durable workflow engine when the *second/third* background-job use case lands or
> per-domain timed workflows (attach → wait → poll DNS with backoff) outgrow a coarse sweep; on
> Vercel an external runner is then the only option (functions are short-lived, `after()` is
> best-effort).
>
> **Planned — slice 2 (verify reconciliation):** fold the `customDomainVerifiedAt` live check
> into the reconciler on a backoff (a `domain_status` lifecycle on `site`) instead of the one-shot
> check at save time. **Slice 3 (ownership override):** a `domain_claim` table + a DNS **TXT
> challenge** (`_papervine-challenge.{domain}` bound to the claiming site) the reconciler resolves,
> then **atomically transfers** the domain (clear the old owner's `customDomain`, set the new one's,
> keep the Vercel attachment, revalidate both, notify the displaced owner). Keep the `unique`
> constraint on `site.customDomain` — claims live in their own table so the incumbent keeps serving
> until the verified flip. Open policy call: whether a *live, verified* domain can be claimed away,
> or only a stale/pending one.

---

## 3. Content Pipeline (Git Sync)

1. User connects repo via GitHub App / OAuth (read access to one repo).
2. On `push` webhook (or manual "sync"), a **sync worker**:
   - clones/pulls the repo at the target ref
   - validates `docs.json` against schema (fail loudly with line numbers)
   - **compiles** each `.md(x)` to a serializable bundle with the **hybrid renderer**: serializer output for Shiki dual-theme highlighting + snippet handling, executed via `@mdx-js/mdx`'s `run` inside a try/catch, so an unsupported feature degrades to an inline notice rather than a 500 (rationale + measurements in `GAP-REPORT.md`). Resolves our component set, with a passthrough fallback for unknown/member-expression components.
   - extracts headings → builds search index + per-page TOC
   - parses any referenced OpenAPI/AsyncAPI specs → playground page definitions
   - generates embeddings for changed pages → vector store (AI assistant)
   - writes compiled bundles + manifest to object storage, metadata to Postgres
   - invalidates CDN/Redis cache for changed paths
3. Render Plane reads compiled bundles at request time. **No live MDX compilation on the hot path** (compile-on-sync, not compile-on-request) — this is the key perf decision.

> Note: hosted docs platforms compiles some things (e.g. Twoslash) on the fly via serverless. We prefer compile-on-sync for predictability; revisit if it limits dynamic features.

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

**Sync transfer: scoped + incremental + parallel (landed 2026-06-15).** How `syncSite`
(`src/lib/sync.ts`) moves bytes has now been through three iterations, each fixing the last:
1. **Per-file** (tree-walk + one blob/raw request per file) — N round-trips put a big private
   repo at the function time limit; syncs *intermittently* timed out.
2. **One tarball** (`GET …/tarball/{ref}`) — fixed the round-trip count but downloads and
   gunzips the **entire repo** in memory to harvest a `docs/` subdir. A real private monorepo
   (`Pixwel/platform`, docs in `docs/`) took **744 s** to sync 80 MB of docs — fine in dev (no
   `maxDuration`), but in prod that blows the 300 s connect limit and leaves a stuck `building`
   deployment with no error (the timeout kill is uncatchable). Measured, not theoretical.
3. **Scoped tree + incremental diff + parallel content (now).** Enumerate **only the docs
   subtree** via the Git tree API (walk to its tree SHA, one recursive listing — a handful of
   REST calls regardless of repo size, never the whole monorepo). Diff the blobs' SHAs against
   a per-site **manifest** (`sites/{id}/.manifest.json`, path→blobSHA) so only changed/new files
   transfer and vanished ones are swept. Pull content in a bounded-concurrency pool that overlaps
   download and upload. **Content source splits on visibility:** public repos read file bytes
   from the **raw.githubusercontent CDN** (not REST-rate-limited, and safe under our concurrent
   burst — an unauthenticated public repo over the REST blobs API 403s on GitHub's secondary
   limit almost immediately); private repos use the authenticated REST blobs API (`raw` media
   type, 5000/hr via the token). Cost scales with the **diff**, not repo size.
   **Network resilience:** the per-file fetch retries not just rate-limit/5xx statuses but
   *thrown* errors too — under the concurrent burst a keep-alive socket gets dropped or a body
   stream aborted often enough that undici throws `TypeError: terminated` (seen on an
   image-heavy private monorepo: the whole sync failed at ~40 s before this). The fetch+body
   read sits in one try with a 60 s per-request timeout, retried with backoff, and concurrency
   is held at 12 so the pool sheds fewer sockets in the first place.
   Measured on `a large public docs.json repository` (1269 files): first sync **66 s**, an unchanged re-sync **1.3 s**
   (0 files moved). Pure planning logic (`src/lib/sync-plan.ts`: `planSync`, path filters) is
   extracted and unit-tested. The pure helper `extractTarGz` (`src/lib/tar.ts`) stays as the
   sparse-clone/Sandbox fallback for a pathological docs tree that exceeds the tree API's
   100k-entry single-response cap (we throw loudly rather than sync a silent partial set).
   **Note:** only the ~3-4 *enumeration* calls hit the REST budget now — at 5000/hr (prod token)
   that's effectively unlimited; the 60/hr *unauthenticated* dev ceiling only bites under heavy
   repeated local testing without a `GITHUB_TOKEN`.

**Sync reliability fixes (2026-06-26) — three bugs surfaced by a 231-file docs-PR merge that
rendered stale on a tenant (`Pixwel/platform`, monorepo, docs under `docs/`).**
1. **Manifest could drift ahead of storage with no self-heal.** The diff trusted
   `.manifest.json` as the record of what's in object storage and only refetched when a blob's
   SHA differed — never verifying the object exists. An interrupted/lost upload that still wrote
   the manifest left a file recorded-but-missing, and every re-sync was a correct no-op against
   the lying manifest (a real page, `workflows.md`, was missing from the bucket while re-syncs
   reported "0 files"). Recovery required hand-deleting the manifest in R2. **Fix:** `syncSite`
   now lists the bucket (`sites/{id}/`, one paginated LIST) and passes the present-paths set to
   `planSync`, which refetches anything **missing from storage** regardless of the manifest. Sync
   is now **self-healing**: the manifest is a fast-path hint, storage is the source of truth. (A
   per-repo sync lock to prevent the concurrent webhook↔manual race that *creates* drift is the
   remaining follow-up — flagged in `actions/sites.ts`.)
2. **Push-trigger silently dropped large merges.** `shouldSyncSite` gated on `pushTouchesDocs`,
   which reads the push payload's per-commit file lists — and GitHub **truncates** those on big
   merges/pushes. A "no docs changed" verdict from a truncated list is a false negative that
   skips the sync entirely (the merge never synced). **Fix:** the trigger no longer gates on the
   path filter — it syncs on tracked-branch + not-already-synced. A redundant sync is a cheap
   no-op (and now a correctness backstop via #1); a missed one strands a docs change. The path
   filter stays as an advisory helper; if monorepo no-op syncs clutter the feed, suppress
   0-change webhook deployments rather than re-introduce a data-losing gate.
3. **Re-syncing the same commit didn't refresh the render.** The render's content Data Cache is
   keyed on `lastSyncedCommitSha`; a re-sync of the *same* commit (force-push, manual re-pull, or
   the drift repair above) left the cache serving the pre-sync copy — pages newly visited under
   that sha read fresh while `docs.json` (sidebar + tabs) stayed cached, so a page rendered but
   its nav was stale. **Fix:** every successful sync bumps the site row's `updatedAt`, and the
   cache version folds it in (`request-source.ts`: `${sha}:${updatedAt}`), so any sync busts the
   cache even at an unchanged commit — no migration, no reliance on cross-instance `revalidateTag`.
   Regression tests: `tests/unit/sync-plan.test.ts` (storage-missing → refetch) and
   `tests/unit/github-webhook.test.ts` (non-docs push still syncs).

**Image dimensions captured at sync → `next/image` on the render path (landed 2026-06-16).**
Tenant content images rendered as a raw `<img>`: no lazy-loading, no format negotiation, and —
because markdown images carry no dimensions — layout shift as each one loaded. The fix routes
eligible images through **`next/image`** (AVIF/WebP negotiation + responsive `srcset` +
lazy-load), which needs intrinsic width/height. We capture those **once at sync time**, never
per request: `syncSite` measures each raster image's pixels with `image-size` (header-only, no
full decode, no native `sharp` dep) and writes a `sites/{id}/.dimensions.json` manifest beside
`.manifest.json` (`mergeAssetDimensions` carries dims forward across the *incremental* sync —
only refetched images are re-measured, vanished ones dropped). The render path reads it through
the same version-keyed `s3Source` cache (`loadAssetDimensions` on `ContentSource`; `fsSource`
measures from disk so the dogfood `docs/` and smoke fixtures exercise the identical path) and
hands it to the renderer. The `img` override (`packages/renderer/lib/mdx.tsx`) is **three-tier**,
so it never regresses: (1) *always* `loading="lazy" decoding="async"`; (2) set width/height
whenever known (no CLS); (3) upgrade to `next/image` only for **same-origin raster** images —
**gif** stays a plain `<img>` to keep animation, **svg** and **external-host** images stay plain
because the optimizer can't enumerate arbitrary remote hosts (no `remotePatterns` guessing).
Same-origin paths (`/api/tenant-asset/…`, or the host-rewritten `/img/…`) need no
`remotePatterns`; `next.config.mjs` only adds AVIF to the default WebP negotiation. **Why a
manifest, not a DB column:** it's migration-free, versioned with the synced commit, and
invalidates with the existing content tag. The chosen raster set and the merge logic are pure
helpers in `sync-plan.ts`, unit-tested.

**Image optimization, completed — literal `<img>` + subdomain optimizer (landed 2026-06-16).**
The first cut above only optimized *markdown* images. Two gaps surfaced on a real `<img>`-heavy
repo (hosted docs platforms authors lean on `<img>`, usually inside `<Frame>`), both fixed:
1. **Literal `<img>` bypassed the override.** MDX compiles a literal `<img>` to `_jsx("img", …)`
   — a literal tag that skips the components map — while markdown `![]()` compiles to
   `_jsx(_components.img, …)`. So `components.img = TenantImage` never saw HTML tags. A
   `remarkLiteralImg` plugin renames literal `<img>` mdast nodes to a registered component
   (`PvImg`), so they take the same `TenantImage` path. The `/images` smoke fixture only used
   markdown syntax, which is why this slipped the gate — it now also asserts a literal `<img>`
   in a `<Frame>` optimizes (distinct 200×100 fixture image as the guard).
2. **`next/image` was broken on subdomain hosts.** The optimizer fetches the source URL
   server-side *without* the tenant Host header, so a host-rewrite-dependent `/img/…` 404s in
   the optimizer → broken image. Subdomain mode passed `assetBase=""` (bare `/img/…`); apex
   path mode already used the host-independent `/api/tenant-asset/{slug}` route and worked. Both
   serving paths now use that slug-keyed route as the asset base — it carries the slug in the
   path, so browser and optimizer resolve it identically regardless of host. Result on a real
   subdomain: a 5,106 KiB PNG hero now serves as a 207 KiB AVIF.

**Persistent shell layout for tenant docs (landed 2026-06-16).** Every tenant page navigation
re-rendered and re-streamed the *entire* page — navbar, tabs, sidebar, assistant, AND article —
because `renderTenantDocs` was one page component with no layout; the sidebar flashed and lost
its scroll/expanded state on every click, unlike hosted docs platforms' fixed chrome. Split into a persistent
**shell** (`TenantDocsShell` — chrome + reader-auth gate) and a per-page **article**
(`TenantDocsArticle`), wired as a `layout.tsx`/`page.tsx` pair in a **`(docs)` route group at the
`[site]` level** (NOT at `[[...path]]`, whose catch-all param changes every navigation and would
re-render the shell). Same split for custom-domain docs. Added `loading.tsx` (a shared
`ArticleSkeleton`) so a navigation shows an instant skeleton in the persisted shell. The
reader-auth gate moved into the shell (param `{site}` only), so a gated login round-trips to the
site root rather than the exact deep page — acceptable for the v2/partial reader-auth (§11.2).
*Deferred:* full CDN/ISR caching of the render (hosted docs platforms serves edge-cached, prefetchable RSC).
Verified blocked by the reader-auth `cookies()` gate, which forces the whole route dynamic
(`no-store`) even for public sites — Next classifies a route static-or-dynamic, and one possible
`cookies()` taints it. Unblocking moves the gate to an **edge-native** chokepoint (Vercel Edge
Config rules + a self-verifying signed reader cookie — no DB, no experimental Node-middleware
runtime) so the render is pure and ISR-cacheable, while middleware — which Vercel runs on every
request, *including cache hits* — still enforces fine-grained per-page/per-group access. Full
design (and why fast + gated coexist) in **§11.2 → Planned**. Its own change, not yet done.

**Connect returns immediately; first sync runs in the background (landed 2026-06-15).** Even
scoped+parallel, a big first sync is ~60s, and `connectRepo` used to `await runSync` inline —
so the connect form sat on "Connecting…" for the whole sync. Now `connectRepo` pre-creates the
`building` deployment row, schedules the sync via `after()` (the same deferral the push webhook
uses, within the route's `maxDuration`), and returns the redirect target right away. The user
lands on the site Overview in ~validation-time (a few REST calls), where the Activity feed shows
the in-flight build and polls it to live/failed. `runSync` gained an optional `deploymentId` so
it resolves the pre-created row instead of inserting a second. Validation (repo exists, has a
`docs.json`) stays synchronous so form errors still surface in place — only the slow copy defers.
While that first build runs, the Overview swaps the live-preview iframe (which would 404 against
an unsynced site) for `BuildingPreview` — an animated "assembling your docs" wireframe that swaps
to the real preview the moment the sync finishes: instantly via the site's realtime channel (the
same Pusher/Soketi channel the Activity feed uses), with a brisk poll backstop for a fast sync
that finishes mid-redirect before the channel handshake completes. The realtime subscription +
poll fallback is centralized in `useSiteRealtime` / `useRealtimeRefresh` (src/lib/use-site-realtime.ts),
which the Activity feed also uses.

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
syncs *intermittently* 504'd. Measured after: ~0.4s warm / ~1.4s cold for `a starter docs.json repository`
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
  `docs.example.com` — no CORS ever.
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

Single config file at repo root. Mirror hosted docs platforms' schema so migration is trivial. Core shape:

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

**Schema strategy:** publish a JSON Schema; validate on sync; support the subset of hosted docs platforms keys we implement and warn (don't error) on unrecognized keys so hosted docs platforms configs work out of the box. Track schema parity in a compatibility matrix doc.

The `navigation` field is **one recursive tree** — tabs contain groups/anchors/versions/languages, which contain pages — matching hosted docs platforms' docs.json refactor. Model it as a single recursive TypeScript type.

**Themes & appearance:** `theme` selects a named visual preset — one of `mint` (default),
`maple`, `palm`, `willow`, `linden`, `almond`, `aspen`, `sequoia`, `luma` (hosted docs platforms' set).
Each preset is a small token bundle (font stacks, corner radius, …) applied as CSS variables
on `<html data-theme="…">`; unknown names fall back to `mint`. `appearance` controls
light/dark — `{ "default": "light" | "dark" | "system", "strict": boolean }`: `default` sets
the initial mode (a stored user toggle wins; `system` follows the OS), and `strict` hides the
light/dark switcher. `colors` (`primary`/`light`/`dark`) drives the brand accent independently
of the theme.

> **Landed (2026-06-28) — `favicon` + `appearance.strict` are now applied, not just parsed.**
> The `docs.json` schema always *tolerated* these fields (warn-don't-throw), but two were
> parsed and then ignored. Now:
> - **`favicon`** is emitted as `<link rel="icon">` from the **root layout's `<head>`**, which
>   already loads the per-request tenant config (so it covers apex docs + every tenant mode).
>   A `{ light, dark }` pair emits one link per `prefers-color-scheme` (hosted docs platforms' convention);
>   a single string emits one. Paths resolve through the tenant asset proxy via a new
>   `requestAssetBase()` (mirrors `requestContentSource`'s resolution, gated on a non-null
>   source so the slug is guaranteed — the path must match the config source or it 404s).
> - **`appearance.strict`** hides the `<ThemeToggle>` (Navbar) **and** makes the pre-paint
>   theme script ignore the stored choice, pinning the mode to `default`. The pre-paint script
>   and the toggle-visibility rule now share one pure module (`appearance.ts`,
>   `appearanceInitScript` + `themeToggleHidden`) so they can't drift and are unit-tested.
>
> Verified: smoke home check asserts the favicon links + toggle; unit tests cover the script
> + predicate; in-browser the favicon links resolve through `/api/tenant-asset/…` (200,
> `image/*`) and a temporarily-strict config dropped the toggle. Real hosted docs platforms repo (string
> favicon) + dogfood docs crawl clean (0 × HTTP 500). Still unapplied (parsed-only):
> `fonts`, `icons`, `background`, `styling`, `logo.href`, `thumbnails`.

---

## 5. MDX Component Library (v1)

Ship a styled component set resolved at compile time. Parity targets with hosted docs platforms:

| Component | Notes |
|---|---|
| `<Card>` / `<CardGroup>` / `<Columns>` | linkable cards w/ icon; `<Columns>` is hosted docs platforms' current name for the grid, `<CardGroup>` the legacy alias |
| `<Tabs>` / `<Tab>` | tabbed content |
| `<Accordion>` / `<AccordionGroup>` | collapsible |
| `<Steps>` / `<Step>` | numbered walkthroughs |
| `<Note>` `<Warning>` `<Info>` `<Tip>` `<Check>` | callouts |
| `<CodeGroup>` | multi-language code tabs |
| Code blocks | Shiki syntax highlighting, copy button, titles, line highlights |
| `<Frame>` | image/embed framing w/ caption |
| `<Tooltip>` `<Expandable>` `<Icon>` | inline helpers |
| Mermaid | diagrams — ```mermaid fences → client-rendered SVG (BUILT 2026-06-29) |
| `<ParamField>` `<ResponseField>` | API param docs |
| `<Update>` | changelog entries |

> **Mermaid — BUILT (2026-06-29).** A ```mermaid fence renders as a diagram, not a highlighted
> code block. A remark plugin (`remarkMermaid` in `packages/renderer/lib/mdx.tsx`) rewrites the
> mdast `code` node to a `<Mermaid chart="…">` JSX element **before** third-party MDX serializer's Shiki pass,
> so Shiki never touches it; the raw source rides as a string attribute, which MDX lowers to a JS
> string literal (`_jsx(Mermaid, { chart: "…" })`), escaping newlines/`<br/>`/quotes for free.
> `<Mermaid>` (`components/mdx/Mermaid.tsx`) is a `"use client"` component that **dynamic-imports
> mermaid inside its effect** — the heavy lib loads only on pages that actually have a diagram, not
> in every page's bundle — and re-renders on the docs light/dark toggle (a MutationObserver on the
> `.dark` class). `securityLevel: "antiscript"` keeps htmlLabels (so `<br/>`/`<i>` node labels
> render, matching hosted docs platforms) while stripping `<script>`, so a diagram can't introduce a script
> vector the rest of the renderer disallows. A parse failure degrades to the diagram source in a
> `<pre>` — never a 500. Added as a **direct** dependency (was only transitive via `streamdown`).
> Cache key bumped `mdx-compile-v2` → `v3`. Guard: a `mermaid` smoke fixture asserts the page SSRs
> an `aria-label="Diagram"` container and that the chart source is absent from the HTML (i.e. not
> a code block).

- **Theming:** named theme presets (`theme` in docs.json — `mint`/`maple`/`palm`/`willow`/`linden`/`almond`/`aspen`/`sequoia`/`luma`, hosted docs platforms' set) defined as token bundles in `src/lib/theme.ts` and applied as CSS variables on `<html data-theme="…">`, so the whole UI re-skins from one config value. Adding/tuning a theme = one registry entry (+ optional CSS keyed on `[data-theme="…"]`). Brand accent from `docs.json` `colors`; light/dark default from `appearance.default`.
- **Markdown features:** GFM, footnotes, auto-linked headings, frontmatter (title, description, icon, sidebar overrides), `og:` image generation per page.
- **Page chrome (docs platform parity):**
  - Top-level `navigation.tabs` render as a horizontal **tab bar**; the sidebar is **scoped
    to the active tab** (the one containing the current page). Nested groups are collapsible.
  - **Section eyebrow:** the group label the page belongs to is shown in the primary color
    above the page `<h1>`.
  - **"On this page" TOC** with scroll-spy — the heading currently in view is highlighted
    (IntersectionObserver) and the panel stays sticky below the navbar + tab bar.
  - **Default appearance is light** (matches hosted docs platforms); the OS preference is not followed
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

> **Index caching (2026-06-29).** The Orama index is built by re-reading every page, but it was
> only React-`cache`d — i.e. rebuilt *per request*. Since `/api/search` fires once per
> keystroke-debounce, every keystroke re-read the whole site (the "search got slow after we gated
> by group permissions" report — the per-page gate is actually applied cheaply per *query* on a
> reader-independent index; it just made the pre-existing per-request rebuild more noticeable).
> Fix: the index is reader-independent and changes only on (re-)sync, so cache the built Orama
> instance **in-process, keyed by content version** (`siteId:sha:updatedAt`, from
> `requestSearchIndexKey`) — built once per version per process, reused across keystrokes; a
> re-sync changes the key → rebuild. The Orama object isn't JSON-serializable, so it's a bounded
> in-process `Map` (LRU, 32 entries), not the Data Cache. No version key (apex / `papervine dev`,
> edited live) keeps the per-request build so edits stay fresh. Measured on a large public docs.json repository (local
> prod build): first query 735 ms (build) → subsequent ~8 ms (reuse), vs 735 ms *every* query
> before. The assistant + public-MCP RAG (`docs-tools.searchDocs`) get the same cache: the version
> key also rides an AsyncLocalStorage (`withSearchIndexKey`, set by those live routes alongside
> `contentContext`/`accessContext`), so a nested `runSearch` reuses the index without threading the
> key through every streamed tool call. The **draft** routes (editor/authoring agents) deliberately
> don't set it — their content changes live, so they stay per-request. Deferred (still): build the
> index at sync time + persist it (Orama persistence plugin → S3), so even the first query on a cold
> serverless instance is warm — its own scoped task, marginal over the in-process cache.

---

## 7. API Playground (v1)

- **Input:** OpenAPI 3.0+ (YAML/JSON) and AsyncAPI; referenced from `docs.json` (`"openapi": "..."`).
- **Generation (at sync time):** parse spec → one page per operation (grouped by tag in the nav), with:
  - method + path header, description, auth requirements
  - request param/body docs (`<ParamField>`), schema explorer
  - response schemas + examples (`<ResponseField>`)
  - **interactive "Try it"** panel: fill params/headers/body, send request, see response
- **Auth methods:** API key, Bearer, Basic, OAuth2 (config-driven).
- **CORS/proxy:** requests can route through a Papervine proxy endpoint to avoid CORS and to inject secrets safely (optional per tenant).
- **Code samples:** auto-generate curl/JS/Python/etc. snippets per endpoint.
- Libraries to evaluate: `openapi-types`, `@scalar/*` (open-source API reference, worth studying/reusing), `openapi-sampler`.

> **`Accept` header (2026-06-29).** "Try it" (and the static cURL/JS/Python samples) now send an
> `Accept` header derived from what the operation **produces** — the union of media types under
> its responses' `content`, deduped, preferring `application/json` (new `op.produces` in the
> parser). Many real APIs (e.g. Pixwel's) return 406 / HTML without it, yet specs almost never
> declare `Accept` as an explicit parameter, so the playground sent no `Accept` and the request
> failed. It's injected as a normal, pre-filled + editable header field (so it shows in the
> Headers section and the samples), and skipped when the spec already declares its own `Accept`.
> Unit-tested (`openapi-produces`); verified in-browser against the real Pixwel spec
> (`GET /assets` → `Accept: application/json` in the modal + cURL).

> **Status — endpoint pages render for synced tenants (2026-06-28).** The OpenAPI page
> generator (`@scalar/openapi-parser` parse/dereference → one in-nav, in-theme page per
> operation, our `EndpointReference` renderer) was reading the spec with a direct
> `fs.readFile(CONTENT_DIR, …)`. That only ever resolved for a local `papervine dev` preview
> (filesystem); a **connected tenant**, whose content lives in object storage, has no
> `CONTENT_DIR`, so its API Reference pages silently 404'd. Fix: added `loadRaw(relPath)` to
> the `ContentSource` seam (`fsSource` → disk with a traversal guard; `s3Source` → the same
> version-keyed Data Cache as pages/config; `draftSource` → falls through to the synced base —
> specs aren't draftable) and routed `openapi.ts`'s `loadSpec` through it, deleting the stray
> `CONTENT_DIR`. The tenant render path (`TenantDocsArticle`) now mirrors the apex route: a
> slug that isn't an MDX page falls through to `loadApiCatalog().get(slug)` → `EndpointReference`.
> Verified in-browser on the synced `papervine/starter` site (Widgets API, four operations).
> The lingering `PAPERVINE_CONTENT`/`CONTENT_DIR` concept is legitimate (it's how `fsSource`
> roots a local preview); the bug was code reaching past the source abstraction to touch it.

> **Status — reference page reshaped into a modern docs-platform three-pane (2026-06-28).** The
> endpoint page now matches hosted docs platforms' API reference layout: (1) **left-nav method badges** —
> each operation leaf carries its HTTP method (`NavLeaf.method`, stamped in `openapiLeaves`) and
> the sidebar renders a colored verb beside it, sharing one `method-colors.ts` map with the
> endpoint header so a `GET` reads the same green everywhere; (2) a **language-tabbed request
> panel** (cURL / JavaScript / Python) plus a **per-status response panel**, both highlighted
> server-side with Shiki (`highlight.ts`, a standalone `github-dark` highlighter — the right
> column is always dark, hosted docs platforms' model — kept off the client so the highlighter never ships
> in the bundle); (3) a read-only right rail (`ApiPlayground.tsx`) showing those samples + a
> per-status response tab. The `papervine/starter` Widgets spec points `servers` at an echo
> (`httpbin.org/anything`) so the live demo returns a real 200 you can see.

> **Status — left-nav groups operations by tag (2026-06-28).** Auto-generated OpenAPI nav
> (`openapiLeaves`, no explicit `pages`) was a **flat** list of every operation — a 40-endpoint
> spec was 40 ungrouped rows. It now mirrors hosted docs platforms: operations are bucketed by their first
> OpenAPI `tag` into one `NavNode` per tag (tags in first-encounter = spec order; untagged
> operations stay as bare leaves above the groups). A spec with **no** tags falls through to the
> old flat list, so nothing regresses for untagged specs. The tag nodes are marked
> `collapsible: true`, so each tag is **collapse/expand-able by chevron** even at the top level
> (a long API folds by tag) — `Sidebar`'s `TopGroup` gained a collapsible variant (expanded by
> default, keeping its bold top-level styling) since these groups commonly render at depth 0
> (`openapi` referenced directly on a tab); nested groups were already collapsible. Method badges
> render on each leaf as before. Unit-tested (`nav-openapi-tags.test.ts`: grouping, order,
> untagged-leaves, no-tags fallback, `collapsible` flag) and exercised in the fixtures smoke.
> Verified in-browser: the tag group is a chevron toggle that hides/shows its operations (DOM
> op-count 4 → 1 → 4 across collapse/expand, `aria-expanded` flips).

> **Status — "Try it" promoted to a full modal playground (2026-06-28).** The interactive
> playground moved off the right rail onto a **green trigger on the center endpoint bar** that
> opens a modal (`ApiTryItModal.tsx`, the one client island; portaled to `<body>`, Esc/backdrop
> close, scroll-locked), matching hosted docs platforms' full-screen Try-it. The modal **encompasses every
> OpenAPI input class**: an editable URL (server base + path), and collapsible **Authorization /
> Headers / Path / Query / Body** sections. Auth required extending the `Operation` model with a
> resolved `auth: AuthScheme[]` (`resolveAuth` reads `components.securitySchemes` against the
> op's `security`, falling back to the root): basic → username + password, bearer/oauth2 → a
> token, apiKey → a header/query value — folded into the request at send time (basic → base64
> `Authorization`, bearer → `Bearer …`, apiKey → its header/query). The right half shows a
> **live** request sample (cURL / JS / Python, regenerated from the inputs and lightly colorized
> client-side — no Shiki on the client) and the response (status + colorized JSON). An operation
> switcher (top-left) lists sibling ops on the same spec. `fetch` is real; CORS still degrades to
> an inline notice. Verified in-browser on `starter` (bearer-auth section, live send echoing
> `color=red`, 200).

---

## 8. AI Assistant (M5)

A conversational assistant over the tenant's docs + OpenAPI, modeled on hosted docs platforms'
"Ask Assistant" (right-hand slide-out panel). Verified behaviors we target are
cited from hosted docs platforms' own docs/blog where noted.

> **Status — slice 1 built (2026-06-08):** agentic `/api/assistant` route (Claude via
> Vercel AI SDK v6 + tool calling over `searchDocs`/`readPage`/`listPages`/`searchApi`
> in `src/lib/assistant-tools.ts`), slide-out panel (`src/components/assistant/`) using
> `useChat` + `streamdown`, navbar "Ask Assistant" button, `Cmd/Ctrl-I`, and
> `?assistant=` deep link. Requires `ANTHROPIC_API_KEY` (graceful 503 without it).
> **Next:** dedicated `Sources` citation UI, multi-modal attach, current-page context
> polish, embeddings-backed `searchDocs`.

### 8.1 Architecture: agentic retrieval, not single-shot RAG

Modern docs assistants are **agentic RAG with tool calling**: the model decides how to search
the docs per question rather than doing one top-k lookup, and it can navigate a docs corpus
through filesystem-like tools over indexed content. We adopt the same shape — and it's cheap
for us because **the tools are thin wrappers
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
  as starting context (hosted docs platforms does this), so "how do I do *this*?" resolves locally.
- **Guardrails:** answer only from tool results; cite every claim; say "I don't know"
  and surface the tenant's **deflection email** (configurable, like hosted docs platforms) when
  confidence is low. Per-tenant rate limits + token budget.

### 8.2 UI — built on AI Elements

Use **[AI Elements](https://elements.ai-sdk.dev/)** (shadcn/ui + Vercel AI SDK
components) so we don't hand-roll chat UI:

- `Conversation` + `Message` — the transcript
- `Response` — streaming markdown (renders our same MDX-ish content, code blocks)
- `Sources` — the cited pages/anchors under each answer (navigable, like hosted docs platforms)
- `PromptInput` — the "Ask a question…" box with file/image attach (the paperclip in
  the reference screenshot — multi-modal input, which Claude supports)
- `Suggestions` — starter / follow-up questions
- `Reasoning` / `Chain of Thought` — optional, to show tool-call/search steps

Chrome: a right-hand **slide-out panel** ("Assistant", expand + close), an **"Ask
Assistant"** button in the navbar, and the disclaimer "Responses are generated using AI
and may contain mistakes." Themed via our CSS variables (matches the docs site).

### 8.3 Invocation (match hosted docs platforms)

- **"Ask Assistant"** navbar button → opens the panel.
- **Keyboard:** `Cmd/Ctrl-I` (hosted docs platforms' shortcut). `Cmd-K` stays search; the two are
  distinct surfaces.
- **Text selection:** "Ask about this" on highlighted text.
- **Deep link:** `?assistant=YOUR_QUERY` on any page auto-opens the panel and asks —
  used for "Ask AI" links and shareable answers.

### 8.4 Indexing & freshness

- Index **published pages + OpenAPI specs** at sync time (M2); re-index changed pages
  on publish. Exclude `hidden`/`noindex` pages unless `docs.json` `seo.indexing: "all"`
  (hosted docs platforms' exact toggle; we already parse `hidden`/`noindex` frontmatter).

### 8.5 Surfaces beyond the docs site

- `/api/assistant` SSE endpoint (AI SDK data stream). Offer a docs.json-compatible alias
  path so existing integrations port over.
- **Embeddable** in external apps/portals; **Slack + Discord bots** later (hosted docs platforms has
  both).
- **Shared tool layer = the planned per-docs MCP server:** `search_docs` / `read_page` /
  `list_pages` / `search_api` are exactly the tools a generated read-MCP would expose, so
  the in-docs assistant and the MCP server become one implementation, two transports.

### 8.6 Control-plane page: Assistant settings

The dashboard page where a docs owner manages the assistant (hosted docs platforms: **Automate →
Assistant**). Top of page shows three **overview cards** — *Total questions*, *Answered
properly*, *Not answered* — each with a month-over-month delta, plus a "Get insights into
your Assistant usage → View more" card linking to the **Analytics** page (§10.1).

Settings, grouped as hosted docs platforms groups them:

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
  (hosted docs platforms shows "available for enterprise plans / Contact Sales"); gating is config, not
  hardcoded, so self-hosters get everything.

**Where each setting lives.** Published-behavior config (starter questions, deflection
email + help button, search domains) is **version-controlled in `docs.json`'s `assistant`
block** — the dashboard edits it through the authoring layer (§9.2) so it stays in Git.
Operational/metering state (enable toggle, CAPTCHA, credits, plan) lives in our **DB** for
instant effect. Self-host reads it all from `docs.json` + env, no dashboard required.

> **Operational toggles wired (2026-06-30).** The two DB-state toggles — *Assistant Status*
> (the enable/disable kill switch, with the Active/Inactive badge) and *Invisible CAPTCHA* —
> now persist. They follow the exact reader-auth pattern (SPEC §11.2): new `site` columns
> `assistant_enabled` / `assistant_captcha_enabled` (both default `true`, migration 0012),
> URL-scoped server actions (`setAssistantEnabled` / `setAssistantCaptchaEnabled` in
> `automate/assistant/actions.ts`) that re-authorize via `findSite`, write the row, then
> `revalidateSiteRow` + `revalidatePath` so a toggle takes effect without the cached-row TTL
> lag. The switches are optimistic client components (`AssistantControls.tsx`) that roll back
> on a failed action. The published-behavior toggles (deflection, search domains, starter
> questions) stay scaffold here on purpose — they're `docs.json`-backed and belong on the
> authoring layer (§9.2), not in DB columns; wiring them is a follow-up once that write path
> is exposed from this page. Search Domains remains plan-gated (enterprise). Covered by
> `tests/e2e/assistant.spec.ts` (toggle → persist → reload round-trip).
>
> **Kill switch now enforced (2026-06-30).** Persisting the toggle wasn't enough — the docs site
> never read `assistant_enabled`, so disabling it still showed the "Ask Assistant" launcher on
> prod. Enforcement landed at both read points, mirroring the `authEnabled` gate: `TenantDocsShell`
> (`render-tenant.tsx`) skips mounting `<AskAssistantButton>` and `<Assistant>` when the row's flag
> is off, and `POST /api/assistant` returns **403** for a positively-resolved disabled tenant (so
> hiding the launcher can't be bypassed by calling the endpoint). Both resolve the row via a new
> `requestSiteRecord` helper (`request-source.ts`), the same tenant resolution the content source
> uses; the apex/preview host (no row) keeps the platform's own docs assistant working. The 403 sits
> *after* the `ANTHROPIC_API_KEY` 503 check so the DB-free smoke (no key → 503 before any DB read)
> is unaffected. Regression: `tests/e2e/tenant-render.spec.ts` asserts a disabled site renders but
> hides the launcher. **CAPTCHA is still not enforced** — `assistant_captcha_enabled` persists but
> there's no hCaptcha integration on `/api/assistant` yet (separate follow-up).

---

## 9. MCP Servers

Papervine exposes Model Context Protocol servers so AI tools can both **read** a docs site
and **edit** it — mirroring hosted docs platforms, which ships two distinct MCP servers.

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

Lets a docs *owner* connect an AI tool to **edit their docs** (matches hosted docs platforms' Admin
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

**One backend, two front-ends (verified against docs-agent authoring flows, 2026-06-09).** The authoring MCP
and the web editor (§10) are *not* separate write paths — they operate on the **same session
branch and the same server-side draft buffer**. The agent checkout flow returns an
`editorUrl` so a user can follow along in the dashboard editor on that same branch; edits
buffer on the session branch in real time, persist server-side across tabs/devices, and
only reach the deploy branch on `save`/publish (direct commit if on the deploy branch, else a
PR with a returned link). **Build implication:** build the authoring layer (GitHub-App write
creds → session-branch + draft buffer → `save` as commit-or-PR) **once**, then put both the
MCP and the web editor on top of it. The draft buffer is real persistent state, not a
commit-on-save shortcut. The "any action a user can take, an agent can too" framing is
ours (AGENTS.md), and the implementation keeps that contract by sharing the write path.

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
> **Editor opens on the deploy branch by default (2026-06-29).** The editor landed each session
> on a freshly-minted `papervine/edit-xxxx` branch (the top-left picker showed a random working
> branch). hosted docs platforms instead opens on the configured deploy branch shown as **"Default"** — you
> edit it directly and Publish commits straight to it; a working branch is an explicit
> "Create new branch" action that publishes as a PR. We match that now: `editor/page.tsx`
> defaults `branch` to `siteRow.branch` (no eager `checkoutBranch`), so a clean load creates no
> branch and reads the synced content; the draft session is created lazily on the first edit
> (`saveDraft` auto-checks-out), keyed on the deploy branch. The branch only matters at publish,
> where the existing two modes already fit: on the deploy branch Publish **commits** (the
> `publishModeForBranch` rule, `src/lib/publish-mode.ts`), on a working branch it opens a **PR**.
> No backend change — sessions were always keyed by an arbitrary branch name; the deploy branch
> is just another valid key, and commit-mode publish already targets `session.baseBranch`. Guard:
> `tests/unit/publish-mode.test.ts` + the e2e editor spec now asserts the default landing is `main`.
>
> **Source/Preview mode persists across page switches (2026-06-29).** The editor pane is `key`ed
> by page, so it remounts on every nav click — and its mode was pane-local `useState`, snapping
> back to Source each time you clicked another page. Lifted the `Source ⇄ Preview` state up to
> `EditorShell` (passed to `MdxEditorPane` as `mode`/`onModeChange`), so the chosen mode survives
> the remount: click a page in Preview and you stay in rendered Preview, in Source you stay in
> source. Safe because Preview never holds an unsaved edit (entering it flushes; the textarea
> isn't mounted there). Guard: the e2e editor spec switches pages in each mode and asserts it sticks.
>
> **Flush the draft before switching pages (2026-06-29).** Same remount: a keystroke still inside
> the pane's 700ms autosave debounce was *dropped* on a fast nav click — the unmount cleanup cleared
> the timer without saving. The pane now exposes an imperative `flush()` (`MdxEditorHandle`), and
> `EditorShell` awaits it before a **user-initiated** switch (nav click / branch switch) so the
> pending edit lands on the *current* page's path (the pane's `onSave` is still bound to it at that
> point). The agent-write refresh deliberately passes `flush:false` — there the agent's just-written
> draft is the newer content and must win, not the human's stale buffer. Guard: the e2e editor spec
> types and switches pages faster than the debounce, asserting the edit survives.
>
> **Agent column is on-demand (2026-06-29).** The editing-agent column took a fixed third of the
> editor even when unused. It's now **hidden by default** and summoned via an "Ask agent" header
> button or **⌘/Ctrl-I** (hosted docs platforms' shortcut) — closeable from the button, the panel's ✕, or the
> shortcut. Toggled by CSS visibility (not unmount) in `EditorShell`, so the chat history survives a
> close→reopen; default-collapsed gives the page/preview the full width.
>
> **Publish result is a toast (2026-06-30).** The Publish outcome (PR link / commit sha / error)
> rendered as a persistent inline banner under the button that never cleared. Now a toast: we use
> **shadcn's sonner** (`src/components/ui/sonner.tsx`, `add @shadcn/sonner`) — the project is shadcn,
> so this is a registry component, not a bespoke one. The stock wrapper themes via `next-themes`
> (unused here); ours reads the **platform `data-db-theme`** instead and re-renders on toggle, carries
> **`db-portal`** so sonner's body-portaled container re-resolves the `.db` palette/fonts (same as
> `dialog.tsx`), and enables `richColors` for green/red success/error. `<Toaster>` mounts in
> `EditorShell`; `PublishButton` calls `toast.success/error` (errors get a longer 8s duration).
> Reusable for other surfaces (settings forms still use inline banners) later.
>
> **PR-mode publish commits on the branch tip, not the deploy head (fixed 2026-06-30).** PR mode
> always parented the new commit on the *deploy* head (`base.commitSha`/`base.treeSha`) and then
> `updateRef(force:false)` the working branch to it. Fine for a *fresh* branch (it's at the deploy
> head), but a **re-publish** (or any pre-existing working branch that already carried commits)
> forked a **sibling** commit off the deploy base — so `updateRef` correctly rejected it with
> `422 "Update is not a fast forward"`. Fix: after `createBranch`, when it reports `alreadyExists`,
> read the **working branch's current tip** (`getRef(branch)`) and base the commit on that, so each
> publish stacks on top and re-publishing is idempotent. (Surfaced on Pixwel/platform; the earlier
> `createTree 403` / `createBranch 422` they hit were the App's missing Contents-write + repo
> rulesets, not this.) Guard: `tests/unit/authoring-publish.test.ts` asserts an existing-branch
> re-publish commits on the branch tip, a fresh one on the deploy base.
>
> **WYSIWYG "Visual" editor — reversed the MDXEditor decision & shipped (2026-07-02).** We now
> ship an editable **Visual** mode alongside Source (the earlier note dropped WYSIWYG; this
> reverses it, matching hosted docs platforms — who use TipTap). The keystone is a new pure package
> **`@papervine/mdx-prosemirror`**: bidirectional MDX↔ProseMirror where the **canonical value is
> the raw MDX text** (byte-exact git commits stay the source of truth) and anything the editor
> can't model (custom components, `{expressions}`, imports, expression-valued attrs) is preserved
> **verbatim** via `mdxUnknown*` nodes — the renderer's Fallback philosophy applied to editing.
> Round-trip is **idempotent** (gated by `mdx-prosemirror-roundtrip` + a `mdx-prosemirror-corpus`
> test that runs every `docs/*.mdx` through the converter) and validated against a real TipTap
> instance in jsdom (`mdx-prosemirror-tiptap`). The editor (`VisualEditor.tsx` + `visual/`) builds
> on **open-source TipTap v3** (not the paid Notion template) with node views rendering the *real*
> renderer components (`@papervine/renderer/components/mdx/editor-registry`), and Notion-style UX:
> a `/` slash palette + a "+" **block picker** (both from one categorized item set; the slash menu
> is a **controlled popover**, not `ReactRenderer` — that hits React 19's flushSync-in-render), a
> selection **bubble menu**, **drag handles** with a Turn-into/Duplicate/Delete **block menu**, and
> an editable **frontmatter header** (title/description). The pane toolbar is Visual · Source · Diff
> (full-pane draft⇄published diff) · Copy-markdown, with `⌘⇧M`/`⌘⇧D`. Editor **opens in Visual by
> default**. Nav-item cogs open **Page settings** (frontmatter via `gray-matter`) and **Group
> settings** (`docs.json` patch); to make those effective the renderer now honors page `icon`/`tag`/
> external `url` and group `hidden`/`expanded`/`tag` in the sidebar (`nav.ts` + `Sidebar.tsx`, gated
> by `nav-page-group-settings`). **Deferred:** per-page `<head>` metadata for
> `og:image`/`keywords`/`noindex` + page `mode` layout.
>
> **Real-time collaboration — shipped (2026-07-07).** Took the deferred step above. The
> canonical value is a per-page **`Y.Text("mdx")`** holding the whole raw MDX file; both panes are
> projections of it (text stays canonical → git byte-exact, unknown MDX never breaks). Keystone is
> **`textDiff`** (in `@papervine/mdx-prosemirror`): a pane pushes a full new string, we splice only
> the minimal changed range into the `Y.Text` — never a whole-doc replace, so a collaborator's
> concurrent edit + cursor survive (`collab-ytext-sync` proves two edits to different regions both
> merge). **Two transports behind one interface, chosen at runtime, strict-enhancement:** same-
> browser tabs sync over a ~40-line **BroadcastChannel** provider (zero infra, the fallback when
> collab is unconfigured — CI/bare checkout never 500s); real cross-machine multiplayer runs over a
> **standalone Hocuspocus (Yjs) service, `apps/collab`** — the always-on socket Vercel can't host.
> **Auth:** the Next app runs `gateEditor` then mints a ~5-min **HS256 room token**
> (`COLLAB_JWT_SECRET`, sub = `${siteId}:${branch}:${path}`); the service holds no Better Auth and
> no content pipeline — it verifies the token, checks the room matches, and relays. Persistence is
> the existing debounced `saveDraft` (text-canonical); the first client **seeds the doc from the
> page's draft**, so the service is stateless coordination — a restart just re-seeds, no data loss
> (binary `Y.Doc` persistence via `@hocuspocus/extension-database` is a clean later add). Presence
> rides Hocuspocus **awareness** (or the bc peer map). Verified cross-browser (two profiles): edits
> both ways + Visual reprojection + presence, over the socket. Guards: `textDiff` (19),
> `collab-ytext-sync` (4), `collab-token` (5 — forgery/expiry/room-replay).
>
> **Hosting decision (2026-07-07): self-host Hocuspocus, not a managed Yjs SaaS.** The service is
> one MIT container (`docker-compose` `collab` locally; a `$5` Fly/Railway/Render machine or any
> container host in prod; `crossws` makes it portable to Bun/Deno/CF Workers). We considered the
> Vercel Marketplace one-click partner **Liveblocks** (fully-managed Yjs) and rejected it *as the
> default* for a decisive reason: **you can't self-host Liveblocks**, so collab-on-Liveblocks would
> break Papervine's OSS self-host story (§13). A managed Yjs host (Liveblocks / y-sweet) stays a
> valid *optional hosted-tier* choice behind the same provider seam — never the foundation. This
> is a different problem from the Activity feed's Pusher/Soketi choice (§10.3): that relays content-
> free pings; a document needs stateful sync (correct join-state, awareness, and state transfer that
> would blow past Pusher's ~10KB message cap — which *diverges* between hosted Pusher and self-host
> Soketi), so a purpose-built Yjs server is the right tool here. **Deferred:** binary CRDT
> persistence; real display names in presence.
>
> **Source mode is CodeMirror now — remote cursors + no caret jump (2026-07-08).** Took the
> deferred CodeMirror step. Source mode is CodeMirror 6 bound DIRECTLY to the shared `Y.Text` via
> `y-codemirror.next` (`SourceEditor.tsx`), replacing the `value`/`onChange` textarea. Two wins the
> textarea couldn't give: (1) **no caret jump** — a remote insert before your cursor maps your
> selection through the CRDT, so your caret stays on the same logical character; (2) **remote
> cursors** — every other editor's caret + selection render in their presence colour + name (from
> awareness). To feed CodeMirror, `useCollabDoc` now exposes the `Y.Text` and a `y-protocols`
> Awareness (the Hocuspocus provider's, or a local-only one for the BroadcastChannel fallback —
> which gets the caret-jump fix but no shared cursors, being same-browser). Persistence is
> unchanged: CodeMirror writes the `Y.Text` with its own txn origin, so the pane's existing
> observer debounce-saves it exactly like a remote edit. Verified across two browser profiles:
> live sync, a colour+name remote caret, and a caret that holds position when the other side
> inserts above it (the textarea's wart, gone).
>
> **Visual mode gets remote carets too — a custom projection, no y-prosemirror (2026-07-09).**
> The paved path for PM cursors (`y-prosemirror`'s `yCursorPlugin`) requires ProseMirror to be the
> canonical CRDT bound to a `Y.XmlFragment` — which we deliberately *don't* do (raw MDX `Y.Text` is
> canonical, Visual is a projection; see the text-canonical decision above). So there is no
> off-the-shelf package that renders a Y.Text-offset cursor inside a ProseMirror projection. The
> insight that makes a custom one cheap: **every client projects the same MDX body to the same
> deterministic PM doc, so a raw ProseMirror position means the same place in every Visual editor** —
> no source-offset↔PM mapping needed for the Visual↔Visual case. `CollabCarets.ts` is a TipTap
> extension whose PM plugin (1) writes the local selection (`{anchor, head}` in PM coords) to a
> `visualCursor` awareness field on every selection/doc change, and (2) renders every *other*
> client's `visualCursor` as a `Decoration.widget` caret (colour + name label) plus a
> `Decoration.inline` selection band, refreshing on the awareness `change` event. It reuses the
> **same Awareness** `useCollabDoc` already exposes for CodeMirror, so presence colour/name are
> shared across both panes. Scope: **Visual↔Visual** — a Source-mode peer's caret lives in Y.Text
> offset space and doesn't cross into PM coords without a source-offset bridge (deferred; the field
> is simply absent so no caret shows, never a wrong one). During simultaneous typing a remote caret
> can lag by the size of not-yet-synced edits and self-corrects on the next projection — accepted as
> cosmetic. Verified across two browser profiles: bidirectional colour+name carets that track the
> other side's selection as it moves through the doc.
>
> Token-scoped *external* auth for the authoring MCP (a platform-auth PAT, §11) is the
> follow-up; today it authenticates via the app-host session + `x-papervine-org/site` headers.

---

## 10. Dashboard / Control Plane (supporting v1)

Minimum to operate the SaaS:
- **Auth:** org + user accounts via **Better Auth** (see §11). RBAC: owner/admin/editor/viewer.
- **Workspace / site switcher:** an org may own several sites (§2), so the dashboard's
  **top-left switcher** selects the **active site** that per-site pages (Analytics, Editor,
  Settings) scope to — mirrors hosted docs platforms' top-left switcher. Lists the sites the user can
  access + a **New site** action. *(Status 2026-06-10: the control plane is now
  **URL-scoped on its own host**, mirroring hosted docs platforms' `app.example.com/{org}/{site}`.
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
  `starter-docs` — were indistinguishable). The mark now derives a per-site
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
  *(Status 2026-06-15: Sentry is now **gated to real deployments** — `enabled:
  process.env.NODE_ENV === "production"` across the client/server/edge configs. `next dev`
  was shipping local events into the prod project (forced test throws + corrupted-`.next`
  chunk errors → PAPERVINE-5/6/7/8), burying real signal. Vercel runs prod *and* preview at
  `NODE_ENV=production`, so both still report, separated by the `environment` tag.)*
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

The control-plane **Analytics** page (hosted docs platforms: *Analytics*) — scoped to the **active site**
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
> visitor; distinct clients stay distinct. Matching hosted docs platforms, the Agents tab keeps just two
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
docs instead of just rendering them. All three mirror hosted docs platforms' "Automate" area and are
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
  (matching hosted docs platforms, which built Agent as a Slack app first): you invoke it with
  `@papervine <prompt>` in a channel; steady state is a connected Slack app that answers
  questions and opens doc changes on request. Shares the authoring backend with Workflows;
  the distinction is **interactive (Agent) vs scheduled/triggered (Workflows)**, same
  underlying tools.
  - *Agent settings page (2026-06-30).* Reworked the scaffold from the single-shot "Send
    your first message" onboarding to an **integrations gallery** matching the reference:
    a `Connect your Slack workspace` banner (Install Slack app, "Not connected" status),
    an **Enabled integrations** list (empty state until a connector is wired), and an
    **Available to your team** catalog — Notion, Google Drive, Google Calendar, Linear,
    Slack, Plain, Intercom, Salesforce, Jira, Confluence, HubSpot — each tagged by category
    (documentation / communication / project management / customer support / CRM) with an
    inert `+ Connect`. The catalog + hand-built brand SVGs live in
    `src/components/app/automate/integrations.tsx` (no brand-icon dep — we only ship
    lucide-react); the page (`…/automate/agent/page.tsx`) is presentational. Verified
    in-browser, light + dark platform theme.
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

The **per-site landing page** — what you see on entering a connected site (hosted docs platforms'
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
  (`docs.example.com ↗`, §2 custom domains), the **repo** (`org/repo ↗`), and the **branch**.
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

The control-plane **Settings → Exports** surface (hosted docs platforms: *Settings → Exports*) lets an
owner download the whole site as **one PDF for offline viewing** — "Export all content".
(hosted docs platforms gates this behind Enterprise; we ship it ungated.)

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
shape of hosted docs platforms/Vercel's danger zone (a "Delete my deployment" section + a "Delete my
organization" section, each with a required *reason* and a red action). Two scopes:

- **Delete this site** (hosted docs platforms' "deployment") — owner **or** admin. Drops the `site` row;
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

**Transfer this site.** The Danger zone's third section (listed first — GitHub keeps
ownership transfer in its danger zone too, and it's disruptive but not destructive): an
**owner/admin** moves a site to another org **they are also owner/admin of** — the
Vercel-style transfer between your own teams. Both ends are the same authenticated user, so
no acceptance handshake exists; transferring to a foreign org would need a pending-invite
flow and is deliberately out of scope (noted for later if asked for). Mechanically the
transfer is one `UPDATE site SET organization_id` — everything else is keyed off `site.id`
and travels for free: deployments/analytics/editor-session rows (FK chains), the
`sites/{id}/` storage prefix (no org in the key), and the custom domain (attached to the
shared Vercel project, recorded on the row). Slugs are globally unique, so tenant URLs
don't change. The **one org-owned link is the GitHub App installation**
(`githubInstallation.organizationId`): the site keeps its `githubInstallationId` only if
the destination org holds the *same* installation, else it's nulled — otherwise the site
would mint sync tokens from an installation the new org doesn't control (and the old org
could revoke out from under it). Public/PAT sites are unaffected (`repoTokenEnc` is
site-scoped); an App-connected private repo needs a reconnect in the new org, which the UI
says up front. Gates: destination picker (only eligible orgs are offered; the action
re-checks both roles) + the same type-the-slug confirm modal as the deletes; no reason
required (no exit survey — nothing is destroyed). Pure decisions live in
`src/lib/transfer-site.ts` (`canManageSites`, `eligibleDestinations`,
`installationCarries`; unit-tested), the action is `transferSite` in the danger actions
(same `redirectTo` + client hard-navigate contract), and the row's slug/domain cache tags
are busted so the org change is visible immediately.
>
> **Status (2026-07-06):** built. Unit tests (`tests/unit/transfer-site.test.ts`) cover the
> role gate, destination filter (current org excluded even when owned; member/null roles
> excluded), and installation carry-over. E2E (`tests/e2e/transfer-site.spec.ts`) seeds a
> second org + site, drives the picker + confirm modal (display name must NOT arm it; slug
> does), performs a real transfer, and asserts the redirect to the destination URL, the
> moved `organization_id`, and a 404 on the old org-scoped URL.
>
> **Status (2026-07-06, same day):** the picker now lists ALL the actor's other orgs, with
> ineligible ones (role `member`) disabled + "requires owner or admin" inline
> (`destinationOptions` replaced `eligibleDestinations`). Hiding them failed in first
> contact: a real user invited to a second org as `member` read the empty state as "you
> aren't a member of any other organizations". Surfaced two adjacent gaps, deliberately
> not fixed here: (a) **no UI lists a user's org memberships** (the site switcher is
> per-org sites only; other orgs are reachable only by typed URL), and (b) **invites are
> hardcoded `role: 'member'` with no change-role action**, so an eligible destination
> can't be produced through the UI at all — both queued as follow-ups (org switcher /
> member-role management). Note the related inconsistency: `connectRepo` doesn't role-gate
> site creation, while transfer-in requires owner/admin; resolution leans toward
> tightening connect, not loosening transfer.

### 10.6 CLI (`papervine`) — local dev tool, published to npm

The CLI is a **local dev tool**, not a second front door to the control plane. It's the
`mint` analogue (hosted docs platforms renamed `docs`→`mint`): you run it inside a repo of MDX +
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

**Execution is phased**, each phase keeping typecheck + smoke + a representative docs crawl green:
(1) workspace scaffold + move today's app to `apps/web` unchanged; (2) extract
`@papervine/renderer`, repoint `apps/web` at it (`@/` imports → package-relative); (3) sever
the four couplings; (4) build `apps/cli`, tarball-audit; (5) ship `papervine@0.1.0` over the
placeholder, from CI with `--provenance`. Phase 1 is the disruptive-but-mechanical one (the
move touches every import path); 2–4 are contained; the destination is the full monorepo
regardless of where we pause.

**docs platform parity informs the surface.** `mint` has **no `deploy` and no `login`** —
deployment is Git-based (push → their GitHub app builds it), and the CLI only reaches the
hosted backend for *read-only live data* (`mint analytics` pulls real traffic). So a CLI
never *is* the control plane; at most it's a thin HTTPS client to it. Papervine mirrors this:
local dev commands now, an optional thin authenticated client (`papervine analytics`, a
hypothetical `papervine deploy`) later — never by embedding the server. hosted docs platforms' one gap is
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
| `papervine build [dir]` | Static export to `./dist` (static-export differentiator) | renderer + crawl; emits the rendered route tree |
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
> (light **and** dark, browser-checked) and a real `starter-docs` incl. asset serving
> (`/logo/light.svg` → 200); **tarball audit** = 10 files / 15.5 kB, **dependency audit** = zero
> control-plane packages (no better-auth/postgres/drizzle/@aws-sdk/pusher/mcp/ai-sdk). Remaining
> (Phase 5): publish `@papervine/renderer` + `papervine@0.1.0` from CI with `--provenance`
> (decision: publish the renderer vs. `bundledDependencies` — leaning publish, to keep the CLI
> tarball lean and the renderer reusable); tighten the renderer's declared deps before publish;
> the docs-CSS (`.prose`/shiki) is duplicated between web `globals.css` and the CLI's, to dedupe
> into the package later; the cosmetic web→`apps/web` move.
>
> **Status (2026-06-14):** stripped hosted docs platforms from all **user-facing** surfaces — the published
> CLI (bin help, `package.json` description/keywords, the source comments) and the public docs
> site (19 pages + `docs.json`): positioning prose ("docs.json-compatible docs platform", "docs.json-compatible",
> "mirrors hosted docs platforms") became neutral capability claims ("compatible with existing `docs.json`
> projects"). Kept where factual/functional: the `third-party MDX serializer` dependency name, the `mint`
> theme value, the broken-peer-dep gotcha — and **internal** design docs (this SPEC, CLAUDE.md,
> GAP-REPORT.md, the crawl fixtures), where hosted docs platforms is the legitimate "what we clone" reference.
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

### 10.8 Settings → Members (team invitations)

The **Members** surface (`settings/members/`) replaces the placeholder with team management built
**entirely on Better Auth's `organization` plugin** — the `member` (owner/admin/member) and
`invitation` tables already ship + are migrated, so this is wiring (`auth.api.createInvitation` /
`listMembers` / `listInvitations` / `cancelInvitation` / `removeMember`), not a new data model.
Members are **org-scoped** (the tables key on `organizationId`); the surface lives under the site
shell but resolves `org.id` from the URL and gates invite/remove to **owner/admin** (Better Auth
re-checks server-side). Batch invites parse a comma/space-separated textarea via the pure,
unit-tested `parseInviteEmails` (`src/lib/invite-emails.ts`) and report a per-address outcome
(sent / already-member / already-invited) rather than failing the whole paste.

**Delivery — shareable link, not email (decision 2026-06-29).** There's no email infra in the
repo, and `acceptInvitation` already requires the invitee to be **signed in with the matching
email** (Better Auth does *not* create the account). So v1 surfaces a **Copy-link** for each
pending invite (the action builds `{appHost}/accept-invite?id=…` from the request Host); the admin
shares it. The `sendInvitationEmail` callback in `auth.ts` is wired as the **seam** — it records
the link today and is the single place a provider (Resend) slots in later, no action/UI change.

**Accept flow.** A bare `/accept-invite` route on the app host (in the `(auth)` shell, with a
middleware passthrough so it's reachable signed-out *and* signed-in, and not rewritten onto
`/app`). It reads the invitation **directly from the DB** (to show the org name even to a
signed-out invitee — the id is an unguessable token), then: signed-in + matching email → **Accept**
(`authClient.organization.acceptInvitation`) → dashboard; signed-out → sign-up/login carrying
`?invite=<id>&email=` (the auth pages read it from `window`, no `useSearchParams`/Suspense, and
land back on accept); signed-in as the wrong account → switch-account prompt.

> **Status (2026-06-29):** built + verified on a local prod build (seeded `dev-org`) — invite →
> Pending with a working Copy-link → accept via a fresh signup with the invited email → appears in
> Active members; cancel + remove work; owner/admin gate enforced. typecheck + unit
> (`parseInviteEmails`) + smoke + crawl green. Follow-ups: real email (Resend, seam ready),
> per-invite role picker (v1 invites as `member`).
>
> **Status (2026-07-06): role management landed** (the queued follow-up, forced by site
> transfer — a transfer destination needs owner/admin there, and v1 could produce only
> `member`s, so no org built through the UI could ever receive a site). Two additions,
> both on Better Auth's own enforcement: the **invite form carries a role picker**
> (`createInvitation` takes the role; the pending list shows it) and the members table's
> **Role column is an in-place select** (`auth.api.updateMemberRole`). The UI offers only
> what the viewer may grant — owner → member/admin/owner, admin → member/admin — via the
> pure `assignableRoles`/`canEditMemberRole` (`src/lib/org-roles.ts`, unit-tested), which
> mirror the plugin's rules: only the creator role (owner) may grant `owner` or touch an
> existing owner (`YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE` /
> `updateMemberRole`'s creator checks), never yourself, and the server rejects demoting
> the last owner. E2E (`tests/e2e/members-roles.spec.ts`): owner promotes a seeded member
> to admin from the table (persisted row asserted) and sends an owner-role invite (the
> invitation row carries `role='owner'`).

### 10.9 Settings → General (rename a site)

The **General** surface (`settings/general/`) replaces the placeholder with a single editable
field — the site's **display name** (`site.name`), the label shown across the dashboard (switcher
+ breadcrumb). Owner/admin only; `setSiteName` validates via the pure, unit-tested
`normalizeSiteName` (trim, non-empty, ≤100), then busts the cached site row (the name rides it,
move ①) and `revalidatePath(..., "layout")` so the switcher/breadcrumb update across pages.
Deliberately *not* editable here: the **slug** (the stable URL id) and the **rendered docs title**
(from the repo's `docs.json`). Status 2026-06-29: built + browser-verified (rename persists +
reflects in the switcher); typecheck + unit (`normalizeSiteName`) + smoke + crawl green.

### 10.10 Platform superadmin (`/admin`)

The operator's cross-tenant overview, at **`app.papervine.io/admin`**: every customer org with
its members (email + role), sites (status, repo, custom domain), deploy counts + last-deploy
time, and 30-day analytics volume, plus platform totals (customers/users/sites/deploys).
**Read-only by design** — support needs eyes, not a write path; mutations stay on the
tenant-scoped surfaces where their guards live. Access is an **env allowlist**
(`PLATFORM_ADMIN_EMAILS`, comma-separated, case-insensitive — pure matcher in
`src/lib/platform-admin.ts`), chosen over a DB staff-role column: nothing to escalate through
(no grant UI, unreachable from signup), and rotation is a deploy, not a migration. Unset → the
surface is dark for everyone. The gate (`requirePlatformAdmin`, dashboard-context) **404s**
non-admins — same invisible-surface posture as requireOrg's cross-tenant notFound; the edge
middleware already bounces the signed-out to /login. The rail shows a "Platform admin" link to
allowlisted users (cosmetic; the page gate is authoritative). Since `/admin` is a static
segment beside `[org]`, org slugs that would be shadowed by static control-plane paths are now
**reserved at creation** (`RESERVED_ORG_SLUGS` in `src/lib/slug.ts`, enforced by the
`beforeCreateOrganization` hook) — this also retro-fixes the latent `/preview` + auth-path
collisions. Status 2026-07-06: built + browser-verified (seeded dev login on the allowlist
sees the rail link + totals + org cards, light and dark; a fresh signed-in non-admin gets 404;
org create with slug "admin" 400s with the reserved message). typecheck + unit
(platform-admin, reserved slugs) + smoke (signed-out /admin → /login) + docs crawl (29/29,
0×500) green.

**Cross-tenant access** (same day, follow-up): two power levels from /admin into a customer's
world. ① **Read-only browse** — `requireOrg` lets an allowlisted non-member VIEW any org's
dashboard (`platformAdminView` flag): org loaded directly when membership misses, `role: null`
so every owner/admin-gated control hides, and mutations (`findSite` + membership-scoped
actions) still require real membership. An amber "Platform admin view" banner marks the
context. ② **Impersonation** — Better Auth's `admin` plugin (`user.role/banned/banExpires`,
`session.impersonatedBy`; migration `0013`, additive). The plugin authorizes by `user.role`,
but OUR source of truth stays the env allowlist: the role column is a **synced mirror** —
granted in the impersonate action (works for live sessions after an allowlist edit), granted
*and revoked* in a `session.create` databaseHook (a removed email loses plugin access at next
sign-in; narrow window accepted: a removed admin's live session keeps plugin endpoints until
then, while all our own gates check the env live). Impersonate buttons live on /admin's member
chips (self excluded; plugin refuses impersonating admins); sessions last 1h, carry
`impersonatedBy`, and the [org] layout shows a persistent "Impersonating X — Stop" banner
whose stop restores the admin's session and hard-navigates to /admin (Host-rewrite gotcha).
Status 2026-07-06: browser-verified (bypass banner + viewer-degraded UI on a non-member org;
impersonate → customer's dashboard as them → stop → back to /admin); typecheck + unit
(resolvePlatformRole grant/revoke/no-op) green.

**Tests + the onboarding-loop fix** (same day): the full §10.10 access matrix is pinned at
three layers — unit (`dashboard-context.test.ts` mocks session/db and asserts member /
signed-out / non-member 404 / allowlisted-bypass / membership-wins / ghost-slug for
`requireOrg`), smoke (signed-out /admin → /login), and e2e (`admin.spec.ts`: non-admin 404 +
no rail link; /admin lists a non-member org; bypass banner; impersonate → stop round-trip —
the allowlist email is webServer env in playwright.config, deliberately not TEST_USER).
Writing the e2e spec surfaced why the whole e2e suite was red (the "auth loop"): the
middleware's authed bounce off auth paths included **/onboarding**, which the dashboard
resolver redirects org-less users TO — every fresh signup looped (ERR_TOO_MANY_REDIRECTS),
in prod as well as tests. Fixed by excluding /onboarding from the bounce (middleware.ts, with
unit regressions in middleware-routing.test.ts).

**e2e suite repair** (same day, follow-up): with the loop fixed the suite ran again and
exposed two rot classes, both now fixed → **27/27 green, twice consecutively**. ① *Stale
selectors* from the blocked period: the site switcher is a shadcn DropdownMenu
(menu/menuitem, not listbox/option), `getByRole` name-matching is substring by default so
"Edit" collided with the editor feature's "Editor"/"Open editor" links (→ `exact: true`),
and RankTable is a Card div, not a `<section>` (→ `data-testid="rank-*"`, same pattern as
the metric-* cards). ② *A real harness bug*: Playwright starts the webServer BEFORE
globalSetup, so the DB rebuild dropped the schema underneath the app's live pool + warm
Next data cache — poisoned connections then 500'd random requests mid-suite ("relation
\"site\" does not exist"), a different victim spec each run. Fix: the rebuild moved into
the webServer command itself (`tests/e2e/reset-db.mjs && next dev`, before boot), and
`reuseExistingServer: false` so a leftover server can't leak the previous run's pool/cache
(globalSetup hook removed; global-setup.ts now only exports TEST_DB_URL). Two timing
hardenings ride along: the first overview visit is `test.slow()` (dev cold compile > 30s),
and the assistant-toggle reload assertions retry via `toPass` (optimistic flip vs
server-action write race).

### 10.x Instant settings navigation (Router-Cache reuse)

The dashboard is a Next App Router SPA: the rail/subnav persist and only the content segment
swaps on navigation (soft-nav). But every dashboard page reads the session cookie, so it
renders **dynamically** — and Next 15 defaults the client Router Cache's `staleTimes.dynamic`
to **0**, meaning a prefetched dynamic route is treated as immediately stale: `<Link>`
prefetches its RSC, then **discards it and refetches on click**. Measured against hosted docs platforms'
dashboard (Playwright, Resource Timing): clicking a settings sibling tab refetched the RSC live
(~222 ms, 1 request, ~195 ms TTFB on Neon) where hosted docs platforms reused its prefetch (**42 ms, 0
requests**) — the ~100 ms perception line sat right between them ("click → wait → change" vs
"changed before you let go").

Fix, two parts: (1) `experimental.staleTimes.dynamic: 30` (`next.config.mjs`) gives a
prefetched/visited dynamic entry a 30 s reuse window; (2) `prefetch={true}` on the nav links
forces a **full** prefetch (Next's default partial prefetch skips a dynamic route's RSC data, so
there'd be nothing to reuse). Applied to both the `SettingsNav` subnav and the main `AppRail`.
Safe because mutations go through server actions that `revalidatePath` the affected entry, so
freshly-changed data still shows; a hard refresh always wins. Tradeoff: landing on Settings now
fires ~14 RSC prefetches (one per tab) — the same cost hosted docs platforms pays for the instant feel;
settings queries are light. **Heavy rail routes opt out** via a `heavy` flag on the `RailItem`
(Analytics, which runs time-series aggregation keyed on `searchParams`) — they keep Next's
default partial prefetch and fetch on navigation, so we don't fire an expensive aggregation for
every rail item on every dashboard page.

> **Status (2026-06-29):** verified in a real browser against a local production build (seeded
> `dev-org/starter`, Playwright + Resource Timing). After the fix, landing on Settings lands 14
> full RSC prefetches and **every sibling-tab click is 0 network requests, ~30 ms**; the main
> rail's light items (MCP, Settings, Editor) are likewise **0 requests, ~40 ms**, while Analytics
> (the `heavy` opt-out) still fetches on click (~95 ms), as intended. Loopback, so absolute ms
> isn't comparable to deployed — the decisive, latency-independent change is the elimination of
> the per-click refetch, which on deployed removes the ~195 ms Neon round-trip. Distinct from the
> §3/§11 docs-site edge-cache defer (that's `force-dynamic` SSR HTML with no CDN cache; this is
> the *dashboard's* client Router Cache). typecheck + smoke green.

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
| Maps to hosted docs platforms | Their dashboard account | Their "Authentication & Personalization" |

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

> **Status (2026-07-06):** dev `trustedOrigins` no longer hardcode a port. The list had
> exactly `http://app.localhost:3000` for local dev, so any worktree dev server that
> auto-picked `:3001`/`:3002` (several checkouts running at once — the intended workflow)
> got 403 "Invalid origin" on sign-in until someone edited `BETTER_AUTH_URL`. Non-production
> builds now trust `http://localhost:*`, `http://*.localhost:*`, and `http://127.0.0.1:*`
> (better-auth's origin patterns: `*` matches any chars except `/`, so host wildcards and
> port wildcards compose). Gated on `NODE_ENV !== "production"` — the wildcards never ship;
> prod trust stays `papervine.io`/`*.papervine.io` + `BETTER_AUTH_URL` (Vercel previews).
> Verified in-browser: sign-in 200 on a `:3001` dev server with `BETTER_AUTH_URL` still
> pointing at `:3000` (the previously failing combination).

### 11.2 Layer 2 — Reader auth (docs.json-compatible handshake)

We never run an IdP for readers and never store reader credentials. We **verify a signed
assertion** from the customer's own login system, then mint a short docs session. This is
a much smaller security surface than real auth — the customer's IdP does the hard part.
Match hosted docs platforms' model exactly so their configs migrate unchanged.

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
jsonb, `authSecretEnc`), *not* docs.json — hosted docs platforms configures this in the dashboard too,
and we have no Git-write authoring backend (§9.2) yet to round-trip a docs.json
`authentication` block. The one secret per method (JWT private key / OAuth client
secret / shared password) is AES-256-GCM-encrypted via `src/lib/crypto.ts`, same as
`repoTokenEnc`. Pure validation + types live in `src/lib/reader-auth.ts`.

**Fix (2026-07-01) — switching methods must NOT regenerate the JWT keypair.** `setAuthMethod`
used to mint a fresh Ed25519 keypair whenever you switched *to* JWT and null the secret when
switching *away*. So toggling JWT → Password → JWT minted a **new** keypair, and since the verify
path reads `authConfig.publicKey`, every reader JWT the customer's backend had already signed
stopped verifying ("Could not verify your sign-in token" — hit in production). Rotation must be
deliberate: only the **Regenerate** button (`regenerateJwtKeypair`) mints a new key. Now
`setAuthMethod` only flips `authMethod`, preserving `authSecretEnc`/`authConfig`; it mints a
keypair *only* when switching to JWT and none exists yet. Consequence of preserving the shared
`authSecretEnc` across a switch: a non-JWT method could read a leftover EdDSA PEM — so the settings
page hides it (shows an empty secret field) and `submitReaderPassword` fails closed if the stored
secret is a PEM (a half-configured "password" site with no real password rejects login rather than
accepting the PEM). Guard: `tests/unit/auth-method-switch.test.ts`.

**Status (2026-06-25) — JWT handshake shipped (asymmetric EdDSA).** The JWT method is now
wired end-to-end and uses **asymmetric Ed25519**, replacing the earlier symmetric
`papervine_jwt_…` shared secret (which contradicted this section's "EdDSA only" mandate).
Decisions: (a) **key custody** — Papervine generates a per-site Ed25519 keypair; the
**private key** (PKCS#8 PEM) is shown to the customer to sign with and stored AES-GCM-
encrypted in `authSecretEnc` (so the dashboard can reveal/copy/rotate it, matching hosted docs platforms
and the existing secret UX), while the **public key** (SPKI PEM) lives in plaintext
`authConfig.publicKey`. The verify path uses **only** the public key — a config leak can't
forge reader tokens, and only the public key needs to ship to the edge later (the planned
gate below). (b) **No DB migration** — the public key rides in the existing jsonb
`authConfig`; the private key reuses `authSecretEnc`. (c) **Library** — `jose` (now a direct
dep) for keypair gen + verify; `jwtVerify` pins `algorithms:['EdDSA']` (no alg-confusion /
`none`) and enforces `exp`; it's Web-Crypto/edge-portable, so the verifier is ready to move
to middleware. Flow: an unauthenticated reader on a JWT site is redirected from `/login` to
the customer's configured **login URL** (`?redirect=`); their backend signs an EdDSA JWT
(`{alg:'EdDSA'}`, `exp`≤10s, `host` = docs domain) and redirects to
`/login/jwt-callback?redirect=…#{JWT}` — token in the **hash** (client-only). A client
component (`ReaderJwtCallback`) reads the hash and POSTs to `submitReaderJwt`, which verifies
signature + `host`, then mints the site-bound `pv_docs_session` cookie honoring the token's
`expiresAt` (capped at the 7-day ceiling) and carrying `groups` (forward-looking for the edge
gate). Core crypto + the `User` type live in `src/lib/reader-jwt.ts`; callback routes exist
for both subdomain/path (`sites/[site]/login/jwt-callback`) and custom-domain modes.
Regression coverage: `tests/unit/reader-jwt.test.ts` (round-trip + wrong-host, expired,
wrong-key, HS256-confusion, tampered, malformed-key negatives).

**Fix (2026-06-25) — reader `/login` was hijacked on tenant subdomains.** The control-plane
auth-path bounce in `middleware.ts` (apex `/login` → app host, so the session cookie is set
on `app.{apex}`) was guarded only by `isPlatformHost`, which is **also true for tenant
subdomains** (`{slug}.localhost` / `{slug}.papervine.io` are ours, not vanity domains). So a
reader hitting `{slug}.papervine.io/login` was bounced to `app.{slug}.papervine.io/login` —
the Papervine *account* login — instead of the tenant's own reader login card. This broke
**both** password and JWT reader auth in **subdomain mode**; path mode (`/sites/{slug}/login`)
was unaffected (that path isn't an auth path), which is why the shipped password method looked
fine. Fix: guard the bounce with `!resolveTenantSlug(reqHost)` so it fires only on the true
apex; on a tenant host `/login` falls through to the docs rewrite (→ `sites/{slug}/login`).
Not catchable in smoke (it runs in single-repo preview mode, which disables the bounce) →
regression lives in `tests/unit/middleware-routing.test.ts`.

**Enforcement.** The gate is the **node** chokepoint `renderTenantDocs` (not edge
middleware — the per-site config is a DB read the edge can't do, same constraint as
custom-domain resolution): an `authEnabled` site renders only to a reader holding a valid
docs session for it, else it 307s to the site's `/login` round-tripping the intended path.
The **password** method is wired end-to-end: a `/login` route per serving mode
(`sites/[site]/login`, `custom-domain/login`) → `submitReaderPassword` constant-time-checks
the shared secret → mints an encrypted, site-bound, 7-day session cookie (`pv_docs_session`,
`src/lib/reader-session.ts`) → bounces back (open-redirect-guarded). The **JWT** handshake
is also wired (asymmetric EdDSA — see the 2026-06-25 status note above).

**Per-page group access control wired (2026-06-28).** A page's `groups: [...]` frontmatter now
gates it to readers in ≥1 listed group; `public: true` opts a page out of group gating. The
reader's groups come from the handshake (carried in the `pv_docs_session` cookie; the password
method has none, so it can never satisfy a `groups:` page — by design). Enforced in the **node
render** (`render-tenant.tsx`): a `readerAccess(slug)` predicate (pure `canAccessPage` over the
session's groups) is used in **both** halves — the shell hides inaccessible pages from the nav
(`buildNav` takes a `PageAccess` predicate; rejected pages never enter the tree, so a non-member
can't even see one exists), and the article 404s a direct-URL hit to a page the reader can't
access (**404, not 403** — a 403 leaks that a protected page exists). Pure helpers
(`canAccessPage`, the nav predicate) are unit-tested; `readerSession` now returns the claims so
`groups` can be read back. `buildNav` also **prunes empty containers** after access filtering —
a group or tab whose pages are all gated away vanishes entirely (no bare label, no empty
"Internal" tab), which is why hosted docs platforms needs no separate tab-level `groups` knob: access stays
single-source-of-truth at the page, and containers (groups, tabs) derive their visibility from
which leaves survive. **Still to build:** the **OAuth** handshake (its `/login` shows a
"not available yet" notice today); the `public: true` *site-gate bypass* (a public page on an
auth-enabled site still hits the site-wide shell gate first — full unauthenticated access to a
public page needs the gate moved off the shell, i.e. the edge gate below); and gating of
**agent + asset surfaces** that build nav/content without the reader predicate (search, the
assistant, `/mcp`, `llms.txt`, the export route, and `/api/tenant-asset`) — see the status
notes below for which of these are now closed and why `/api/tenant-asset` is deferred.

**Retrieval surfaces gated (2026-06-28) — search, AI assistant, MCP.** The per-page gate now
reaches the three surfaces that expose page *content* outside the renderer, closing the leak
where a reader could pull a gated page via Cmd-K, the assistant's RAG, or the MCP server even
though the renderer 404s it. One mechanism: a `PageAccess` predicate carried in an
`AsyncLocalStorage` (`src/lib/reader-access.ts`), mirroring how the renderer carries its
content source (`contentContext`) — routes set it, `docs-tools`/`search` read it, and it
propagates into the assistant's *streamed* tool calls the same way the content source already
does. **Default is ALLOW_ALL**, so the apex, `papervine dev`, and non-gated sites are byte-for-
byte unchanged. Applied at the choke points: `runSearch` carries each section's `groups`/`public`
in the (reader-independent, still-memoized) index and drops inaccessible hits at query time
(over-fetching first so the list stays full); `readPage` returns the **same "not found"** as a
missing page (no existence leak); `listPages` passes the predicate to `buildNav`. Reader identity
per transport: the browser surfaces (Cmd-K, assistant) derive groups from the `pv_docs_session`
cookie via `requestReaderAccess`; **MCP is anonymous** — external agents carry no reader session,
so on a gated site they see only the public/un-gated subset (per-reader authenticated MCP is a
later follow-up). The shell's `readerAccess` was refactored onto the shared `accessForRecord`, so
nav, render, and retrieval are one source of truth. Verified end-to-end on the seeded
`starter-gated` tenant: anonymous search/MCP return no `internal/*`, an `admin` reader sees the
`admin` pages but **not** the `beta`-only page, and MCP `read_page` of a gated slug is denied
while a public page still reads. Unit-tested (`docs-tools-access.test.ts`).

**Extended to `llms.txt` + the export route (2026-06-28).** Same predicate, same `listPages`
choke point. `llms.txt`/`llms-full.txt` are agent surfaces with no reader session, so (like
MCP) they're **anonymous** → a gated site's index and full-corpus dump carry only the public
subset. The **export-all** view (`/sites/{slug}/export`) already had the site-level session
gate (anonymous → login); it now also installs the reader's **own** group predicate
(`requestReaderAccess(slug)`, cookie-based — it's a browser surface), so a signed-in reader
without a group can't export the pages it covers. Verified on `starter-gated`: anonymous
`llms-full.txt` has zero `internal/*`; a `beta` reader's export contains the beta + shared
pages but not the admin-only ones, and an `admin` reader's export is the inverse. Unit-tested
(llms render under access).

**Still deferred — `/api/tenant-asset` (needs a real design, not a cookie gate).** Assets carry
no per-asset `groups`, so the most a gate could do is site-level (any valid reader session). But
tenant raster images render through the **next/image optimizer**, which fetches the asset route
**server-side without the reader's cookie** — so a cookie gate would either 404 every optimized
image on gated sites, or be trivially bypassed via `/_next/image?url=…` (the optimizer is itself
a cookieless proxy to the asset). Properly gating assets needs either **unoptimized images on
gated sites** (browser fetches directly, with the cookie) or **signed asset URLs** — a deliberate
change, out of scope here. Mitigation already in place: the content gating above removes the
*discoverability* of a gated page's asset URLs (they appear only in gated MDX, no longer
retrievable via search/RAG/MCP/llms/export), so an attacker would have to guess storage paths.

**Planned — edge-native gate that unblocks CDN caching (resolves the §3 caching defer).**
The §3 perf goal is hosted-docs-speed navigation: tenant docs served from **Vercel's edge cache**
(`x-vercel-cache: HIT`, ~100 ms globally + prefetchable RSC) instead of a single-region
serverless render + Neon round-trip per request (~1.6 s). The blocker is *this gate*: the
reader-auth `cookies()` call in the node render forces the whole route dynamic (`no-store`)
even for public sites — Next classifies a route static-or-dynamic, and one possible `cookies()`
taints it. The render must be **pure** to be cacheable, which means the gate moves to where
this section always wanted it (line ~1613, "Enforced in middleware") — but **edge-natively**,
without the DB read that forced it into the node render:
- **Gating rules → Vercel Edge Config**, keyed by slug (`{ authEnabled, rules: [{ pathPattern,
  requires }] }`), written when a site's auth/access config changes. Sub-ms, globally replicated,
  edge-readable — replaces the per-request `getSiteBySlug`.
- **Reader identity → the existing signed, site-bound session** (`pv_docs_session`), made
  self-verifying at the edge (verify signature + read `groups`/entitlements from the token, no
  DB). The JWT handshake already carries `groups` (line ~1594) → this is the natural home for it.
- **Middleware decision** = reader entitlements (cookie) × request **path** × rules (Edge Config)
  → allow (rewrite to the cacheable docs route) or deny (404, line ~1612). This is *finer*-grained
  than today's node gate, which only sees the site, not the page — it directly realizes the
  per-page `public:` / per-group `groups:` model above.

**Why fast + gated coexist:** Vercel runs middleware on **every** request, *including edge-cache
hits* (middleware is in front of the CDN). So the gate is always enforced while the cache just
holds the rendered bytes — the cache holds the content, middleware holds the door. The one
invariant that keeps it cacheable: **access controls visibility (allow/deny), not content
bytes** — a cached URL is one shared response, identical for everyone allowed. Per-user
*personalization* (the `content`→`user` blob, line ~1616) genuinely varies bytes per reader, so
those pages stay dynamic or split into per-audience URLs — already deferred to v2+ for exactly
this reason. Then `revalidate=60` ISR makes the now-pure render edge-cacheable (content
self-heals within a minute of a sync, sidestepping the `after()`/`revalidateTag` gap), and the
edge gate avoids the experimental Node-middleware runtime and the per-request Neon read entirely.

**Prerequisites — the full taint inventory (verified by a prod-build spike, 2026-06-17).** A
route is cacheable only if *nothing* in its render tree calls a dynamic API. Four independent
taints currently force tenant docs dynamic; **all** must go, and they're layered, so removing
any subset still shows `ƒ` (`no-store`) in `next build`:
1. **Route-file `headers()`** — `sitesTenantTarget` reads the Host to pick subdomain (`base=""`)
   vs path-mode (`base=/sites/{slug}`). Fix: the route-mode separation (distinct `/sites` and
   `/p` routes, base from the route).
2. **`requestContentSource` `headers()`** — called unconditionally (`src/lib/request-source.ts`),
   even when the route passes an explicit slug. Fix: only read headers when no slug is given.
3. **Reader-auth `cookies()` gate** — the relocation this section is about (edge gate).
4. **Root layout `requestContentSource()` `headers()`** — `src/app/layout.tsx` primes
   `contentContext` from the Host for *every* request (the §2 per-request content-source fix), so
   it taints the **entire app**, not just docs. Fix: move that priming out of the root layout into
   the per-route layouts that already re-resolve the source (the tenant `(docs)` layout, the apex
   `(docs)` layout) so the root layout is pure. **Highest-risk** of the four — it touches the
   documented §2 priming model and affects every route — so it wants its own PR + verification.

Net: this is a **multi-PR refactor** (root-layout priming → route-mode separation → edge gate →
ISR flip), each independently shippable and verifiable, not a single change. Plus the edge gate
needs **Vercel Edge Config provisioned** (and the reader-session crypto, today `node:crypto` +
`server-only`, made edge-safe via Web Crypto) — infra that can't be exercised in a local build.
The spike also confirmed the asset/agent-surface gating gap (above) is covered for free once the
gate is middleware.

**Planned — authed-docs speed via per-entitlement-class caching (extends the edge gate above).**
The edge gate makes *public* sites edge-cacheable (one shared response). Gated sites look
uncacheable — `force-dynamic`, `no-store`, ~1.6 s every hit — but that's an over-correction:
**gated content varies by *group set*, not per *user*.** `accessForRecord`
(`src/lib/reader-access.ts`) gates each page by the reader's session `groups`; two `admin`
readers see byte-identical pages *and* identical group-filtered nav. So a gated page needs one
cached variant per **entitlement class** (distinct group set), not one per reader — and a real
site has a handful of groups, so a handful of variants. That recovers most of the public-site
cache win for gated sites. Five moves — the **first is independent of the edge gate and ships
now** (it's the Neon-round-trip fix); the rest build on the gate:

*Ships now, no edge gate needed (pure latency wins on the current dynamic render):*
- **① Kill the per-request Neon read (the measured ~195 ms villain) — ✅ LANDED 2026-06-29.**
  `getSiteBySlug` *and* `getSiteByCustomDomain` (`src/lib/tenant.ts`) were a Neon `select` on
  *every* tenant request — only React `cache()`'d *per-request* (one memo per request), so a cold
  serverless invocation always paid the full round-trip. They're called from ~20 sites
  (`requestContentSource`, `render-tenant.tsx`, the docs route, login, export, reader actions), so
  the fix lives in **one place** and is transparent to all of them: both functions now wrap the DB
  read in **`unstable_cache`** (the Next Data Cache — the same mechanism `s3-source` uses for
  content; chosen over Redis because it needs *no new infra* and is what already works on Vercel),
  keyed + tagged per slug / per custom-domain, with a 60 s TTL backstop. **Write-through**
  `revalidateSiteRow` busts the tag at every normal-context mutation (`sync-runner` on manual sync,
  connect, auth/domain settings, delete) so changes apply immediately; the push-webhook sync runs
  in `after()` where `revalidateTag` doesn't propagate (same constraint the content cache
  documents), so there fresh content appears within the ≤60 s TTL. Drizzle's `Date` timestamp
  columns are re-hydrated after the cache's JSON round-trip (`reviveSiteDates`) so the
  `updatedAt`-in-version-key path keeps working. *(Redis/Edge Config still relevant for move ④,
  the edge gate, which needs sub-ms **edge** reads the Data Cache can't serve.)*
- **② Cache `buildNav` per `(contentVersion, groupSet)` — ✅ LANDED 2026-06-29.** `buildNav`
  resolves every nav leaf via `loadPage` (a content read per page) and the nav is identical across
  all of a site's pages for a given entitlement class — yet it ran on *every* page render (the
  shell AND the article). `buildNavCached` (`render-tenant.tsx`) now wraps it in the Data Cache,
  **version-keyed** (`sha:syncedAt`, like the content cache — and via move ① the version follows
  the cached site row, so a manual sync busts immediately, a webhook sync settles within the row
  TTL) and **group-keyed** (`entitlementKey`, new in `reader-access.ts` — "public" for an auth-off
  site, the sorted group set for a gated reader; this is also the move ③ entitlement-class key).
  The callback re-establishes `contentContext` so `loadPage` works on a miss. Built once per
  (version, base, class) and reused for every page + the shell; covers subdomain *and*
  custom-domain renders (editor drafts, the apex single-repo path, and search/MCP retrieval keep
  their own uncached `buildNav`). Verified on a local prod build: the 67-link a large public docs.json repository nav
  renders correctly (cache callback context works), warm renders ~15 ms. Unit-tested
  (`entitlementKey`: public/anon/sorted-group-stability/site-binding) + crawl gate clean.

*Needs the §11.2 edge gate first (adds the edge cache on top):*
- **③ Cache key carries the entitlement class.** Middleware already verifies the JWT and reads
  `groups` (no DB). It derives a stable class id = hash of the sorted group set, then rewrites to
  an internal path that encodes it (e.g. `/_ent/{classHash}/{slug}/{path}`), so the CDN cache key
  is naturally *(page × class)*. The gate still runs in front of the cache on every request
  (allow → serve the class's cached bytes; deny → 404), so visibility is always enforced live
  while the bytes are shared within a class. The article body is identical within a class, so it
  rides this cache. Public is just the single-class case.
- **④ Edge-gate subset → Edge Config.** The middleware gate needs only a *small, hot* slice —
  `{ authEnabled, rules }` per slug — at the **edge** (sub-ms, before the cache). That slice goes
  to **Vercel Edge Config** (§11.2), written on auth/access changes. Distinct from ①'s Redis
  record: Redis serves the *node render's* fuller record at scale (thousands of tenants); Edge
  Config serves the *edge gate's* tiny rule set with sub-ms edge reads. Hot-path end-state:
  JWT-verify (CPU) + Edge Config read (edge) / Redis read (node) + Data-Cache content — no Neon on
  the read path, cached *or not*.
- **⑤ Optional — Partial Prerendering instead of the ③ path rewrite.** Next 15 PPR serves a cached
  shell (article + nav skeleton) with the per-reader gate as a dynamic hole, keeping a single
  route instead of `/_ent/…`. The more elegant form of the same idea; adopt if PPR is stable
  enough for us.

The client-side win already shipped (SPEC §10.x: `staleTimes.dynamic` + `prefetch`) stacks on
top — once gated renders are cheap, a reader's prefetched pages reuse from the Router Cache, so
authed nav goes instant like the dashboard.

**Two axes, two mechanisms — don't conflate them.** Reader auth has *two* independent kinds of
per-reader variation, and only one is server-side:
- **Visibility** — *which* pages/nav a reader sees — varies by **group**. Server-side, the gate;
  cached per entitlement class as above.
- **Content values** — per-*user* personalization (`{user.firstName}`, a prefilled/user-scoped
  API key, user-specific snippets — a real hosted docs platforms feature, the `user` blob in v2 sequencing
  below, *not* a negligible edge case) — varies by **individual**. Resolve it **client-side**, so
  the cached bytes stay a shared template: the edge serves one cached page with **placeholders**
  (`<span data-pv-user="firstName">`, a key field flagged for fill), and client JS fills them from
  the reader's token, which already lives in the browser from the auth handshake (user-scoped
  *secrets* come from an authenticated client call, never the cached HTML). Cache hit *and*
  personalized — no per-user server render. This is almost certainly how hosted docs platforms reconciles its
  measured edge-caching with its documented personalization (inferred, not confirmed from their
  internals).

So personalization does **not** force a page dynamic — it moves to the client. The genuine
dynamic exception is only content that must be **server-authoritative in the first byte** (rare
for docs, which are behind auth and not SEO-indexed); those few pages opt out of the cache.

Sequencing maps to the ①–⑤ above: **① then ②** ship now (pure latency wins on the current dynamic
render, no gate) — **start with ①, the Neon-round-trip fix**. Then the **§11.2 multi-PR refactor**
(root-layout priming → route-mode separation → edge gate → ISR flip) is the prerequisite that adds
the edge cache and the ④ Edge Config slice; on top of it land **③ entitlement-class cache key**
then **⑤ (optional) PPR**.

**Decisions (caching infra + ordering), settled 2026-06-29:**
- **CDN = Vercel native cache, not Cloudflare (for now).** We're already all-in on Vercel (origin,
  custom-domain management, Neon). Vercel's cache works uniformly across *all* tenant domains —
  subdomains, apex path mode, *and* customer custom domains — with zero extra infra, whereas
  fronting arbitrary customer domains with Cloudflare needs **Cloudflare for SaaS** (custom
  hostnames), a paid, more involved layer that also reshapes the Vercel-based custom-domain
  onboarding. And **tag-based on-demand purge** (`revalidateTag(siteId)` from the sync runner) gives
  precise per-tenant invalidation on publish — clumsy on Cloudflare (cache-tags are Enterprise).
  Cloudflare's real win is cheaper egress / bigger edge at scale; it's **additive later** (drop it
  in front of Vercel without redoing any app-level cache semantics — which we need either way), and
  it likely ties into the `custom-domain-cap` thread (the Vercel max-domains limit) when revisited.
  Note hosted docs platforms runs Vercel origin + Cloudflare in front — that's their *scale/cost* layer, not a
  capability we lack.
- **Cache before prefetch for docs — don't prefetch doc content yet.** Tempting to copy the §10.x
  dashboard prefetch onto the docs sidebar, but a docs sidebar has *hundreds* of links and each
  page render is expensive *and uncached* today, so `prefetch={true}` would fire dozens-to-hundreds
  of full origin renders per page view — a load multiplier, the opposite of faster. Prefetch is a
  **complement to caching, not a substitute**: hosted docs platforms can prefetch aggressively *because* their
  pages are edge-cached (a prefetch is a cheap CDN hit). So docs prefetch waits until the edge cache
  (steps 3–5) lands; *then* it's cheap and gives instant nav. (The docs sidebar is already `<Link>`
  soft-nav, and `staleTimes.dynamic: 30` already ships, so revisiting an already-opened page within
  the window is already reused from the Router Cache — a free partial win.)

### 11.3 Sequencing (v1 → enterprise)

1. **v1 (now):** Layer 1 only — Better Auth + `organization` plugin, **email/password**
   first (GitHub OAuth a fast-follow), **Neon** Postgres (provisioned via Stripe Projects),
   middleware session check, RBAC, repo connect. Nothing multi-tenant works without it.
   Deploy sequencing: ship the public renderer first (single-tenant, already live on
   Vercel + git-connected), then layer auth on — auth does not block going online.
2. **v2 (first paying customers ask):** Layer 2 **JWT** handshake + `public:`/`groups:`
   page gating. Personalization (`user` in MDX) after that — **build it client-side from day one**
   (`{user.x}` compiles to a client-filled placeholder, values injected from the reader's token in
   the browser), so personalized pages stay edge-cacheable. Server-interpolating user data would
   bake it into the HTML and make every personalized page uncacheable — see §11.2 "two axes."
3. **Enterprise (when a deal demands it):** WorkOS SAML/SSO into the platform; OAuth-2.0
   reader handshake; per-user personalization at scale.

---

## 12. Tech Stack (proposed)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router, RSC)** | Matches hosted docs platforms; multi-tenant middleware; streaming |
| Language | **TypeScript** strict | |
| MDX | **hybrid**: `third-party MDX serializer` `serialize` + `@mdx-js/mdx` `run` (see §3) | high-fidelity highlighting/snippets + catchable, never-500 render |
| Syntax highlight | **Shiki** (via `third-party MDX serializer`) | fast, accurate, dual light/dark themes |
| API reference | `@scalar/openapi-parser` (parse/dereference) + our native renderer | hosted docs platforms model: in-nav endpoint pages, not a foreign embed (§7) |
| CLI | `papervine dev <dir>` (`bin/papervine.mjs`) | preview any MDX + docs.json repo locally — the `mint dev` analogue; `tests/crawl.mjs` reuses it. Local dev tool only (renderer, never the control plane); published to npm as the unscoped `papervine`. Command surface + packaging boundary: **§10.6** |
| Styling | **Tailwind CSS** + CSS variables | theme tokens from docs.json |
| Search | **Orama** (Algolia optional) | embeddable, multi-tenant |
| DB | **Postgres** (+ `pgvector`) — hosted: **Neon** | tenants, config, embeddings; Neon serverless for the Vercel deploy, provisioned via the Stripe Projects CLI (`stripe projects add neon/postgres`) |
| Cache | **Redis** | domain→tenant map, page cache |
| Object storage | **S3 API** — hosted: **Cloudflare R2**, local: **MinIO** | compiled bundles, assets. Code to the S3 API (pluggable `S3_ENDPOINT`); R2 chosen for **zero egress** (docs serving is read-heavy) + built-in CDN; self-hosters point at any S3-compatible store |
| Queue/workers | **BullMQ** / serverless functions | git sync jobs |
| AI | **Vercel AI SDK** + `@ai-sdk/anthropic` (Claude); **AI Elements** for chat UI | agentic assistant (§8) |
| Auth (platform) | **Better Auth** (+ `organization`) | OSS, self-hostable, orgs + RBAC; WorkOS for enterprise SSO later (§11) |
| Hosting | Vercel (render) + workers elsewhere | mirrors hosted docs platforms' Vercel approach |
| Monorepo | pnpm + Turborepo | shared packages |

**Decision (see `GAP-REPORT.md`): built from scratch, not on Fumadocs** — multi-tenancy and full control over the renderer outweighed the head start. We still borrow OSS building blocks where they earn it (`third-party MDX serializer` for compile, `@scalar/openapi-parser` for OpenAPI). Prior art studied: [Fumadocs](https://github.com/fuma-nama/fumadocs), [unmint](https://github.com/gregce/unmint), [Scalar](https://github.com/scalar/scalar), [Nextra](https://nextra.site/), Docusaurus.

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
  `src/components/api/EndpointReference.tsx`). Decision rationale + hosted docs platforms model
  verification in chat history; matches hosted docs platforms' `openapi`-nav model.
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
7. ~~**Web editor** — defer past v1? hosted docs platforms treats it as a differentiator.~~ **DECIDED & BUILT (2026-06-14): build it now, agent-native.** Shipped the full 3-panel editor (editing-agent chat · navigation · multi-modal editor) on a shared authoring backend — see §9.2's build note. We chose to lead with the differentiating axes (open-source + agent-native) rather than defer. Editing is **Source MDX + a Preview rendered by our own renderer** (revised 2026-06-15 — the original MDXEditor WYSIWYG was dropped because a second rendering engine only approximates real-world MDX; see §9.2). Git stays the source of truth and the preview is byte-faithful to publish.

---

## 17. Non-Goals (v1)

- In-place WYSIWYG editing (we ship Source + a faithful real-renderer Preview instead; §9.2)
- Migrating from non-docs.json sources (Docusaurus/GitBook importers)
- Embeddable AI on third-party sites
- Marketplace / plugin ecosystem
- On-prem enterprise deploys
