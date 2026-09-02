# Working on Papervine

Papervine is a multi-tenant **docs.json-compatible docs platform**: it renders a docs site
from a Git repo of MDX + a `docs.json`. Read [`SPEC.md`](./SPEC.md) for the
architecture and roadmap, [`GAP-REPORT.md`](./GAP-REPORT.md) for what does and
doesn't render yet vs. representative docs repos, and [`docs/`](./docs/) for the evergreen
"how it works" reference — **written in Papervine's own MDX + `docs.json` format and
rendered by Papervine itself** (we dogfood; `node tests/crawl.mjs docs` is a CI gate).

This file is the contract for how to work in this repo. Follow it for every change.

The *process* half of this contract (the engineering loop, test routing, verification and
documentation discipline) is an instance of the reusable, project-agnostic doctrine in
[`playbook/`](./playbook/) — this file is its **Papervine binding**: the same laws mapped
onto this repo's commands, layers, and hard-won gotchas. Work from this file; read the
playbook chapter when you want the full reasoning. Starting a new project? Lift `playbook/`
wholesale and write a new binding (see `playbook/README.md`).

## Private planning

`_private/` is a local-only, gitignored workspace for business strategy, pricing
research, customer notes, launch plans, and private roadmap material.

Do not commit `_private/` or copy its contents into public docs, `SPEC.md`, tests,
issues, or commits. If a private decision affects public product behavior, write a
sanitized public summary here instead.

**Never name a real customer/client — anywhere.** `SPEC.md`, `docs/`, code comments,
commit messages, and PR descriptions are all effectively public. A bug report, a
debugging war story, a perf measurement, an example — all of it
gets written up generically ("a customer's monorepo", "a real customer API", "an embedded
customer site") instead of by name or domain, no matter how illustrative the specific case
was. This applies even when the name is also this project's own operator/company — the
rule is about customer-identifying info, not about any one name specifically.

**Competitor names: allowed on discovery surfaces, not in product prose** (decided
2026-08-23; SPEC §10.6). Naming competitors is how people find us, so the npm
`description`/`keywords`, the public `papervine/papervine` repo description/topics, and the CLI
README's Compatibility section deliberately say "docs.json-compatible" and "alternative to
GitBook / ReadMe". Keep the not-affiliated disclaimer, and never use another product's logo
or imply endorsement. **`docs/` prose stays neutral** — explaining our own feature by
reference to a competitor reads worse and ages badly. Also still fine anywhere: a factual
dependency name (`@mintlify/mdx`), the `mint` theme value, and internal design docs. So:
name them where people are *searching*, not where they're already *reading*. (This reverses
the blanket strip in SPEC's 2026-06-14 note — don't re-apply it to the discovery surfaces.)

The **marketing home** (`src/app/home/page.tsx`) is one of those discovery surfaces: it says
"docs platform alternative" in the hero copy and in the page's `title`/`description`/`keywords`
(added 2026-08-24). Same rules as the others — the claim is factual rather than positioning
(we read the same `docs.json`, so an existing repo migrates unchanged), it links to the migrate
guide that proves it, and it neither uses their logo nor implies endorsement. **Don't "fix" it
back to the generic wording.**

## Four docs directories, four jobs (don't merge them)

Each of these is a folder of MDX + `docs.json`, which makes them easy to confuse. They are
not interchangeable:

| Directory | Job |
|---|---|
| `docs/` | **The dogfood site.** Papervine's own documentation, rendered by Papervine. `node tests/crawl.mjs docs` is a gate. |
| `tests/fixtures/` | **Assertion-shaped edge cases.** Object favicons, `.md` pages, bad frontmatter, unknown components, marker strings for `CHECKS`. Deliberately ugly; never show it to anyone. |
| `examples/starter/` | **The forkable example**, published to `papervine/starter` (`npm run mirror:starter`). Also the CLI mirror's `examples/starter`, the site `db:seed` seeds from, and a CI crawl target. It's the component gallery — the one people judge the product by. |
| `content/` | The local dev default when `PAPERVINE_CONTENT` is unset. |

`examples/starter` earns its place in this repo rather than being maintained in
`papervine/starter` because **the monorepo depends on it**: `db:seed` builds `starter` and
`starter-gated` from it, and the latter is the reader-auth test bed whose `internal/*` pages
carry the `groups:` frontmatter that exercises SPEC §11.2. A fixture defined in a repo we
don't version is a fixture that can change under the tests relying on it. Seeding still
*fetches* it from GitHub on purpose — that exercises the real sync path — with
`PAPERVINE_STARTER_DIR` as a local override for offline work.

## The engineering loop (how every task runs)

Every feature, bugfix, or behavior change runs the same loop — full doctrine in
[`playbook/loop.md`](./playbook/loop.md); the Definition of done below is its exit
criteria. Compactly:

1. **Clarify before building** — ambiguities that change the design get asked **up front,
   batched in one round**; never ask what the code, `SPEC.md`, or this file already answers.
2. **Bugs: reproduce before fixing** — the repro *becomes* the regression test: write it
   failing at the right layer, then fix. (How the collab render loops were pinned.)
3. **Plan the test surface with the change** — pick the layers (routing table below)
   *before* coding; it shapes the design (pure cores extracted, no-DB fallbacks designed in).
4. **Loop until green** — typecheck → unit → smoke → real browser **with the console
   open** → e2e/crawl as applicable; a failed gate means fix and **re-run every affected
   gate**. Hand back "this works, here's what I ran" — never "this should work."
5. **Loop on review until quiet** — a PR isn't done when opened; see "The PR review
   loop" below.
6. **Document and report** — `SPEC.md` note + `docs/` page; anything unverified is
   labeled unverified.

## The PR review loop (Copilot and human reviewers)

Automated reviewers respond to pushes, so review is itself a loop with a cadence — run it
until a full cycle produces **zero new comments**, not until you've answered the first
batch:

1. **Fetch** open review threads: `gh pr view <n> --comments` for the overview;
   `gh api repos/{owner}/{repo}/pulls/<n>/comments` for the machine-readable list;
   thread IDs (needed for resolving) come from the GraphQL `reviewThreads` connection
   on the PR.
2. **Triage honestly.** Fix what's right. What's wrong gets a **reply explaining why**
   — never silently ignore a comment, and never "fix" something just to appease a bot
   (a wrong suggestion applied is a real bug with an audit trail saying you agreed).
3. **Push the fixes, then resolve the addressed threads** (GraphQL
   `resolveReviewThread`) so the PR's open-thread count reflects reality.
4. **Wait ~5 minutes** — Copilot re-reviews after a push — then re-fetch and repeat.
   In Claude Code, don't hand-poll: run the cycle with **`/loop`** (dynamic pacing,
   ~4–5 min) so it keeps itself going until the reviewer goes quiet.

Exit when a cycle ends with no new comments and no unresolved threads you haven't
answered. CI green + review quiet + DoD met = actually done.

## Definition of done

A feature/fix is not done until **all** of these pass:

1. `npm run typecheck` — clean.
2. `npm test` — the fixtures smoke test (boots the real renderer, asserts no page 500s).
3. **A regression test exists for what you changed, at the right layer** — see the
   routing table in "Always write tests" below (unit / smoke / e2e).
4. **Verified in a real browser** ([`playbook/verification.md`](./playbook/verification.md))
   — screenshot the affected page (`agent-browser`, light
   AND dark mode if visual). Don't claim a UI change works from the DOM alone; layout
   bugs (e.g. the card `h-full` height bug) only show visually. **And watch the console:**
   a whole class of React-correctness bug — `flushSync`-during-render, "Maximum update
   depth exceeded" render loops, hydration mismatches — is invisible in the DOM and in
   screenshots and shows up *only* as a console error (this bit the collaborative Visual
   editor). Assert it stays clean: an e2e that opens the surface and fails on any
   `pageerror` / React `console.error` (see `editor.spec.ts`) is the durable guard.
5. For renderer/config/nav changes: **crawl a representative docs repo** and confirm no
   regressions — `node tests/crawl.mjs <cloned-docs-repo>` (expect 0 × HTTP 500).
6. For control-plane / authed changes: `npm run test:e2e` green (needs docker
   Postgres + MinIO up).
7. **Documentation reflects the change in both places** — see "Document every change"
   below. `SPEC.md` gets the decision/status note; `docs/` gets the evergreen reference.

State plainly what you ran and what passed. If something is unverified, say so.

## Document every change (SPEC.md *and* docs/)

Every new feature or behavior change is documented in **two** places
([`playbook/documentation.md`](./playbook/documentation.md)) — they serve
different readers, so a change isn't done until both are current:

- **`SPEC.md` — the design log.** The *why*: the decision, the trade-off, the dated status
  note, the measured result, the roadmap impact. This is where "we chose X over Y because…"
  and "landed 2026-06-12" live. Keep `GAP-REPORT.md` current here too when you change what
  renders.
- **`docs/` — the evergreen reference.** The *how it works*, present tense, no dates. This
  is Papervine's own docs site (MDX + `docs.json`), so it dogfoods the renderer. Add or
  update the page under the right nav group in `docs/docs.json`; a brand-new surface gets a
  new page (and a nav entry). Then **crawl it**: `node tests/crawl.mjs docs` must report
  0 × HTTP 500 (it's a CI gate). Don't paste SPEC's dated notes into `docs/` — translate
  the mechanism into evergreen prose.

Rule of thumb: if you wrote a `SPEC.md` status note, you owe a `docs/` page edit, and vice
versa. New control-plane surface → both. Pure internal refactor with no behavior change →
neither (a code comment suffices).

**A new env var is a feature, not a footnote.** `.env.example` is where operators
*discover* a knob, not where they *learn* it — every configuration variable that changes
product behavior (a model/route, an executor, a local inference endpoint) also needs the
`docs/` page that explains when to reach for it and what happens when it's absent. If a
knob has no natural page, that's the signal a page is missing: `docs/local-ai.mdx` exists
because local inference had nowhere to live (it sits under Self-Hosting → "Configure it",
with the rest of the env-var surface). Same test as everything else — a reader who never
opens the repo should be able to operate the feature.

**`docs/` has three tabs, and the line between them is the reader, not the topic**
(`docs/docs.json`):

| Tab | Reader | Commitment |
|---|---|---|
| **Product Guide** | publishing a docs site | none — hosted or CLI |
| **Self-Hosting / CLI** | serving a docs repo themselves | a process; no database |
| **Control Plane** | operating the multi-tenant platform | Postgres, storage, auth, services |

Two consequences. **Anything a CLI self-hoster still needs must NOT be in the Control Plane
tab** — that tab is expected to be hidden from the public site later (mark each of its groups
`"hidden": true`; a tab has no `hidden` of its own — see
`docs/guides/navigation.mdx#hiding-a-group-or-a-whole-tab`), and hiding it must not take the
model config or the contributor guide with it. That's why `assistant-providers`, `local-ai`,
the renderer internals, and `contributing/*` live under Self-Hosting / CLI even though the
control plane uses them too.

And the trap that actually bites: not putting a page in the wrong tab, but writing operator
content **inside** a product page — which is how `docs/control-plane/collaboration.mdx` ended
up telling customers to set `COLLAB_JWT_SECRET`. The bar:

- A Product Guide page **may state an operator fact and link across** — "runs over a small
  always-on service; where it's unavailable the editor falls back", then a `<Note>` flagged
  **Self-hosting?** pointing at the page with the details. That's useful context.
- It **must not carry the procedure** — no `<Steps>` of run-this-container, no set-these-two-
  variables, no deploy-this-separately. Those live in Self-Hosting
  (`docs/background-services.mdx` collects the three services that can't live in a serverless
  function; `docs/local-ai.mdx` and `docs/features/assistant-providers.mdx` hold the AI env
  surface).

Test it by reader: a hosted customer reading a Product Guide page should never hit a sentence
addressed to somebody who deploys. "With no collaboration service configured…" fails that.

## Always write tests

Regression protection is a hard requirement, not optional
([`playbook/testing.md`](./playbook/testing.md) has the doctrine; this is its Papervine
mapping). **Route by the change you're making** — every row's tests are owed before the
change is done:

| You are… | You owe |
|---|---|
| Adding/changing pure logic (parsing, config, slugs, converters) | A unit test. Keep the helper pure; if the logic lives in something effectful, **extract its pure core** and test that. |
| Changing what the renderer does (MDX, components, nav, `docs.json` handling) | A smoke **fixture** reproducing the case + a `CHECKS` entry, and a crawl of a representative repo (0 × 500). |
| Adding code to any rendered page's path | Nothing new *if* it survives no-DB — ask "does this reach the DB, and does it no-op without one?" (`npm test` is the proof; see the smoke bullet). |
| Touching a control-plane / authed surface (dashboard, auth, editor) | An e2e spec for the journey; interactive React surfaces also get the **console-clean** assertion (`editor.spec.ts` pattern). |
| Fixing a bug (any layer) | A regression test **at the lowest layer that reproduces it**, written failing before the fix. |
| Building client interactivity / collab | Pure decision core extracted → unit-tested; the user journey → e2e. |
| Changing the DB schema | A committed migration (CI's e2e rebuilds `papervine_test` from it, so a broken one fails CI). |
| Touching what the **published CLI** ships (`apps/cli`, `packages/renderer` deps, `prepack`) | `npm run test:cli` — the clean-room gate. Every other suite runs with the workspace's hoisted `node_modules` in scope, so none of them can see an undeclared dep, a symlinked Turbopack external that `npm pack` drops, or the monorepo's own config compiled in. If it only breaks once installed, this is the only layer that catches it. |
| Touching `packages/renderer` **imports** | Also `npm run mirror:cli -- --dry-run`. It typechecks the renderer *outside* the monorepo, where root hoisting can't cover for an undeclared dependency. This is how `mermaid` was caught after `shiki` — and note it hid from `test:cli`, because the tarball is *built here*, where hoisting still works. Audit with the grep in `packages/renderer/README.md`, which matches dynamic imports too (a plain `from "…"` grep is what missed `mermaid`). |
| Refactoring with zero behavior change | No new tests — the existing suites staying green *is* the test. |

Rule of thumb: **the lowest layer that can catch the regression wins.** A unit test on an
extracted pure core is worth more than an e2e asserting the same fact — it's faster, runs
everywhere, and fails closer to the cause. Reach for e2e only for what genuinely needs a
browser + real services. Three layers — put the test where the logic lives:

1. **Unit (Vitest) — `tests/unit/`, `npm run test:unit`.** Pure functions, no DB/browser:
   `resolveTenantSlug`, `parseRepoInput`, `slugify`, config parsing. Fast; runs anywhere.
   If you add a pure helper, unit-test it (and keep it pure — `"use server"` files can't
   export sync helpers, so extract them, e.g. `src/lib/slug.ts`). **Effectful client logic
   still gets a unit test — by extracting its pure core.** The editor/collab code does this:
   the MDX↔ProseMirror converter is a pure library (`mdx-prosemirror-*` tests, the fidelity
   gate); the Visual carets' decision layer is `visual/caret-plan.ts` (`collab-carets.test.ts`
   — self-filtering, doc-bounds clamping, selection-vs-caret); the same-browser sync protocol
   runs headless over Node's `BroadcastChannel` (`collab-broadcast.test.ts`); and the collab
   service's room-isolation gate (`apps/collab/src/auth.ts` `authorizeConnection`) is pinned by
   `collab-auth.test.ts` (forgery / expiry / wrong-room). Reach for a `vi.resetModules()` +
   dynamic import when a module captures env at load (the collab secret), and a `window` shim
   when a browser class only needs `addEventListener`.
2. **Smoke (zero-dep) — `tests/smoke.mjs`, `npm test`.** The renderer + control-plane
   **gate**, no Postgres so it runs in CI everywhere — which means **the renderer must survive a
   missing DB.** `waitForReady()` probes `GET /` and needs a 200; any DB call on a rendered path
   that *throws* without Postgres (not returns null) 500s that probe and fails the whole gate on
   "server did not become ready" — invisible locally, where a dev DB is reachable. So tenant
   lookups (`getSiteBy*`) short-circuit in `PAPERVINE_CONTENT` single-repo mode, and `getSiteByHost`
   catches connection errors → null. When you add code to a page's render path, ask "does this
   reach the DB, and does it no-op without one?" **To cover a new renderer case, add
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
   deterministic. A spec that needs an **optional** always-on dependency (the collab socket
   service) `test.skip`s itself unless its env is set — the remote-caret test skips without
   `NEXT_PUBLIC_COLLAB_URL`, which `playwright.config.ts` forwards to the app only when the
   operator exports it (and starts `apps/collab`). Two `browser.newContext()`s model two
   machines; same-browser BroadcastChannel does **not** sync cursor awareness, so carets
   can't be faked with two tabs. The webServer runs with `NODE_OPTIONS=--max-old-space-size=6144`
   (`playwright.config.ts`) — without it, CI's cgroup caps Node at ~2GB and `next dev`
   compiling the app on-demand across the suite crosses its memory threshold and **self-restarts
   mid-run**, and each restart is an `ERR_CONNECTION_REFUSED` window that cascades spec failures
   that look like flakes but aren't.

CI (`.github/workflows/ci.yml`): five **parallel** jobs cover what `verify` used to run
sequentially — `checks` (typecheck + unit), `build`, `smoke`, `crawl`, `cli-package` — and
**`verify` is now an empty aggregator** that needs all five. They're independent (smoke and the
crawl each spawn their own `next dev` on their own distDir; the clean-room test builds inside
the packed tarball), so running them at once turned an ~8m20 critical path into roughly the
slowest single job. Keep `verify` as the name the deploy jobs gate on — that's the whole point
of the aggregator, and why splitting the work needed no change downstream. Separately, the
`e2e` job runs Playwright against a Postgres service (skipping `@external`). Keep them all green.

### Deploys are gated on the tests

**Production deploys from CI, not from the push.** Vercel's Git integration used to deploy the
instant it saw a commit, in parallel with this workflow and with no knowledge of it — so a red
run and a live production deploy of the same commit could coexist, and `next build` failing was
the only thing that ever stopped a bad one (type and compile errors; not unit, not smoke, not
e2e). So `vercel.json` sets `git.deploymentEnabled: { main: false }` and the
**`deploy-production`** job — `needs: [verify]` — is the only path to prod.

Consequences worth knowing:

- **Branch and PR previews still auto-deploy.** Only `main` is gated; gating previews would
  remove the thing they're for.
- **`e2e` is deliberately NOT in the gate**, and this was measured rather than assumed. It held
  the deploy for exactly one push: run `32896746146` passed *with 3 flaky tests* (failed, passed
  on retry), then run `32897972504` — a commit touching only `vercel.json` and three markdown
  files — failed `widget-settings.spec.ts:31` on both attempts. Same code, opposite verdicts
  twelve minutes apart. Gating on that isn't "don't ship broken code", it's "shipping is a coin
  flip". e2e still has to be green to merge; it just doesn't hold the deploy. The gap until then
  is the authed dashboard journeys. Never `continue-on-error`: that would make the job green
  while shipping the failure it exists to catch.
- **That spec's cause was found (2026-08-27): a test budget, not a flake.**
  `widget-settings.spec.ts` is the only visitor to `settings/widget`, so its first navigation
  always cold-compiles that route, and it runs *last* in a single-worker suite. On Playwright's
  default 30s budget that alone timed out — and the test then spent up to 15s more in a
  `.toPass` loop that `page.reload()`ed the whole page to observe one boolean. Fixed by the
  pattern `connect-github.spec.ts` and `dashboard.spec.ts` already use (`test.slow()` plus
  headroom on the first assertion, since `test.slow()` doesn't raise the per-assertion 5s), and
  by replacing the reload loop with a DB poll + one reload. **`⨯ Error: The destination stream
  closed early.` in the webServer log is a red herring** — it's Next reporting that the client
  aborted a stream, i.e. the *symptom* of Playwright giving up; it appears on passing runs too.
  Don't chase it.
  **Re-gating is still not done, on purpose:** CI is ~4× slower than a dev machine (this suite:
  7.6m there, 2.0m here), so the failure cannot be reproduced locally and one green local run
  isn't evidence. Put `e2e` in `needs:` after several consecutive green CI runs on `main`, not
  on the strength of the fix looking right.
- **Same root cause, two more specs (2026-08-29): `members-roles` and `domain`.** Both own a
  route nothing else visits, so both cold-compile it, and neither had `test.slow()`. They present
  differently enough to look like separate bugs: `domain` overran the 30s test timeout *during*
  its first `page.goto`, so the navigation was aborted and Playwright reported
  `net::ERR_ABORTED; maybe frame was detached?` — which reads as a crashed page rather than a
  clock running out. And `members-roles` asserted `toHaveValue("admin")` on a select that is
  CONTROLLED by server data with no optimistic state, so the DOM cannot show the new value until
  the whole round trip lands (server action → Better Auth → `router.refresh()` → route
  re-rendered and streamed back); the 5s per-assertion budget is not that budget on a cold route.
  The give-away in the log is the locator resolving over and over to a still-`disabled` select
  holding the old value — pending, not broken. **When an e2e assertion watches a controlled input
  change, the budget it needs is the server round trip, not the render.**
- **A missing Vercel secret fails the job loudly**, unlike `deploy-trigger`, which exits 0 when
  unconfigured. A skip here would mean production silently stops receiving deploys.
- The build still runs **on Vercel**, so `vercel.json`'s `buildCommand` stays the one definition
  of how prod is built. Don't move it onto the runner.
- **If a deploy is ever stuck**, `gh run rerun <id> --failed` re-runs just the failed jobs and
  lets `deploy-production` proceed — no empty commit needed.

## Driving the app to test it (seeded login + browser)

When a change needs hands-on verification (DoD #4, or the user says "go test this"), don't
hand-walk signup → onboarding. Seed a known account and drive a real browser:

- `npm run db:seed` (`scripts/seed-dev.mjs`) creates **two known logins**, both password
  **`password`** — **`dev@papervine.local`** (owner) and **`dev2@papervine.local`** (admin) —
  as members of the same org, so you can log in as both (two browser profiles) to exercise
  real-time collab (SPEC §9.2; same-browser tabs share a BroadcastChannel and can't show
  cross-machine remote carets). Plus an org and connected sites with activity + analytics
  data. It's a **full reset**: it first truncates every dev/tenant table and clears the
  content bucket's `sites/` prefix (keeping only the `billing:sync` catalog), so leftover experiments — extra
  orgs, hand-connected sites — are gone and the DB holds *only* the seed. **Prod-guarded**
  (refuses any non-localhost `DATABASE_URL`). Needs `docker compose up` (Postgres + MinIO).
  With a **sandbox** `AUTUMN_SECRET_KEY` in `.env.local` it also creates the seeded org as an
  Autumn customer on the 30-day trial (`scripts/sync-autumn-customers.mjs`, the same backfill
  that will put production orgs into live Autumn when that key flips) — without the key, billing
  is simply absent and every org is Free; with a live key it refuses to sync. Seeded sites (all from **`papervine/starter`** except
  the scale test — one repo to rule them all: the forkable user example AND the renderer/
  reader-auth test bed):
  - **`starter`** — reader-auth OFF: the public showcase.
  - **`starter-gated`** — reader-auth ON (JWT, with a real generated Ed25519 keypair): the RBAC
    test bed. Its `internal/*` pages carry `groups:` frontmatter. To verify the per-page gate +
    nav-hiding (SPEC §11.2), just open **`starter-gated.localhost:3000`** — a JWT site's `/login`
    shows a **dev-only "sign in as a test reader"** card (a group picker; hard-gated to
    non-production) so a gated site is testable in-browser without an IdP. (CLI alternative that
    exercises the real EdDSA handshake: `node --env-file=.env.local scripts/sign-reader-jwt.mjs
    --groups admin` prints a `…/login/jwt-callback#…` URL.)
  - **`large-docs`** — a large repo for exercising the renderer at scale.

  All seeded sites are **Git-backed** (`source_kind = 'git'`). To exercise a
  **Papervine-hosted** site (SPEC §10.11) there's nothing to seed — create one through the
  product in a few seconds: `app.localhost:3000/dev-org/connect` → *Start from scratch* → name
  it. It's seeded with starter content and live immediately, which is the point. (Adding one to
  `db:seed` would be reasonable if hosted sites become a frequent test bed.)
- **Testing the authoring MCP's write auth** (SPEC §9.2/§11): `node scripts/authoring-mcp-login.mjs`
  drives the whole OAuth flow the way a real MCP client does — registers a client, opens the
  authorize URL, captures the code on a loopback callback, exchanges it for a token, and calls
  the MCP with it, so a failure names the step that broke. `--write` also proves an edit buffers
  onto a draft branch (an identity edit; it changes nothing). `--origin` points it at production,
  `--no-open` suits a headless box. The printed token is good for an hour, so you can curl the
  endpoint directly afterwards. The one-credential half — a browser with a dashboard session —
  needs no script; it's just the endpoint in a signed-in tab.
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
- **Embeddable widget (SPEC §8.7):** `npm run widget:playground` (`scripts/widget-playground.mjs`)
  serves a real "customer site" on a genuinely different local origin (`localhost:8080` by
  default) with the actual embed snippet — same-origin testing inside the app would hide the
  cross-origin-only bugs this surface has actually hit (a CORS bug, a citation-link-resolves-
  to-the-wrong-host bug). Auto-detects the running dev server's port, lazily mints a
  `widget_id` and allowlists its own origin on the target site (`starter` by default, prod-
  guarded the same way as `db:seed`) so it works against a freshly-seeded DB with zero manual
  dashboard clicks. Serves `/` (default `init()`), `/single-tag` (`data-widget-id` auto-init),
  `/bare` (loader only, drive `init()` yourself from devtools), and `/custom?opts={...}` (any
  `init()` options as a JSON query param, e.g. `?opts={"theme":"light","variant":"modal"}`) —
  covers every install method and the full option surface without editing a file.

## How the renderer works (don't break this)

MDX rendering is a **hybrid** (`src/lib/mdx.tsx`): compile with a third-party serializer's
`serialize` output for Shiki dual-theme highlighting + snippet handling, then execute the compiled output with `@mdx-js/mdx`'s `run()` inside a
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
- **`docs.json` is docs.json-compatible.** Match the documented schema/behavior so real repos
  migrate unchanged. The **authoritative schema is the JSON Schema at
  `https://papervine.io/docs.json`** (what real repos set as their `$schema`) — consult it
  for field names/shapes/enums before adding or changing config handling. When behavior isn't
  captured by the schema, verify against representative docs repos; don't guess.

## Gotchas (learned the hard way — don't rediscover these)

This is the repo's gotcha log ([`playbook/gotchas.md`](./playbook/gotchas.md) — what
qualifies and how to write an entry). When a debugging session meets the bar, add it here.

- **dev/prod JSX runtime must match.** Compile (`serialize`) and `run()` must use the
  same `development` flag / runtime, or React 19 throws "production element rendered
  in development". This is why we left plain `next-mdx-remote`.
- **The third-party MDX serializer package has a broken peer dep** (`@radix-ui/react-popover@^19.2.1`,
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
  on the parent domain by the app-host middleware, read by the marketing nav. It reaches tenant
  subdomains (parent-domain cookie), so it's **httpOnly** (+ Secure in prod) — tenant page JS
  can't read it — and cleared **server-side in the middleware** on logout (a client clear can't
  touch httpOnly). Logged-in users who hit `/login`/`/signup` on the app host go to the dashboard
  (the `app.example.com/signup` behavior). **Dev caveat:** Chrome rejects `Domain=localhost`
  cookies, so the flag (and thus `www`'s Dashboard link) only works in prod (`.papervine.io`);
  the redirect-to-dashboard behavior works everywhere. Don't "fix" the missing dev label by
  sharing the real session cookie.
- **A stale session cookie can loop `/login` forever — clear it on the `?stale=1` self-heal.**
  The edge middleware gate is **presence-only** (`getSessionCookie` — no DB call), so a cookie
  that's *present but invalid* (server-side session gone: expiry, a revoke, or a dev `db:seed`
  reset) reads as "authed": `/login` → `/` (bounce), the app-side `getSession()` finds no session
  → `redirect("/login")` → bounce again → `ERR_TOO_MANY_REDIRECTS`. Fix (don't regress it): the
  authoritative checks redirect to **`/login?stale=1`** (`app/page.tsx`, `dashboard-context.ts`),
  and middleware, on `/login?stale=1` with a cookie present, **clears the session cookie(s) +
  the flag** and renders login instead of bouncing. The middleware gate stays presence-only (no
  per-request DB); the `?stale=1` signal is what makes it self-heal. Guarded by a smoke check.
- **Two theme systems — `dark:` only works in the platform via `.db`.** The *docs/marketing*
  appearance toggles the `.dark` class (`localStorage['theme']`); the *platform* toggles
  `data-db-theme` on `<html>` (`localStorage['pv-theme']`, default dark), read by the `.db`
  palette in `platform.css`. Tailwind's `darkMode` is a two-selector variant: `.dark` **plus**
  `[data-db-theme="dark"] .db` (`tailwind.config.ts`). So in platform components (dashboard,
  editor) `dark:` utilities Just Work — but only because the element is inside a `.db` shell
  (`PlatformShell`); a `dark:` utility on an element *outside* `.db` (e.g. on `<body>` itself)
  won't see the platform theme. This is why the editor chrome once rendered all-white on the
  dark platform. Don't add a global `.dark` sync — it would flip light-appearance docs pages.
- **A literal HTML element in MDX bypasses the components map.** `<video src="/x.mp4">` written in a
  page compiles to a bare `_jsx("video", …)`, not `_jsx(_components.video, …)` — so an override
  registered as `out.video` in `applyTenantUrls` is never consulted, and it fails *silently*
  (typechecks, reads correctly, does nothing). Only markdown-emitted elements (`![]()` → `img`) and
  capitalized components go through the map. The fix is always the same rename trick: a remark
  plugin retags the element to a capitalized synthetic name (`remarkLiteralImg` → `PvImg`,
  `remarkLiteralMedia` → `PvVideo`/`PvSource`/`PvAudio`/`PvIframe`) and the map holds an override
  that renders the real tag back. Two traps when you add one: register it **unconditionally**, or a
  renamed element with no entry hits the unknown-component Fallback and vanishes from the page; and
  **bump the `mdx-compile-vN` cache key**, because the key is content-addressed on the source and a
  cached compile keeps emitting the old output. This is how video 404'd on every surface with an
  `assetBase` (path-based serving, the editor's draft preview) while the image beside it worked.
- **Never hand a mutable handle to a TipTap `configure()` — pass a getter.** `Extension.configure()`
  merges options with `mergeDeep`, which **recurses whenever the default and the supplied value are
  both plain objects**. A React ref is `{ current }`, so it gets *copied*: the extension reads its
  own object forever while React writes to the original. Nothing errors and nothing warns. This is
  why the `/` menu's arrow/Enter navigation silently never worked — arrows fell through to
  ProseMirror, which moved the caret out of the `/query` and closed the menu, and Enter fell through
  too, so items could only be picked with the mouse. Worse, `options` is a *getter* that re-merges
  on access, so it reads correctly if you poke at it — the damage is that extension code captures
  it **once** (`const opts = this.options` in `addProseMirrorPlugins`, at editor-construction time)
  and that snapshot never sees a later write. Pass a function instead (`onKeyDown(props)`,
  `getAwareness()`): function values are copied by reference and can't be re-broken this way.
  Pinned by `tests/unit/slash-command-options.test.ts`, which needs no browser.
- **An unstable prop on a TipTap React component rebuilds every ProseMirror plugin — silently.**
  `<DragHandle>` (`@tiptap/extension-drag-handle-react`) `unregisterPlugin`s + `registerPlugin`s
  inside a `useEffect` whose deps include `onNodeChange`, so an **inline arrow** there is a new
  dep on every render. Reconfiguring the plugin set makes ProseMirror destroy and rebuild *every*
  plugin view, and whatever state those hold is gone. That's what made the `/` menu report
  "No matching blocks" inside a `<Tab>`: the suggestion plugin resolves its items **asynchronously**
  (`await items({query})` even for a synchronous filter), so the menu opens empty and is filled a
  microtask later — and the teardown fired `onExit` + aborted that lookup first, freezing the menu
  on its empty state. Every keystroke tore the plugins down; it only *showed* inside components,
  where the teardown lands between the open and the resolution rather than after it. So: **every prop feeding a TipTap React component's effect
  deps must be identity-stable** (`useCallback` / a ref). Related ordering trap in the same fix —
  if you defer a menu's *open* out of the render phase with `queueMicrotask`, defer its *close*
  too, or a synchronous close is applied before an open queued ahead of it and the menu sticks.
  Guarded by an `editor.spec.ts` case that types `/` inside a tab pane.
- **`autumn-js` camelCases every response; Autumn's docs, REST API, webhooks and MCP are
  snake_case — and a fixture written from the docs passes against code that reads the SDK wrong.**
  The adapter's types said `plan_id` / `trial_ends_at` / `add_on` / `overage_allowed` /
  `variant_details.base_plan_id`; the SDK sends `planId` / `trialEndsAt` / `addOn` /
  `overageAllowed` / `variantDetails.basePlanId`. Every one of those reads was `undefined`:
  no trial end (the expiry backstop never fires), no overage (an opted-in org is refused at
  zero), a credit pack indistinguishable from the plan, and the annual variants shown as
  separate cards. Typecheck was clean (the types are open), and `billing-autumn.test.ts` was
  green — its "verbatim capture" fixture had been transcribed from the MCP's snake_case output,
  not from the SDK. It surfaced only because the customer-sync script printed `plans: none` for a
  customer Autumn showed on `pro_trial`. The fix is one boundary: every SDK read in
  `src/lib/billing/autumn.ts` goes through `snakeCaseKeys` (`autumn-keys.ts`), so the rest of the
  billing code keeps the documented spelling. Two rules from it: **a fixture is a capture only if
  it came from the same client the code uses** (`tests/unit/fixtures/autumn/*.json` are the SDK's
  own output, run through the normaliser in the test exactly as production does), and **when an
  SDK and its API disagree on spelling, pick one at the edge** — never read both spellings
  ad hoc, or the next field will be the one nobody dual-read. **Vocabulary is spelling too:**
  Autumn has no `trialing` status — a trial is `active` + `trial_ends_at` — and the core's
  `trialStatus` only recognises `trialing`, so the seeded trial showed "Renews Oct 1" as if paid.
  `subscriptionStatus` (autumn.ts) is the one translation; a new status-dependent read goes
  through it, not `sub.status`.
- **A random dedupe key is not a dedupe key.** `fireContentUpdateAutomations` is the
  self-trigger loop breaker for `content_update` automations: an automation's own commit
  re-syncs under a sha that already has a run row, so it doesn't re-fire. Its no-sha fallback
  used to be `manual-sync-${randomUUID()}` — a *fresh* key every call, which silently defeats
  the whole mechanism for any content change without a commit. Papervine-hosted sites (§10.11)
  have a null sha **always**, so an automation that published would re-trigger itself until
  `DAILY_RUN_CAP` (500/day) stopped it — bounded, but 500 AI runs a day of real money. The
  parameter is now a general `ref` and callers pass something **stable for that deployment**
  (`commit?.sha ?? deploymentId`); an automation's own publish additionally passes
  `origin: "automation"` to suppress the fan-out. If you add a new "content changed" path, its
  ref must be stable across retries of the same change — never freshly random.
- **`markSiteLive`'s `updatedAt` bump is the invalidation; the tags are a nicety.** The content
  cache's version key is `${lastSyncedCommitSha ?? ""}:${updatedAt}`, and a Papervine-hosted
  site's sha is null forever — so `updatedAt` is the *entire* key and skipping the bump serves
  the pre-publish copy indefinitely. That's why the bump lives in exactly one place
  (`src/lib/deployment-log.ts`) and why its `revalidateSiteRow`/`revalidateSite` calls are
  wrapped in try/catch: `markSiteLive` is reachable from a Trigger.dev task and from `after()`,
  neither of which has a Next request context, and by then the bytes are already written.
- **`scripts/dev.mjs` only sees `.env.local` because `npm run dev` passes
  `--env-file-if-exists`.** Node does not load `.env.local` on its own, and the dev
  orchestrator's `when()` predicates read `process.env` directly. For a long time the `dev`
  script had no `--env-file` (every other script in package.json does), so the entire
  declared-intent mechanism was **inert** for config kept in `.env.local` — which is exactly
  where this repo says to put it. Stripe webhook forwarding never started for anyone, and the
  hint that was supposed to explain why never fired either, because each `hint()`
  short-circuits on the same variable it's reporting about. If you add a layer, verify it
  actually starts (`npm run dev` prints `running N process(es)`) rather than trusting the
  predicate to be reached.
- **`next dev` rewrites `next-env.d.ts` AND `tsconfig.json` to point at its distDir — so the last
  harness you ran owns your typecheck.** Next wires up generated route types by editing two files
  in the checkout: `next-env.d.ts` gets `import "./<distDir>/dev/types/routes.d.ts"`, and
  `tsconfig.json` gains `<distDir>/types/**` includes. Each harness runs with its own
  `NEXT_DIST_DIR`, so after `node tests/crawl.mjs` those files point at `.next-crawl` — a snapshot
  frozen at that moment. Add a route, typecheck, and Next's route-export validator rejects it with
  `params: Promise<unknown>` and nothing naming the cause; the generated types in `.next` are
  perfectly correct and simply aren't the ones being read. tsconfig `exclude` **cannot** save you
  here — `next-env.d.ts` imports the file explicitly, and an import always beats exclude. Fixes,
  in place on all three paths: smoke and crawl snapshot/restore both files (`protectNextEnv` in
  `tests/dev-lock.mjs`), `npm run test:e2e` goes through `scripts/e2e.mjs` which canonicalises them
  after Playwright exits (`tests/e2e/restore-config.mjs`), and tsconfig excludes `.next-*/**` so the
  `**/*.ts` glob can't sweep stale harness types back in. Two e2e approaches that DON'T work, so
  nobody retries them: a `globalTeardown` hook runs *before* Playwright stops the webServer, so
  `next dev` rewrites the files again on its way out; and snapshotting at config load fails because
  Playwright imports the config more than once, re-snapshotting the already-rewritten files. If you ever see `Promise<unknown>` for params on a route you just
  added, check what `next-env.d.ts` imports before touching the route. Also: routes here
  hand-write `params: Promise<{…}>` rather than using the generated `LayoutProps<…>`/`PageProps<…>`
  — CI typechecks BEFORE building, so on a clean checkout those helpers don't exist yet.
  **Only those three paths are protected.** `node bin/papervine.mjs dev` is normally safe because
  it uses the default `.next`, which is already in tsconfig — but give it a `NEXT_DIST_DIR`
  (e.g. to preview `docs/` alongside a running dev server) and it writes that dir into BOTH
  files, so `tsconfig.json` turns up in `git status` as a change you didn't make and your
  typecheck reads a dist dir you then deleted. `git checkout tsconfig.json` and point
  `next-env.d.ts` back at `.next` when you're done.
- **A ROOT route on a rewritten host needs an explicit middleware bypass — or it 404s and you
  never hear about it.** Every non-apex host class rewrites its whole path space: the app host
  onto `/app/*`, a tenant subdomain onto `/sites/{slug}/*`, a custom domain onto
  `/custom-domain/*`. So Sentry's tunnel (`tunnelRoute: "/monitoring"` in `next.config.mjs`, a
  root route the browser POSTs to so ad blockers don't eat error reports) became
  `/app/monitoring` → the auth gate → **307 to `/login`**, and `/sites/{slug}/monitoring` → 404.
  Sentry silently dropped every browser report from the dashboard and from every tenant docs
  site — everywhere except the marketing apex, which is where errors matter least, and nothing
  surfaced it but 404s in a user's console. `SENTRY_TUNNEL` is now bypassed in all three
  branches. If you add any other root-level route that isn't under `/api/`, add it to those
  bypasses too. Guarded by a smoke check that asserts `/monitoring` on the app host is NOT
  bounced to `/login` (a status assertion would depend on whether a DSN is configured).
  **The list only grows:** `AUTHORING_MCP`, `WELL_KNOWN_OAUTH` (both OAuth discovery documents),
  `CRAWLER_FILES` and `BRAND_PREFIX` are bypassed on the app host for the same reason. The OAuth
  ones are the sharpest case — a client asking "how do I authorize here?" answered with a 307 to
  a login page reads as "this server doesn't support authorization" — and each has its own smoke
  check. The `/device` approval page (SPEC §11.4) is a *different* exception, alongside
  `/accept-invite` and `/oauth/consent`: those are bare-URL `(auth)` pages that must reach their
  own **signed-out** render rather than the edge bounce, because that render is what carries the
  flow onward (for `/device`, the sign-in links holding the user code the CLI printed).
- **Node does not resolve `*.localhost`; browsers do.** `app.localhost` works perfectly in Chrome
  and fails with `getaddrinfo ENOTFOUND` from anything using Node's DNS — which includes
  Playwright's `APIRequestContext` (so an e2e that drives a page on `baseURL` fine cannot
  `request.post` the same host) and the published CLI (`papervine login --url
  http://app.localhost:3000` dies before sending a byte). Neither says why, because **`fetch`
  reports every transport failure as the bare string "fetch failed"** and hides the real error on
  `.cause` — DNS, refused connection and TLS all read identically. So: address `127.0.0.1` from
  Node and let the *browser* have the `app.localhost` URL (`tests/e2e/device-auth.spec.ts` does
  exactly this — the `/api/auth/*` endpoints answer on either host), and unwrap
  `err.cause.message` before printing a network error to a user.
- **A better-auth plugin whose options are typed `Partial<…>` can still have a REQUIRED runtime
  field — and the failure is a module-eval throw.** `deviceAuthorization`'s Zod schema declares
  `schema: z.custom(() => true)` with no `.optional()`, so omitting the key throws a ZodError
  while `src/lib/auth.ts` is being *imported*. TypeScript is happy and typecheck passes; the app
  then 500s every page that touches auth while every page that doesn't renders perfectly — which
  reads as an unrelated regression somewhere else entirely (the tell here was the widget route's
  unknown-id 404 turning into a 500, three files away from anything we'd changed). Pass
  `schema: {}` — a no-op through the plugin's `mergeSchema`. General lesson: after adding any
  better-auth plugin, load a page that reads a session before trusting the typecheck, and keep
  `npm test` in the loop — the smoke gate caught this precisely because it exercises pages on
  both sides of that line.
- **The index page has two spellings — normalize before comparing a nav href to a page slug.**
  `listPageSlugs()` reports the index page as **`""`** (its route is `/`, see `s3-source.ts`),
  while `docs.json` writes it as **`"index"`** and `buildNav` emits the href **`/index`**. So any
  code that diffs "pages that exist" against "pages in the nav" by raw string finds the index page
  in neither set and reports it as unlisted — with an empty label. This is what made the nav
  tree's "Add existing page" submenu look *empty*: on a site where every other page was listed,
  a single blank row was the whole menu. Compare through `canonicalSlug` / `unlistedPageSlugs`
  (`src/lib/nav-edit.ts`), and write the canonical form into `docs.json` — an empty nav entry
  resolves to nothing.
- **A spec's `process.env.X ?? fallback` IS the fallback — `test:e2e` loads no env file.**
  `npm run test:e2e` is a bare `playwright test`, so the *spec* process has no `S3_*` (the
  config's `webServer.env` block configures the **app**, not the test). `editor.spec.ts` built
  its S3 client from `process.env.S3_ACCESS_KEY_ID ?? "minioadmin"` and therefore always used
  `minioadmin`, which this MinIO doesn't have — every test in the file died in `beforeAll` with
  `InvalidAccessKeyId`, which reads like "MinIO is down" rather than "the constant is wrong."
  Shared e2e infrastructure values live in **`tests/e2e/constants.ts`** (`TEST_S3`) and are read
  by both `playwright.config.ts` and the specs, so there's one definition to be right. A
  defaulted env read in a spec is a smell: prefer an imported constant, since the default is the
  only branch that ever runs.
- **A spec that seeds a site row with raw SQL must use a run-unique slug — the row is cached for
  60s and only `revalidateSiteRow` busts it.** `getSiteBySlug` wraps its query in
  `unstable_cache` tagged `site-row:slug:{slug}` with `SITE_ROW_TTL = 60`; every *product*
  mutation goes through `markSiteLive`/`revalidateSiteRow`, but an `INSERT` from a spec doesn't.
  So re-running a spec inside that window renders the PREVIOUS run's row — which, for
  `rollback.spec.ts`, named a content revision that run had since rolled away from, and the very
  first assertion failed on content the test itself had just written. It reads as a broken render
  path; it's a stale row. A run-scoped slug (`` `rollback-tenant-${randomUUID().slice(0, 8)}` ``)
  sidesteps the cache entirely by changing the key. **Same shape, second trap:** revision prefixes
  are *immutable by contract* and the content cache keys on the revision id, so a spec that reuses
  a revision id while changing the bytes underneath is served the old bytes forever — correctly.
  Scope those per run too.
- **An order-dependent e2e assertion passes alone and fails in the file.** The publish-toast spec
  asserted the `"No open edit session for this branch."` message, which is only true when no
  earlier test in the file has opened one — and each load-then-type test does. Opening the editor
  alone doesn't create a session (writing does), so it passed in isolation and got whatever a
  real publish returned in file order. Specs share one Postgres and run `workers: 1` in
  declaration order: **set up the precondition you assert on** (this one now deletes open
  sessions + their `draft_file` rows first) rather than inheriting it from whatever ran before.
  Related: this file's failing set genuinely shifts between runs, so re-run before concluding
  your change broke a spec.
  **The inverse costs more: inheriting a row an earlier test created turns one failure into
  several.** `automations.spec.ts` read its `automation` row straight out of the DB, where the
  *first* test in the file had created it through the UI (which is that test's whole point). So
  when the toggle test failed, the next two died on `auto.id` in ~200ms — reported as three
  broken features instead of one, and unrecoverable on retry because a retry re-runs the test,
  not the precondition. They also couldn't be run alone at all (`--grep` found no row). The fix
  is an **idempotent** `ensureAutomation()` helper: find the row or create it, so the toggle
  test still creates it via UI and the later tests stop caring who did. When a test needs
  something another test makes, make it yourself if it's missing.
- **A static import is paid by every route that can reach it, and the smoke gate bills per
  check — so "it compiles" is not the same as "it is free".** Two versions of this bit in one
  sitting, both showing up as `request failed: timeout` on a *marketing* page that the change
  never touched, both green locally and red on CI (which is ~4× slower, so the runner is the
  only place the extra compile crosses the 30s-per-request line).
  - **The shared shell.** `PlatformShell` wraps eleven routes; adding
    `import { GradientWaves }` for a shader one page uses put it in all eleven graphs, and
    `/home` (two backdrop fields plus the Ask demo) went over. Fix: the shell takes
    `backdrop?: React.ReactNode` and `/pricing` passes the node, so the module is genuinely
    not imported anywhere else.
  - **The renderer, via a two-hop import nobody looks at.** `render-tenant.tsx` →
    `powered-by-store` → `billing/autumn` → a static `import { Autumn } from "autumn-js"`,
    which is a **36MB dist**. Every tenant docs page compiled the whole billing SDK. Fix:
    `import type` (erased) plus `await import("autumn-js")` inside the accessor, the same
    shape `PrismaticBurst` uses for `ogl`.
  The general rule: before adding a dependency to anything reachable from `render-tenant.tsx`,
  `PlatformShell`, the root layout or middleware, ask what its dist weighs — and if the module
  is only needed at call time, import it dynamically. **The diagnostic that turns this from a
  guess into a fact is checking `main`'s own tip in CI**: same job, green there and red here
  means it is yours, not the documented e2e flake. Two consecutive identical failures mean a
  budget, not a race.
- **A dev server that dies mid-suite prints nothing where you are looking — read the
  `[WebServer]` lines, not the test verdicts.** The e2e shard that kept failing showed 20
  tests failing in ~200ms each after one slow one. That shape is a dead server (every
  `page.goto` → `ERR_CONNECTION_REFUSED`, every `request.post` → `ECONNREFUSED 127.0.0.1:3210`),
  not twenty bugs — but the three explanations reached for first were all wrong, in order:
  "the runner is flaky" (it reproduced 3× on identical code), "the heavy shard runs out of
  memory" (`free -m` after the run: 1.3GB used of 7.9GB, no kernel kill — the instrumentation
  in `ci.yml` exists because this guess cost a run), and "danger-zone deletes something" (it
  only opens a modal). The actual cause was seven `[WebServer]` lines between two test
  verdicts: **Turbopack panicked** (`turbo-tasks-backend … aggregation_update.rs …
  inner_of_upper_lost_follower is not able to remove follower … Aborting.`) and the process
  exited. Two lessons. (1) When failures go fast and identical, `grep '\[WebServer\]'` around
  the first one before theorising — the server's last words were there the whole time. (2)
  **Do not restore Turbopack's dev filesystem cache (`<distDir>/dev/cache`) across CI runs.**
  Next 16 has it on by default and it looks like a free compile win; it produced that panic on
  every run that restored a cache from another shard or commit and on none that compiled cold.
  The persisted task graph disagrees with the live one and the invariant fails. Reported
  upstream; `RUST_BACKTRACE=1` is set on the e2e step so the next panic explains itself.
- **Tests run alongside `npm run dev` — each harness owns its own `distDir`.** Next allows one
  `next dev` per *distDir* (it holds `<distDir>/dev/lock`), and two dev servers sharing one
  output tree also interleave their compiled chunks and manifests — which is how running the
  smoke gate while dev was up corrupted `.next` and forced a `dev:fresh`. `next.config.mjs` now
  reads `distDir: process.env.NEXT_DIST_DIR || ".next"`, and each harness sets its own
  (`.next-smoke`, `.next-crawl`, `.next-e2e`). So separate output, separate lock, and — since
  e2e already used `papervine_test` — separate database. **Unset stays `.next`**, so `next build`
  and Vercel are untouched; verify that if you change this (a `.next/BUILD_ID` after
  `npm run build` is the check). Costs ~700MB per harness dir; `.next-*/` is gitignored, and
  `dev:fresh` deliberately clears only `.next` since it's about the dev server.
  **The harnesses are isolated from `npm run dev`; `npm run build` is NOT.** It writes `.next` —
  the same tree the dev server is serving from — so building while dev is up replaces that tree
  with a production one and the running server starts 404ing routes it served a minute earlier
  (a `.next/BUILD_ID` appearing is the tell). Nothing warns you. Either stop the dev server first
  or build into a scratch dir (`NEXT_DIST_DIR=.next-verify npm run build`); afterwards the dev
  server needs a restart, or `npm run dev:fresh` if it's confused.
  `tests/dev-lock.mjs` still guards the case that remains real — two runs of the SAME harness —
  and fails OPEN on a stale/corrupt lock (dead pid, malformed JSON, absent file) so a killed
  server never blocks a run. **Reuse was never an option**, which is why it refuses rather than
  adopting a running server: smoke needs `PAPERVINE_CONTENT=tests/fixtures`, crawl needs the
  repo under test, e2e needs the test DB with integrations blanked — pointing any of them at a
  dev server serving `content/` and the dev DB makes the assertions meaningless, or passes them
  by accident. Related: after wiping a distDir, expect `auth.setup.ts` to occasionally blow its
  90s budget on the cold signup→onboarding compile. Re-run warm before suspecting your change.
- **The GitHub App Setup URL must be the APP host, and the callback must not trust `req.url`.**
  The Better Auth session cookie is host-only on `app.` by design, so a Setup URL pointing at
  the apex means `/api/github/setup` sees no session, bounces to `/login`, and — because
  `new URL(path, req.url)` inherits the request's host — lands on the *apex*, which reads as
  "installing the App did nothing" while GitHub thinks it succeeded and nothing is recorded in
  `github_installation`. The callback now resolves redirects against `appOriginFor(...)` and
  carries the whole GitHub redirect through `/login?redirect=` so signing in resumes the
  install. Also: its `state` is a real payload now (`encodeInstallState`) so the callback
  returns you where the install *started* — it used to send everyone to `/{org}/connect`
  regardless, which strands anyone who installed from a hosted site's Connect to GitHub page.
  The state carries identifiers only and the decoder projects just those fields, so it can
  never become an open redirect.
- **Before concluding a DOM behavior is broken, prove the event reached the element.** The
  add-site chooser first used one `<form>` per option plus a shared submit button wired with
  `form="…"`, and it appeared not to submit at all. The actual cause was an automated click
  landing on a button below the fold — `agent-browser scrollintoview` first (or focus + Enter)
  and it works fine. A silently-swallowed click and a silently-ignored handler look identical,
  and the wrong diagnosis gets written into a comment as fact. (The chooser now uses one
  `<form>` around the card list with the action chosen by the selection, which is simpler
  regardless — but that's a design call, not a workaround.)
- **`npm pack` silently drops symlinks — and Turbopack's externals are symlinks.** Turbopack
  rewrites every `serverExternalPackages` entry to a content-hashed alias inside the dist dir
  (`build/node_modules/@mintlify/mdx-<hash>`) and makes it a **symlink** to the real package.
  So a packaged build runs perfectly from a source checkout, and 500s *every page* the moment
  it's installed from a tarball: `Failed to load external module @mintlify/mdx-<hash>`. Nothing
  short of installing the tarball can see it. `apps/cli/scripts/prepack.mjs` copies with
  `dereference: true` and then **fails the build if any symlink survives** into the packed
  tree. Related trap in the same script: don't prune `node_modules` by size — `@mintlify/mdx`
  imports `typescript` at runtime for its twoslash plugin, so dropping the 19MB "build-only"
  compiler 500s the site. Prune only our own sources; the tracer knows the runtime better than
  a size heuristic.
- **Turbopack's project root is the MONOREPO root, so a sub-app inherits the root's
  conventional files.** It must equal `outputFileTracingRoot` (Next warns and overrides
  otherwise), and that has to be the repo root for workspace packages to be traced at all —
  so `apps/cli` resolved the *web app's* `src/instrumentation.ts`, which imports
  `sentry.server.config.ts`, and compiled the **hardcoded production Sentry DSN** into the
  public `papervine` tarball. Every `npx papervine` user's errors would have reported into the
  hosted project. The fix is a deliberately **empty** `apps/cli/src/instrumentation.ts` that
  shadows it — don't delete it for "doing nothing". Note what this defeats: the §10.6
  packaging boundary is about *dependencies*, and this leak arrived by *compilation*, so
  neither a `files` allowlist nor a lean `dependencies` list would have stopped it. Only
  auditing the built tarball does (`npm run test:cli`).

## Commands

```bash
docker compose up -d        # local Postgres (+pgvector) + MinIO (S3) for the control plane
npm run dev                 # THE default: docker services + the app + the automations worker (cron/runs execute only while it's connected). Peripheral layers attach when configured (Stripe webhook forwarding when STRIPE_* + the CLI are present); each degrades independently. If :3000 is busy Next auto-picks the next port, so multiple worktrees coexist.
npm run dev:app             # just the Next server (renderer-only work; also what `dev` spawns)
# AI is off until a profile is picked in .env.local. Free/local: `brew install ollama && ollama pull qwen3.5`, then uncomment Profile A. Hosted: Profile B/C + a key. Renderer/dashboard work needs none of it.
npm run dev:fresh           # kill whatever holds PORT, wipe this worktree's .next, restart clean (use when chunks/manifests are corrupted)
npm run build               # production build
npm run typecheck           # tsc --noEmit
npm test                    # smoke: renderer + control-plane gate (zero-dep, no DB)
npm run test:unit           # vitest — pure-logic unit tests
npm run test:e2e            # playwright — authed journeys (needs docker Postgres + MinIO)
npm run test:cli            # clean-room: packs the real papervine tarball, installs it OUTSIDE the repo, serves docs/ from it (slow — runs a full next build)
npm run mirror:cli -- --dry-run       # build + validate the public papervine/papervine snapshot without touching the remote (add --push to publish)
npm run mirror:starter -- --dry-run   # same, for the forkable example site → papervine/starter
# BOTH mirrors are LIVE: .github/workflows/mirror.yml publishes each on every green CI run of main. The dry runs are for checking a change before it lands, not for publishing. Shipping to npm is still a separate, deliberate act — tag `v*` in papervine/papervine; the mirror never pushes tags.
node tests/crawl.mjs examples/starter # crawl the example site (a CI gate)
npm run db:generate         # generate a versioned SQL migration from schema changes
npm run db:migrate          # apply migrations to the local dev DB (reads .env.local)
node --env-file=.env.local scripts/sync-autumn-customers.mjs [--apply] [--trial]  # every org in DATABASE_URL exists as an Autumn customer; env chosen by the key; dry run by default
node bin/papervine.mjs dev <dir>     # preview any docs repo (docs dev analogue)
node apps/cli/bin/papervine.mjs dev <dir>  # the PUBLISHED CLI's bin — serves a PREBUILT server, so renderer/theme edits are invisible until you rebuild
npm run prepack --workspace papervine     # rebuild that server (the bin now warns when it's stale)
#   the published CLI also has `papervine new <dir>` (scaffolds from examples/starter) and `papervine serve <dir>` (same server, production defaults: binds 0.0.0.0, never scaffolds)
node tests/crawl.mjs <dir>        # crawl a real repo, report rendered/degraded/500
npm run widget:playground         # serve the embeddable widget on a real cross-origin test page
npm run worktree:setup            # a fresh worktree: symlink .env.local to main (share one env), then npm ci
npm run trigger:local up          # self-hosted Trigger.dev instead of their cloud (down / logs; --wipe to reset)
```

**Background work runs on Trigger.dev's HOSTED cloud by default, including in dev.** Nothing in
this repo points at it — the SDK and CLI both fall back to `https://api.trigger.dev` when
`TRIGGER_API_URL` is unset, and the `tr_dev_*` key is a cloud key. So `trigger.dev dev` runs the
worker on your machine but registers it against the cloud dev environment: enqueues leave the
machine, queue there, and are dispatched back. Two consequences that look like bugs when you
don't know this. **An enqueued run sits unclaimed when the connected worker belongs to a
different worktree** — they share one dev environment (see the `worker` layer in
`scripts/dev.mjs`), so a task defined only in your branch is never picked up by the worker
running in someone else's. And task payloads and logs leave your machine.

`npm run trigger:local up` runs the whole thing locally instead (`docs/contributing/trigger-local.mdx`).
It's ~10 containers and their own guidance asks for 6–8GB of RAM, so for a one-off local run the
cheaper trick is to **leave `TRIGGER_SECRET_KEY` unset**: both the automations executor and skill
generation check for it and fall back to running the work inline, losing retries and run history
but needing nothing.

## Working across worktrees (share one `.env.local`, not copies)

`.env.local` is gitignored, so every worktree keeps its own — and they **drift** (a key added
in one is missing in another, which quietly breaks whatever needs it). Don't copy it. Instead
each worktree's `.env.local` is a **symlink to the main checkout's** — the single canonical
secrets file. Editing `<main>/.env.local` updates every worktree at once; both Next dev and the
`--env-file=.env.local` scripts follow the symlink, and `.env.local*` stays gitignored so the
link is never committed. A **fresh worktree**: `npm run worktree:setup` (symlinks `.env.local`,
then run `npm ci`). **Deps are NOT shared** — a worktree on a different branch can need different
dependencies, so `node_modules` stays per-worktree (`npm ci`); symlinking it to main breaks the
branch's own deps.

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
   before `next build`, so merging the migration ships it — **once CI is green**, since
   production now deploys from the `deploy-production` job rather than on push (see
   "Deploys are gated on the tests" below). Previews still auto-deploy, each migrating its
   own Neon branch. No manual prod steps, no `push --force`.

drizzle's journal lives in a separate `drizzle` schema — a full reset is
`DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;` then
migrate. Destructive changes (drop/rename) need care: generate, **read the SQL**, and
prefer expand-then-contract.

## Conventions

- TypeScript strict, App Router / RSC. Server components by default; add `"use client"`
  only for interactivity (see `src/components/mdx/Tabs.tsx`, `Accordion.tsx`).
- Match the surrounding code's style, comment density, and naming. Comments explain
  *why* (especially the non-obvious gotchas above), not *what*.
- **This is a shadcn/ui project** (`components.json`, "new-york" style). Build platform /
  control-plane UI from the primitives in `src/components/ui/` (Radix + `cva` + the `cn()`
  helper in `src/lib/utils.ts`) — **don't hand-roll a component when a shadcn one exists or
  can be added** (`npx shadcn@latest add <name>`). The primitives are mapped onto the `.db`
  platform palette; a component that **portals to `<body>`** (dialog, dropdown, toast) must
  carry the **`db-portal`** class so it re-resolves the platform tokens outside the `.db`
  shell — see `src/components/ui/dialog.tsx` and the two-theme gotcha above. shadcn's toast
  is **sonner** (`add sonner`), not a bespoke component. **Discover** what's available (registry
  components, blocks, examples) via the **shadcn MCP** rather than guessing names — search/list
  the registry, then `add` what fits.
- Keep `SPEC.md` / `GAP-REPORT.md` **and `docs/`** current when you make architectural
  decisions or change what renders — record the decision and measured result in `SPEC.md`,
  the evergreen "how it works" in `docs/`. See "Document every change" above.
- Don't commit unless asked. When you do, end commit messages with the Co-Authored-By
  trailer already used in this repo's history.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
