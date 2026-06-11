# Working on Papervine

Papervine is an open-source, multi-tenant **docs.json-compatible docs platform**: it renders a docs site
from a Git repo of MDX + a `docs.json`. Read [`SPEC.md`](./SPEC.md) for the
architecture and roadmap, and [`GAP-REPORT.md`](./GAP-REPORT.md) for what does and
doesn't render yet vs. representative docs repos.

This file is the contract for how to work in this repo. Follow it for every change.

## Definition of done

A feature/fix is not done until **all** of these pass:

1. `npm run typecheck` — clean.
2. `npm test` — the fixtures smoke test (boots the real renderer, asserts no page 500s).
3. **A regression test exists for what you changed, at the right layer** — see "Always
   write tests" below (unit / smoke / e2e).
4. **Verified in a real browser** — screenshot the affected page (`agent-browser`, light
   AND dark mode if visual). Don't claim a UI change works from the DOM alone; layout
   bugs (e.g. the card `h-full` height bug) only show visually.
5. For renderer/config/nav changes: **crawl a representative docs repo** and confirm no
   regressions — `node tests/crawl.mjs <cloned-incumbent-repo>` (expect 0 × HTTP 500).
6. For control-plane / authed changes: `npm run test:e2e` green (needs docker
   Postgres + MinIO up).

State plainly what you ran and what passed. If something is unverified, say so.

## Always write tests

Regression protection is a hard requirement, not optional. Three layers — put the test
where the logic lives:

1. **Unit (Vitest) — `tests/unit/`, `npm run test:unit`.** Pure functions, no DB/browser:
   `resolveTenantSlug`, `parseRepoInput`, `slugify`, config parsing. Fast; runs anywhere.
   If you add a pure helper, unit-test it (and keep it pure — `"use server"` files can't
   export sync helpers, so extract them, e.g. `src/lib/slug.ts`).
2. **Smoke (zero-dep) — `tests/smoke.mjs`, `npm test`.** The renderer + control-plane
   **gate**, no Postgres so it runs in CI everywhere. **To cover a new renderer case, add
   a fixture** under `tests/fixtures/` (register it in `tests/fixtures/docs.json` nav) and
   a check to `CHECKS`. Fixtures reproduce the *actual failure shape* (object favicon,
   `languages` nav, `.md`, unknown/member-expr components, bad frontmatter, snippet
   imports, hidden pages, card height). DB-free control-plane checks (gate redirects, auth
   pages render) live in `CONTROL_PLANE_CHECKS`.
3. **E2E (Playwright) — `tests/e2e/`, `npm run test:e2e`.** Authed journeys against real
   Postgres (`papervine_test`) + MinIO: signup → onboarding → connect → dashboard. `globalSetup`
   creates/migrates/truncates the test DB; `auth.setup.ts` logs in once and saves the
   session (storageState) so specs start authenticated. Tag specs that hit the network
   (e.g. the GitHub connect flow) `@external` so CI can `--grep-invert @external` and stay
   deterministic.

CI (`.github/workflows/ci.yml`): `verify` job runs typecheck + unit + build + smoke
(no services); `e2e` job runs Playwright against a Postgres service (skipping `@external`).
Keep both green.

## Driving the app to test it (seeded login + browser)

When a change needs hands-on verification (DoD #4, or the user says "go test this"), don't
hand-walk signup → onboarding. Seed a known account and drive a real browser:

- `npm run db:seed` (`scripts/seed-dev.mjs`) creates a known login **`dev@papervine.local` /
  `dev-password-123`**, an org, and a connected site `starter` (→ `papervine/starter`) with
  activity + analytics data. Idempotent (re-run to refresh the password); **prod-guarded**
  (refuses any non-localhost `DATABASE_URL`). Needs `docker compose up` (Postgres + MinIO).
- The **control plane lives on the `app.` host** (SPEC §10): log in at
  **`http://app.localhost:3000/login`**, and the dashboard is at bare
  **`app.localhost:3000/:org/:site`** (seed → `app.localhost:3000/dev-org/starter`). New
  site at `/:org/connect`. The apex (`localhost:3000`) is marketing + docs, and bounces
  auth paths to the app host. Tenant docs render at **`{slug}.localhost:3000`** (subdomain
  mode) or **`/sites/{slug}`** (apex path mode) — `resolveTenantSlug` picks the mode off
  the Host header; `isAppHost` picks the control plane.
- Drive it with **`agent-browser`** (the repo standard — `open` / `snapshot -i` / `click @eN`
  / `fill` / `screenshot`; it navigates `app.localhost` / `{slug}.localhost` fine) or
  Playwright. This is the same loop that found the per-request content-source bug (SPEC §2):
  connect a repo, open its docs, confirm the sidebar/pages are the tenant's, not the platform's.

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
- **Redirecting to a tenant-host URL needs a hard navigation, not a server `redirect()`.**
  Tenant pretty-URLs (`{slug}.papervine.io/…`) only exist as a `middleware.ts` Host-rewrite
  to `/sites/{slug}/…` — no route file backs them. A server-action `redirect("/")` (or
  `router.push`/`<Link>`) is followed as a soft RSC nav that resolves against the real route
  tree and **skips the Host rewrite**, so `/` lands on the apex marketing home, not the
  tenant's docs. It passes `curl`/SSR (a hard request rewrites fine) and only fails in a real
  browser. Fix: server returns the target (`{ ok, redirectTo }`), client does
  `window.location.assign(redirectTo)`. This bit the reader-auth login (SPEC §11.2) and the
  **app-host dashboard** (SPEC §10): its bare `app.papervine.io/:org/:site` URLs are the same
  Host-rewrite (→ `/app/:org/:site`), so `connectRepo`'s post-create redirect and the auth
  pages' post-login landing return a target and the client hard-navigates. Nuance: an
  intra-dashboard `<Link>`/`router.push` *within* the app host is fine — it already carries
  the rewrite context (verified in-browser); it's the **cross-context** hop (apex→app, or a
  server-action redirect into a rewritten path) that skips the rewrite. Plain `redirect()`
  is fine for genuine apex routes (the marketing pages) — nothing to rewrite there.
- **The marketing apex can't see the app-host session — by design.** The Better Auth session
  cookie is host-only on `app.papervine.io` (never shared to `.papervine.io`, which would send
  your auth token to every tenant docs subdomain — an XSS-exfil surface). So `www` shows a
  Dashboard link via a *benign* `pv_signed_in=1` flag cookie (`src/lib/signed-in-flag.ts`) set
  on the parent domain by the app-host middleware, cleared on sign-out, read by the marketing
  nav. Logged-in users who hit `/login`/`/signup` on the app host are bounced to the dashboard
  (the `app.example.com/signup` behavior). **Dev caveat:** Chrome rejects `Domain=localhost`
  cookies, so the flag (and thus `www`'s Dashboard link) only works in prod (`.papervine.io`);
  the redirect-to-dashboard behavior works everywhere. Don't "fix" the missing dev label by
  sharing the real session cookie.

## Commands

```bash
docker compose up -d        # local Postgres (+pgvector) + MinIO (S3) for the control plane
npm run dev                 # serve the app (singleton: reuses a running server, so parallel agents can't corrupt .next)
npm run dev:fresh           # kill the dev server, wipe .next, restart clean (use when chunks/manifests are already corrupted)
npm run build               # production build
npm run typecheck           # tsc --noEmit
npm test                    # smoke: renderer + control-plane gate (zero-dep, no DB)
npm run test:unit           # vitest — pure-logic unit tests
npm run test:e2e            # playwright — authed journeys (needs docker Postgres + MinIO)
npm run db:generate         # generate a versioned SQL migration from schema changes
npm run db:migrate          # apply migrations to the local dev DB (reads .env.local)
node bin/papervine.mjs dev <dir>     # preview any docs repo (docs dev analogue)
node tests/crawl.mjs <dir>        # crawl a real repo, report rendered/degraded/500
```

## Database migrations (GitOps — schema changes ship as commits)

The schema is **versioned**: every change is a committed SQL migration, never a live
`push`. Flow:

1. Edit the Drizzle schema (`src/lib/db/schema.ts` = Better Auth, regeneratable;
   `src/lib/db/app-schema.ts` = our tables).
2. `npm run db:generate` → writes `drizzle/NNNN_*.sql` (+ `meta/`). **Commit it** and
   review the SQL like any code.
3. `npm run db:migrate` applies it locally. CI's e2e rebuilds `papervine_test` from these
   same files (`tests/e2e/global-setup.ts`), so a broken migration fails CI.
4. **Prod applies on deploy**: `vercel.json`'s build command runs `drizzle-kit migrate`
   before `next build`, so pushing the migration *is* shipping it (and each Vercel
   preview migrates its own Neon branch). No manual prod steps, no `push --force`.

drizzle's journal lives in a separate `drizzle` schema — a full reset is
`DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;` then
migrate. Destructive changes (drop/rename) need care: generate, **read the SQL**, and
prefer expand-then-contract.

## Conventions

- TypeScript strict, App Router / RSC. Server components by default; add `"use client"`
  only for interactivity (see `src/components/mdx/Tabs.tsx`, `Accordion.tsx`).
- Match the surrounding code's style, comment density, and naming. Comments explain
  *why* (especially the non-obvious gotchas above), not *what*.
- Keep `SPEC.md` / `GAP-REPORT.md` current when you make architectural decisions or
  change what renders — record the decision and the measured result.
- Don't commit unless asked. When you do, end commit messages with the Co-Authored-By
  trailer already used in this repo's history.
