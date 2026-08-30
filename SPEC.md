# Papervine — Docs Platform

**Status:** Draft v0.1
**Date:** 2026-06-07
**Owner:** jeff@loiselles.com

A multi-tenant docs platform alternative for Git-backed MDX docs. Users connect
a repo containing MDX files + a `docs.json` config; Papervine renders a fast, searchable
docs site with an interactive API playground and an AI assistant. The technical target is
`docs.json` compatibility at the migration boundary, with room to diverge where Papervine
can be simpler, cheaper, or more open. One deployment serves many tenants.

---

## 1. Vision & Principles

- **Docs-as-code — by default, not by requirement.** For a Git-backed site the source of truth
  is MDX + `docs.json` in the user's repo, and the platform is a renderer + control plane over
  it. *(Amended 2026-08-21, §10.11: a **Papervine-hosted** site has no repo — its draft buffer
  is the source of truth and publishing writes object storage directly. Docs-as-code stays the
  default and the recommended path; requiring a GitHub account just to write a page was
  excluding people the product is for. Both kinds render through the same `s3Source`, so the
  renderer never learns the difference.)*
- **Multi-tenant from day one.** A single app instance serves all customer doc sites, addressable by subdomain (`acme.papervine.io`) and custom domain (`docs.example.com`).
- **`docs.json`-compatible.** Use the public `docs.json` schema as the compatibility target
  so existing MDX docs repos migrate with minimal changes. The schema link remains
  `https://papervine.io/docs.json`.
- **Runtime rendering, no content at build time.** The deployed app has no tenant content
  baked in. Content is fetched + rendered on demand (with aggressive caching). New deploys
  don't require rebuilding every tenant.
- **Fast by default.** React Server Components, edge caching, minimal client JS.
- **Portable by design.** Code to portable interfaces (S3 API, Postgres), not vendor lock-in.

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
`docs.json` (`packages/renderer/lib/theme.ts`, `globals.css`); the two must never leak into each other.

**Apex nav is session-aware.** The marketing landing (`src/app/home/page.tsx`) reads the
session: a signed-in visitor gets a single **Dashboard** link instead of **Log in / Sign
up** (which would dead-end them re-signing up). Reading the session opts the page into
dynamic rendering — acceptable for the apex. Smoke covers the logged-out shape (`/home`).

**Status 2026-08-27 — marketing home is for first-time visitors.** The landing used to
lead with "Documentation that grows itself" and insider artifacts (`docs.json`, MCP,
`llms.txt`, "docs as code"). A visitor who had a product and needed a help site couldn't
parse it. Copy now names the product in beginner language ("A docs site for your
product", "Connect a GitHub repo and your docs are live") and the pillars/bento/CTA
follow. **Kept:** "docs platform alternative" (this page is a discovery surface; the claim is
factual — we read the same `docs.json`) and the migrate-guide link that proves it.
Jargon lives in `docs/`, not on the storefront.

**Status 2026-08-27 — GitHub on the marketing home.** The landing header (desktop) and
footer link to the public CLI repo (`github.com/papervine/papervine` — the mirror; renamed
from `papervine/cli` on 2026-08-28). Absolute `<a>`, not `<Link>` — it's a different host.
Smoke asserts the href on `/home`.

**Status 2026-08-27 — the hero is the product tour, click-to-play.** The hero's product shot
was a static skeleton mock (fake sidebar, grey bars). It is now the poster frame of a real
1:45 tour of the product, which plays in place when clicked (`src/components/HeroVideo.tsx`).
The film is built with Remotion in `video/` — the UI is **rebuilt in React, not screen-recorded**,
so it stays crisp, can be re-rendered when a surface moves, and needs no dev server or seeded
database to produce. `video/SCRIPT.md` is the script of record.

Three decisions worth keeping:

- **Click-to-play, not an autoplaying loop.** Autoplay makes every visitor download the file
  before showing any interest — the same work-on-the-critical-path this project measures and
  removes elsewhere (§12). The poster is a `next/image` static import, so the LCP element is an
  optimised AVIF/WebP at ~114KB and the 7.3MB film is fetched only on intent. It is also a
  narrated twelve-scene tour rather than ambient motion, so it wants seeking and a pause.
- **The film is hosted in the public R2 bucket, not committed.** At 9.5MB it would be ten
  times the largest file in git, and it is re-rendered whenever the product UI moves, so
  committing it would add a fresh multi-megabyte blob to history each time. R2 egress is free,
  so there is no bandwidth case for degrading it further. `TOUR_VIDEO` in `HeroVideo.tsx` is the
  one place the URL lives; build + upload steps are in `video/README.md`. **Open item:** it is
  served from the bucket's `pub-*.r2.dev` development URL, which Cloudflare rate-limits and
  documents as not for production traffic — needs a custom domain before the hero takes load,
  and the uploaded object currently carries no `Cache-Control`.
- **Self-hosting it from `public/` would not have worked**, which is worth recording because
  nothing warns you: `middleware.ts`'s `ASSET_RE` matches `mp4|webm`, so an apex request for
  `/papervine-tour.mp4` is rewritten to the `dbasset` handler and streamed from
  `PAPERVINE_CONTENT` — a 404, not a video. Root asset paths on the apex belong to tenant docs
  content. (The poster escapes this by being served from `/_next/`, the same reason the logo is
  a static import — see the note in `Brand.tsx`.)

**Audio is muxed at post, not rendered.** The cut carries a music bed
(`video/audio/driftline-groove.mp3`) added with ffmpeg after the render, truncated to the picture
(exactly 105.6s = 3168 frames / 30fps) with a 2s fade-out — a song cut mid-phrase hard-cuts on
the last frame otherwise. Keeping music out of the Remotion composition means a re-render doesn't
re-encode it, and the picture still holds up muted, which is what the hero needs. A voiceover
would go the other way (inside the composition, see `video/SCRIPT.md`), so once both exist the
music gets ducked in the mux step.

Three traps found while building it, all fixed: Remotion writes a **silent AAC track at
~317kbps** (≈4MB of an 11MB render encoding nothing) — the silent web master drops it losslessly
with `-c:v copy -an`; the music mp3 carries **embedded cover art as an mjpeg stream**, so the mux
maps streams explicitly (`-map 0:v:0 -map 1:a:0`) or ffmpeg takes the artwork as a second video
track; and colours inside the video frame must be **literals, not `.db` tokens**, because the
frame stays dark in both platform appearances, so `var(--fg)` on the overlay label resolved to
`#1b1b21` under `html[data-db-theme="light"]` and put near-black text on a near-black scrim.

**Status 2026-08-29 — "Try it": the demo IS the product, not a mock.** The home page could only
*describe* the two things that distinguish it (a visual editor over real MDX, an assistant that
answers from your docs). A new section under the tour lets a visitor use both without an account,
and in each case it is the shipped component rather than a recreation — a mock would have to be
kept in step with the real thing forever, and would be teaching visitors something we can't
promise is true.

- **One frame, two modes** (`src/components/home/DocsFrame.tsx`). The demo sits inside browser
  chrome — traffic lights, an address bar showing the site's real public URL — because that is
  what says "this is a docs website" before anyone reads a word. **Read** is an `<iframe>` of an
  actual Papervine-rendered site, so the visitor gets the real nav, real ⌘K search, the real API
  console and the site's own assistant with no work on our side. **Edit this page** swaps the
  same frame to the editor. The two modes stay mounted and are toggled with `hidden`: unmounting
  would re-download the framed site on every toggle and throw away whatever the visitor had just
  typed, which reads as the demo losing their work.
- **Which site gets framed** (`resolveDocsFrame`): `starter` first — the forkable example is the
  one with an OpenAPI spec, and therefore the only one whose frame includes a working API
  console — then the `docs.{apex}` site. Locally a custom domain is deliberately *skipped*: dev
  seeds `docs.localhost` as a lookup key, and that host is reserved, so framing it would embed
  the marketing page inside itself.
- **Edit** mounts the real `VisualEditor` (`src/components/home/EditorDemo.tsx`) over an
  in-memory MDX string, with a live source pane beside it. This is possible because the editor
  and `packages/mdx-prosemirror` are pure client code with no network calls of their own —
  everything effectful (draft persistence, collab tokens, publish) lives *above* them in
  `MdxEditorPane`/`EditorShell`, which the demo skips. The one coupling is the media dialog, so
  `VisualEditor` gained a `media` prop: `media={false}` drops `/image`, `/video` and `/embed`
  from both menus and never mounts the dialog. The filter keys on an item's `input` field rather
  than its "Media" category, deliberately — Mermaid is categorised as media but inserts a plain
  code block and must survive.
- **Ask the assistant** embeds our own `widget-embed.js`, pointed at our own docs, driven by
  three question chips through `PapervineAssistant.ask()`. Chosen over an inline chat pane
  because the bubble in the corner *is* the feature being sold ("add the assistant to your site
  with one script tag") — an inline pane would be a second implementation of the same surface,
  and would prove less.
- **No tour overlay.** The 1:45 film above already is the tour; guided-overlay walkthroughs on
  marketing pages get dismissed. The guidance lives inside the demos instead — the three chips,
  and the header telling you to press `/`.
- **The demo site is found by convention, with no new env var**: `resolveHomeDemo()`
  (`src/lib/home-demo.ts`) looks for the site whose custom domain is `docs.{apex}` — our own
  dogfooded docs — and offers the widget only when it is enabled *and* the home's origin is on
  its allowlist. Null is an ordinary answer (no DB, single-repo preview, operator hasn't set it
  up), and the chips then degrade to links into the docs page that answers each question. The
  smoke gate asserts exactly that, since it runs with no Postgres.
- **Loading follows the hero-video rule** (nothing heavy before intent): the editor is a
  `next/dynamic({ ssr: false })` chunk requested only when Edit is pressed, the framed site is
  not rendered until the section scrolls into view, and the widget loader is injected on the
  first chip click. Verified rather than assumed — the production build puts TipTap in exactly
  one chunk, `/home`'s HTML references it zero times, and it is fetched on the click.
- **The band behind the frame** uses `rgba(var(--ink-rgb), α)`, the house overlay channel, so one
  declaration lightens the dark appearance and darkens the light one. The obvious first cut — a
  literal dark overlay — painted a grey haze across the light platform theme, the same two-theme
  trap that once rendered the editor chrome all-white.
- **The source pane is syntax-highlighted** (`src/components/home/SourcePane.tsx`): a read-only
  CodeMirror over `markdown()` rather than a `<pre>`, so component tags, attributes, headings and
  fences are tokenised properly instead of by a regex that would mis-colour the first document it
  didn't anticipate. The token colours (`markdown-highlight.ts`) are platform tokens, so the pane
  follows the light/dark appearance for free. **Worth knowing:** CodeMirror 6 separates parsing
  from painting — `markdown()` alone colours nothing without a `HighlightStyle`, which is why the
  editor's own Source mode (`SourceEditor.tsx`, same `markdown()`, no highlight style) is still
  monochrome today. Adopting `markdownHighlight` there is a small, obvious follow-up.

- **The demo took the hero slot from the film** (supersedes the 2026-08-27 note above, which put
  the tour there). The hero is now left-aligned copy with the tour reduced to a small pill —
  thumbnail, "Watch the tour", runtime — that opens the film in a modal, and the live demo sits
  immediately beneath the fold instead. A visitor who can *use* the product is worth more than
  one watching a video of it, and two large frames stacked read as a showreel rather than a
  product. Click-to-play survives and matters more: the hero now costs only the ~114KB poster,
  and the 9.5MB file is fetched only when the modal opens.
- **That modal must be portalled to `<body>`.** `position: fixed` resolves against the nearest
  transformed ancestor rather than the viewport, and the pill sits inside the hero's `db-rise`
  entrance animation — so an in-place overlay rendered at the size and position of the little
  pill instead of filling the screen. It portals out and carries `db-portal`, the house rule for
  anything rendered outside the `.db` shell.

Deferred on purpose: AI *editing* in the demo (the editor agent needs a session, an org and a
real draft branch — an anonymous version means a new route with model cost and write-tool
prompt-injection surface), and a "paste your repo URL" sandbox (needs an anonymous-site concept
and a TTL reaper).

**Open discrepancy:** the pill advertises a 1:45 runtime (`RUNTIME` in `HeroVideo.tsx`, matching
`video/SCRIPT.md`'s 3168 frames), but the file currently served from R2 plays for **0:46** — so
the bucket holds an older, shorter cut than the script describes. Pre-existing, and unchanged by
this work; either re-render and re-upload the film, or correct the label.

**Status 2026-08-29 — the first rate limiter (`src/lib/rate-limit.ts`).** Inviting anonymous
visitors to use the assistant from the marketing home made this a prerequisite rather than a
nicety: there was **no rate limiting anywhere in the codebase**, and two public AI endpoints —
`/api/widget/{id}/chat` and `/api/assistant`, whose apex path is deliberately unauthenticated
*and* unmetered — were reachable by anyone. The widget's origin allowlist stops other *sites*
embedding a widget; it does nothing about one visitor on an allowed page asking two hundred
questions.

A fixed window of **20 requests per 10 minutes, per client IP, per surface**, keyed
`{surface}:{sha256(ip)}` — the IP is hashed so the table can't become a record of who read what.
Per-surface keys (`widget:{widgetId}`, `assistant:{siteId}` / `assistant:apex`) keep one busy
office NAT from locking readers out of an unrelated site. The pure decision core is unit-tested;
the Postgres counter (`rate_limit`, one atomic upsert — the window reset is a CASE inside the
UPDATE, because read-then-write lets two concurrent requests both pass the limit) **fails open**
on any DB error, the same posture as `authorizeAi`: a limiter must never take down the surface it
protects. It runs *before* the provider-availability check in both routes, or an environment with
no AI configured would 503 every request and never reach the limit — which is exactly the state
CI runs in, and would have made the regression test vacuous.

Two things worth knowing. Failing open means a broken limiter is **silent**: the first
implementation passed `Date` objects to `db.execute`, which postgres-js rejects, so the limiter
did nothing at all and every request sailed through — caught only by the e2e that asserts a 429
actually arrives. And `assistantCaptchaEnabled` (`app-schema.ts`) remains **persisted UI that
nothing enforces**; the flag round-trips and has never been read by the assistant route.

**Status 2026-08-29 — CI's verification runs in parallel.** `verify` was one sequential job:
typecheck → unit → build → smoke → crawl → clean-room CLI, ~8m20, and since `deploy-production`
needs `verify`, that was the floor on how long any change took to reach production. The steps
turn out to be mutually independent — smoke and the crawl each spawn their own `next dev` on
their own `NEXT_DIST_DIR`, so neither needs the production build, and the clean-room test builds
inside the tarball it packs — so they now run as five parallel jobs. Each pays ~50s of checkout
plus `npm ci`, but concurrently: the critical path becomes the slowest single job (the ~2m build)
rather than the sum.

`verify` remains as an **empty aggregator** needing all five, so `deploy-production`,
`deploy-trigger` and any branch protection naming "verify" were untouched by the split — and a
failure still skips the aggregator and therefore the deploy. `.next/cache` is now restored
between runs too; only npm was cached before, so every build started cold.

Deliberately NOT done: skipping jobs by changed path. Tempting for a marketing-copy edit, but
the "Try it" work is the counter-example — it began as a home-page task and ended up touching
two API routes, the DB schema, a migration, the editor's slash menu and tenant-host resolution,
and the bug that reached production lived in `src/lib/`, not in the page. The two jobs with
genuinely crisp scopes (`cli-package`, the starter `crawl`) could be path-filtered later; the
rest can't be, honestly.

**Status 2026-08-29 — the hero lost its eyebrow and its microcopy.** Two slots came off the
top of the marketing home: the eyebrow chip (which had carried a "New · …" announcement, then a
tagline) and the small line under the CTA row. Both were saying less than the copy immediately
beside them — the eyebrow above a headline that states the claim outright, the microcopy under
three buttons that already show the ways in — and the hero reads better opening on the headline.
The smoke gate that pinned the microcopy string still exists; it moved to the subhead
("AI-powered self-updating knowledge platform"), because its job is to catch the hero silently
regressing to jargon-only, not to pin one particular sentence. The headline itself can't be
asserted — the gradient word splits it across spans, so it has no contiguous string.

The same pass fixed the hero on a phone. Three CTAs in a `flex-wrap` row left the third one
alone on its own line at whatever width its text happened to be, which reads as a bug rather
than a layout: it is now a two-column grid below `sm` — the trial CTA spanning both columns,
Deploy and Star sharing the row beneath — and the tour pill goes `w-full` to close the stack.
From `sm` up all four revert to the inline row, so the desktop hero is unchanged. The
"docs platform alternative" paragraph moved out of the hero to its own band above the footer: it
stays on the page (it is a discovery surface, CLAUDE.md) but a paragraph of comparison copy
should not be the fourth thing under the headline, and at the bottom it reaches the people
still scrolling, who are the ones actually weighing a move.

**Status 2026-08-29 — the live demo is desktop-only; phones get a recording.** The "Try it"
frame is an iframe of a real docs site, and below `md` that stops being an argument and starts
being a liability: a desktop docs layout at 340px is unreadable, and a phone-width one loses
both the sidebar and the search button (the renderer gates each at `md:`), so the frame would
show a page you can only scroll. Below `md` the section now shows a short silent loop of the
same site being browsed — search, results, a page, the sidebar — cropped rather than shrunk, so
what survives is the shape of a docs site and the motion.

Three things worth keeping:

- **It's a screen recording of the live site, not an animated mock** (`scripts/record-docs-loop.mjs`
  — Playwright drives docs.papervine.io with a drawn cursor, ffmpeg encodes; ~600KB for 13s).
  A mock would have to be maintained forever and would teach visitors something we can't promise.
  For contrast, the comparable surface on a competitor's home page *is* a mock: inspected at
  390px it has no `<video>` and no `<iframe>`, just live DOM with working buttons for a generic
  `docs.company.com` — the same interactive component as their desktop, scaled and clipped.
- **`hidden md:block` does the loading gate for free.** DocsFrame only mounts the iframe once its
  IntersectionObserver fires, and a `display:none` element never intersects — so on a phone the
  third-party document is never fetched, and neither is the TipTap chunk behind Edit.
- **Forcing the recording into dark mode needed localStorage, not `colorScheme`.** The renderer's
  pre-paint script reads `localStorage['theme']` first and only consults `prefers-color-scheme`
  when a site's appearance default is `system`; ours serves `d="light"`, so the Playwright
  context's `colorScheme: "dark"` did nothing on its own and the clip came out white.

The clip is served from the public R2 media bucket like the tour video, for the same reason: it
gets re-recorded whenever the docs chrome moves, and committing it would add a fresh binary to
history each time. Same caveat as `TOUR_VIDEO` too — it's on the rate-limited `r2.dev`
development origin until the bucket gets a custom domain.

**Status 2026-08-29 — the hero's primary action is a waitlist.** The CTA reads *Join Waitlist*
and opens a dialog rather than navigating: the hero's job is to convert what someone just read,
and a page change costs the context that persuaded them. Two fields, and the ratio is the design
— **email required, one optional free-text line** ("What are you hoping to use it for?"). Every
required field costs completions and the address is the only thing actually needed; the note is
left as free text rather than a set of buckets because pre-launch the valuable part is how people
describe their own problem, which is the copy we should be writing back at them. A bucket can be
read out of a sentence later; a sentence can't be recovered from a bucket. The page they came
from is captured rather than asked.

`POST /api/waitlist` is public and unauthenticated by definition, so it carries the same two
defences that surface needs: the per-IP limiter (5 per 10 min, tighter than the assistant's 20 —
a person joins a waitlist once) and a honeypot field, whose response is deliberately identical to
a success so a bot never learns it was caught. A repeat signup is a SUCCESS, upserted on the
unique email index; a second visit can only ADD to what's recorded, since blanking someone's
first answer or losing their original `source` is strictly worse than keeping it. Entries surface
at **Operator → Waitlist** — without that page the table is only readable over psql, which in
practice means nobody reads it, and a waitlist nobody reads is a form that discards intent.

Two things that only showed up by exercising it against a real database. Drizzle's
`onConflictDoUpdate` with an **empty `set`** emits `ON CONFLICT DO UPDATE SET` with nothing after
it — a Postgres syntax error — and it builds that clause on the FIRST insert too, so an email
with no note and no source 500'd every time until the code branched to `onConflictDoNothing`.
And `rateLimited()`'s message was hardcoded to "You've asked a lot of questions", which is
nonsense on a form that takes an email address; it takes an override now.

**The open tension, recorded deliberately:** `/signup` still works, and the nav's *Sign up* and
the closing band's *Get started — free* still create real accounts. A waitlist in front of a door
that's already open is friction, and the three CTAs currently contradict each other. This is only
coherent once access is actually gated.

**Status 2026-08-29 — "Powered by Papervine" on every plan below Enterprise.** A quiet text
link at the bottom right of each tenant docs page, in the flow of the document rather than a
`position: fixed` corner sticker: a fixed badge sits on top of what the reader is reading and
follows them down every page, which is a heavier tax on a customer's site than the attribution is
worth — and the assistant here is a full-height right-hand drawer, so that corner is occupied
whenever it's open. Text only, because the brand logo exists in this repo as a PNG and nothing
else; an approximated SVG path is worse than no mark.

**It's an entitlement (`whiteLabel`), not a `planKey === "enterprise"` check.** That's how every
other plan difference is expressed here, so moving the badge down a tier is a `catalog.json` edit
plus `billing:sync` rather than a deploy. Trial deliberately does NOT get it: a trial that hides
the badge and then shows it on expiry is a nasty surprise, and losing the badge should be
something you buy rather than something you briefly had.

Three properties the render path forced, all of them about a page that must never 500:

- **Survives a missing database.** `PAPERVINE_CONTENT` (the CLI, the smoke gate) short-circuits
  before touching the client, the same way `getSiteBySlug` does. Note the consequence, which is
  a decision rather than a side effect: **self-hosted CLI sites carry no badge.** Putting one on
  somebody's own Elastic-licensed deployment is a licensing and positioning question, not an
  implementation detail — revisit deliberately if ever.
- **Fails toward HIDING.** A transient DB error showing the badge on a paying Enterprise
  customer's white-labelled docs is a regression of the exact thing they bought; not showing it
  on a Free site for a minute costs nothing. The asymmetry is why the error branch returns false.
- **Cached 60s** (`unstable_cache`), or every page view pays two queries for an answer that
  changes a handful of times ever. Short enough that "I upgraded and it's still there" resolves
  before anyone reports it. Note that `revalidate` is stale-while-revalidate: after the window,
  the *next* request still gets the old answer and the one after it is fresh — which is exactly
  what made this look broken while testing until a second request went through.

**A subscription stays pinned to the plan version it was bought on**, so an Enterprise customer
can legitimately hold entitlements with no `whiteLabel` key at all. Reading that `undefined` as
falsy would brand the docs they pay to keep unbranded, so the decision falls back to the plan key
for exactly that window (pinned by `powered-by.test.ts`, which also asserts the catalog has the
key on every plan so nothing relies on the fallback once published).

**Status 2026-08-30 — tenant sites serve `skill.md` and the agent discovery endpoints.**
`llms.txt` tells an agent where to READ; `skill.md` tells it what it can DO. A site publishes
whatever skill files its repo contains, at the paths agents already look for: `/skill.md`,
`/.well-known/agent-skills/index.json` (+ `/{slug}/SKILL.md`, with a sha256 digest per the
agent-skills 0.2.0 discovery spec), the older `/.well-known/skills/` pair, and an A2A 0.3
`/.well-known/agent-card.json` that answers the whole thing in one request. Both a root
`skill.md` and a `.papervine/skills/{name}/SKILL.md` directory are read — and a legacy skills directory
too, so a repo migrating over keeps working with nothing moved (§10.6: match the format).

**Author-supplied only, deliberately.** The obvious next step is generating a skill file from
the docs with an agentic loop when the author ships none. Not done, and not just for cost: a
capability summary is a *claim about the product*, and an inferred one is a claim nobody
checked. An agent that acts on a hallucinated capability fails in the customer's product, not
ours. If it lands later it should be opt-in and reviewable, not silently published.

Four things this ran into, all of them about a file that lives in the docs tree without being
documentation:

- **`isPageSlug` had to guard `loadPage`, not just the listing.** Filtering only `listPageSlugs`
  kept `skill` out of the nav and out of `llms.txt` while `/skill` still happily rendered the
  capability summary as a docs page to anyone who typed the URL.
- **Two of these paths end in `.md`**, so the apex's page-Markdown-twin rewrite claimed
  `/skill.md` and `/.well-known/agent-skills/{name}/SKILL.md` and looked them up as pages —
  which `isPageSlug` then refuses. Route present, file present, 404 anyway. `isAgentSurface` is
  now checked first. Same class as the Sentry-tunnel gotcha, different rewrite.
- **`loadSkills` must go through the renderer's `source()` accessor, not
  `contentContext.getStore()`.** A tenant request has a source in context; the apex and
  single-repo preview (the CLI, the smoke gate) have none and fall back to the default. Reading
  the store directly made every skill vanish on exactly those hosts — and the smoke gate, which
  runs in that mode, is what caught it.
- **`ContentSource` gained `listRaw(prefix)`**, because a skills *directory* has no fixed names
  to `loadRaw`. On the storage source it filters the same cached key listing `listPageSlugs`
  already does, so discovery costs no extra LIST.

The endpoints carry no reader session, like `llms.txt` and the widget, so they serve the public
subset: a skill with `groups:` is withheld entirely — absent from every index and 404 at its own
URL, indistinguishable from one that doesn't exist. Withheld rather than trimmed, because a
capability summary is one document and there is no partial version of it that is safe.

**Status 2026-08-30 — `skill.md` is generated for sites that don't write one.** The scheduling
question was the whole design, and the answer is **mark on publish, decide on a sweep**:

- **Not on every edit.** An edit is a keystroke in the draft buffer; nothing is published and
  nobody can fetch the result.
- **Not on every publish**, tempting as it is. Twenty commits in an afternoon — a typo pass, a
  batch of link fixes — would mean reading the whole corpus twenty times to produce the identical
  document, on the path where someone is waiting for their site to go live.
- **Not a blind schedule** either: regenerating every tenant nightly burns model calls on sites
  that didn't change, and a site that just launched waits a day for its first skill.

So `markSiteLive` sets `skill_stale_at` (free — it's already writing that row), and an hourly
sweep (`/api/skills/generate`, Vercel Cron) decides. The decision is two-stage on purpose: the
flag narrows the candidate set cheaply, then `capabilityFingerprint` — `docs.json` + the sorted
page list, both already cached per site version — says whether the *capability surface* actually
moved. A page rewritten in place doesn't regenerate; a page added, removed, or renamed does. The
accepted blind spot is a retitled page lagging until the next structural change, which is the
right side to err on. A site that has never generated (`skill_fingerprint IS NULL`) skips the
debounce entirely — there is nothing to debounce, and a new site with no skill is where the delay
would show.

**Not metered**, by decision: no `authorizeAi` gate and no `recordAiUsage` debit. It's background
work the customer didn't ask for per-run and can't see coming, and billing a Free site for it is
the kind of charge that becomes a support ticket. An author's own `skill.md` disables generation
outright — no merge, no rival file.

Three things this cost, all found by running it rather than reading it:

- **The generated file must live OUTSIDE the synced content tree** (`sites/{id}/.generated/`).
  Writing to the docs root would be a content change → stale flag → regenerate → write. That is
  the self-trigger loop `fireContentUpdateAutomations` exists to break, and this repo has already
  paid for it once.
- **…which means it can't be read through `loadRaw`.** That's cached under the site's CONTENT
  version key (`${sha}:${updatedAt}`), and generation deliberately doesn't bump `updatedAt` — so
  a regenerated file written under an unchanged key was invisible to every reader while sitting
  correctly in storage. Caught only by regenerating twice and watching the second one not appear.
  It's read straight from storage now; the endpoints' `s-maxage=3600` absorbs the volume.
- **Asking for the trigger line in prose didn't work.** The frontmatter `description` is what an
  agent matches on to decide a skill is relevant ("Use when <activity> — <trigger>, <trigger>"),
  not a blurb about the product. Requesting it as a `DESCRIPTION:` first line in a long prompt
  failed every time — the model started at the heading — and the code silently fell back to the
  site's marketing description. `generateObject` with a two-field schema fixed it: two fields the
  SDK guarantees beat one convention the model has to remember. **The two bugs masked each
  other**, which is why the first fix looked like it hadn't worked.

The template (name, metadata, Resources, the closing llms.txt line) is stamped by us rather than
generated — those are facts we hold, and they're the likeliest place for a model to invent a URL.

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
next page update; the billing backend's schema + versioned catalog + credit core landed
2026-07-16, with enforcement, Stripe, and surfaces to follow (§10 "Billing").

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
docs renderer. A `<EnvBadge>` (top-right, **preview deploys only** — hidden in production and
locally, see the 2026-08-27 note) is the first such primitive, mounted globally in the root layout.

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
story (§13 portability). Search/assistant remain host-resolved (analytics only)
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
   (`CUSTOM_DOMAIN_CNAME_TARGET` — hosted sets `cname.papervine.io`; another deployment sets its
   own host; unset falls back to the raw Vercel edge, then the apex), so the code hardcodes
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
  when set, the raw Vercel edge if unset-but-Vercel-managed, the apex otherwise (the
  no-custom-domain path form). Pure `parseDomainStatus`, env-gating, and CNAME-target
  precedence unit-tested
  (`tests/unit/vercel-domains.test.ts`).
- **Phase 2 (trigger: ~40–50 custom domains):** front custom-domain traffic with a
  purpose-built SaaS-domains proxy that issues a cert per hostname and forwards to **one**
  origin we already serve (e.g. `origin.papervine.io`, under our wildcard), passing the real
  host in **`X-Forwarded-Host`**. Vercel then sees a single domain → cap is moot. Candidates:
  **Approximated** (drop-in, purpose-built, API), **Cloudflare for SaaS / Custom Hostnames**
  (cheapest at scale, more config), or **Caddy on-demand-TLS** running on infrastructure
  we operate (cheapest). Because customers CNAME at the **branded `cname.papervine.io`** (Phase 1
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

> **A second content origin (2026-08-21, §10.11).** Git is no longer the *only* way content
> reaches object storage. A **Papervine-hosted** site (`site.source_kind = 'native'`) has no
> repo: its draft buffer is the source of truth and the editor's publish writes straight into
> `sites/{id}/…`. Steps 1–2 above simply don't run for it — there is no clone, no webhook (the
> push fan-out matches on `repo_owner`/`repo_name`, which are NULL, so it can never match), and
> no `.manifest.json` (its values are git blob SHAs, and `planSync` is the only consumer).
> **Step 3 is untouched and is the point:** both origins write the same storage layout, so the
> Render Plane reads them identically through `s3Source` and knows nothing about the
> difference. Compile-on-sync becomes compile-on-publish for a hosted site; the hot path is
> still never compiling.

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
   gunzips the **entire repo** in memory to harvest a `docs/` subdir. A real private customer
   monorepo (docs in `docs/`) took **744 s** to sync 80 MB of docs — fine in dev (no
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
rendered stale on a customer tenant (a private monorepo, docs under `docs/`).**
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

**Reader auth became per-page, matching the source platform (landed 2026-08-12).** The gate
ran in the *shell*: `authEnabled` bounced every visitor to `/login` before any content
rendered, so `public: true` could only mean "exempt from group checks *after* signing in".
That made "public docs and internal docs on one site" impossible to express — the shape the
homepage was already advertising.
> **Checked against the source platform rather than invented.** Its rules: auth is per page,
> *"All pages require authentication by default"*, `public: true` makes a page readable
> without signing in, an ungated page is readable by any authenticated reader, and denial is
> a 404. A first pass added a site-level `authRequireAll` toggle instead; it reached the same
> outcome but inverted the default (flipping it exposed every ungated page) and would have
> mis-rendered a migrated repo that relies on `public: true` — a security-relevant
> incompatibility, and a violation of "match the source format, don't guess". Backed out
> entirely (column, migration, action, UI) before it shipped.
>
> **Where the gate lives is the crux.** The shell only sees `{site}`, never the path, so a
> gate there can only make one whole-site decision. Auth is a property of a page, so the
> decision moved into the article (`requireReaderForPage`) where the frontmatter is known.
> The shell still renders nav filtered by the same predicate, so anonymous readers see chrome
> listing only what they can open.
>
> **`signedIn` is a distinct input from the groups list.** An anonymous visitor and a
> password-method reader (which carries no groups, by design) both have zero groups, but only
> the latter may read an ungated page. Collapsing them would make every page lacking a
> `groups:` line world-readable the instant auth was enabled — inverting default-deny. Pinned
> by unit tests with identical arguments and opposite answers on that one flag.
>
> **Anonymous → sign-in; signed-in-but-wrong-group → 404.** Different answers on purpose: a
> 404 for the first would strand a reader who could legitimately gain access; a 403 for the
> second would confirm the page exists.
>
> **Known consequence.** With `loading.tsx` streaming, the article's `redirect()` lands as a
> *client-side* navigation rather than a 302, and a gated page returns 200 with the not-found
> body instead of 404. Content does not leak (asserted), but this is now the second
> correctness property the streaming bug undercuts — it has earned its own fix.

**The operator can claim a host on the platform domain as a custom domain (landed
2026-08-11).** `parseCustomDomain` refused every host under `papervine.io` by calling
`isPlatformHost`, which answers "is this host ours?" — the right question for *routing* and
the wrong one for *ownership*. The org that owns the platform domain pointing
`docs.papervine.io` at one of its own sites is the custom-domain feature working, not an
exception to it, and the blanket ban is what blocked dogfooding our own docs.
> Now `isReservedPlatformHost` refuses only what is structurally ours (the apex, the
> `www`/`app`/`api` labels something actually serves, the tenant apex and any tenant
> subdomain, plus local/preview hosts). Anything else on the platform domain parses, with a
> `requiresOperator` flag the server action checks against `PLATFORM_ADMIN_EMAILS` — ungated,
> any customer could park content on our brand's subdomain *and* put third-party content back
> on the cookie domain. Authorization lives in the action because `custom-domain.ts` is pure
> and has no session.
>
> **Two gates had to move together.** Saving is `parseCustomDomain`; serving is middleware,
> which gated its custom-domain branch on `isPlatformHost`. Relaxing only the first would let
> a claimed host save cleanly and then never route — it falls through to the marketing apex.
> Pinned by a middleware unit test asserting `docs.{platform}` rewrites to `/custom-domain`.
>
> **`docs` is reserved from slug resolution but not from claiming**, and the split matters:
> `RESERVED` keeps it from resolving as a tenant subdomain (which would drag it into the
> legacy 308 and bounce it to the tenant domain), while `PLATFORM_FUNCTION_LABELS` — the
> unclaimable set — excludes it. Conflating those two is the original bug in miniature.

**Tenant docs moved to their own registrable domain (landed 2026-08-11).** Customer-authored
MDX rendered on `{slug}.papervine.io` — the same registrable domain the control plane's
cookies live on. The session cookie is host-only on `app.`, and the benign `pv_signed_in`
hint is scoped to the parent domain *specifically so the marketing apex can read it*, which
means it also reached every tenant subdomain; that is why it had to be `httpOnly` (a
mitigation, not a fix). Tenants now serve from **`papervine.page`**, a second registrable
domain, so no platform cookie can be scoped anywhere customer content runs.
> **Why `.page` over `.site`.** Both were available and either would have delivered the
> platform↔tenant separation above, which is the main prize. `.page` is **HSTS-preloaded as
> an entire TLD**, so every tenant host is HTTPS-only from registration with no submission
> and no way to lose it to a misconfiguration. Worth separating from a protection it does
> *not* grant: isolating tenants' cookies **from each other** is the Public Suffix List, a
> per-domain submission that is still outstanding and is the long pole (weeks–months into
> browser releases). The TLD choice was made before any DNS or PSL submission existed,
> because PSL removal is as slow as addition — cheap then, awkward later.
>
> **Shape of the change.** `PLATFORM_DOMAIN`/`TENANT_DOMAIN` are configuration
> (`NEXT_PUBLIC_*`, defaulted in `tenant-host.ts`), not constants scattered through the app.
> `isPlatformHost` must include the tenant domain — miss that and middleware treats every
> tenant host as a candidate customer vanity domain and tries to DB-resolve it. The
> load-bearing new helper is **`tenantHostFor()`**: the old rule "strip `app.`/`www.` off the
> request host" is wrong the moment tenants live elsewhere, because the dashboard, the MCP
> endpoint page, and the widget all mint tenant URLs *while serving a platform request* and
> would emit the legacy domain. Two widget unit tests failed on exactly that when the change
> landed — the intended catch.
>
> **Consequences.** Reserved labels no longer apply on the tenant domain (nothing of ours
> answers there), so `docs.papervine.page` is an ordinary site — which is what unblocks
> dogfooding our own docs as a tenant, and it dissolves rather than patches the
> `RESERVED_SITE_SLUGS` drift: `www`/`app`/`api` used to be *assignable but unresolvable*, so
> connecting a repo named "api" produced a site whose subdomain silently served the marketing
> page. A unit test now pins that every assignable slug actually resolves. Legacy
> `{slug}.papervine.io` hosts still resolve and **308** to the canonical host with path and
> query intact, so existing links survive.
>
> **Not exercised locally.** Dev shares `.localhost` for both domains, so the cookie isolation
> this buys is only real on an environment with two actual domains.
>
> **Still open:** the PSL submission for `papervine.page`; `CUSTOM_DOMAIN_CNAME_TARGET` is
> still unset, so customers are told to CNAME straight at the provider edge instead of a
> branded `cname.papervine.page` in our own zone (the portability seam).

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

**The persistent shell had to be made geometrically stable too (landed 2026-08-10).** The split
above kept the shell *mounted* across navigations but not *still*: clicking any sidebar link made
the whole page twitch — measured on the dogfooded docs site at 1280×900, the shell slid ~15px
right and the sidebar jumped ~47px up, then both snapped back. One root cause, three
contributors, all from the article column being shorter than the viewport while `loading.tsx` was
on screen:
> **① The sticky sidebar lost its offset.** The sidebar is `sticky top-28` with
> `h-[calc(100vh-7rem)]`, and a sticky element is clamped by its containing block — the flex row
> pairing it with the article. A short article collapsed that row, so the sidebar couldn't be
> pushed to its 7rem offset and fell to its natural flow position. Fixed with a shared
> `ARTICLE_ROW` constant (`src/lib/docs-layout.ts`) carrying a `min-h-screen`, used by all three
> renderers of that row (article, OpenAPI endpoint page, skeleton) — they had three independent
> copies of the class string, which is *how* they drifted. Note the min-height is deliberately
> **not** the sidebar's own `calc(100vh-7rem)`: reaching the offset needs the row to cover the
> offset *plus* the sidebar's height, measured from a row top that moves with whether `NavTabs`
> rendered. Matching the sidebar exactly leaves it ~47px short on a site with no tab bar.
>
> **② The scrollbar gutter wasn't reserved.** A non-overflowing document loses its vertical
> scrollbar, widening the viewport and sliding the centered `mx-auto max-w-7xl` shell. Fixed with
> `scrollbar-gutter: stable` on `<html>`.
>
> **③ Route transitions animated their scroll.** `scroll-behavior: smooth` (set for #anchor
> links) also makes Next animate scroll restoration on every navigation. Fixed with
> `data-scroll-behavior="smooth"` on `<html>`, which scopes the smoothness back to anchors.
>
> ① and ② also affected *genuinely short pages*, not just the loading state — the original
> diagnosis under-scoped it to the skeleton. Regression test in `tenant-render.spec.ts` asserts a
> one-line page and a tall page put the sidebar box and `documentElement.clientWidth` in identical
> positions; confirmed failing before the fix (`Expected: 112, Received: 65`) and passing after.
> Reproduce by hand with `node bin/papervine.mjs dev docs` — dev renders slower, so the skeleton
> is easier to catch locally than in prod.

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
PAT field — public repos stay zero-config on any deployment. See `.env.example` for registration.

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
  "ai": { "assistant": true },
  "seo": { "metatags": { "og:image": "/social.png", "twitter:site": "@acme" } }
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
> **Update 2026-08-25:** `seo` joined the schema and `seo.metatags` is now applied — see the
> social-cards note in §5. `seo.indexing` remains parsed-only.

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
| Code blocks | Shiki syntax highlighting, copy button, titles (all BUILT 2026-08-24); line highlights still open |
| `<Frame>` | image/embed framing w/ caption |
| `<Tooltip>` `<Expandable>` `<Icon>` | inline helpers |
| Mermaid | diagrams — ```mermaid fences → client-rendered SVG (BUILT 2026-06-29) |
| `<ParamField>` `<ResponseField>` | API param docs |
| `<Update>` | changelog entries |
| `<Badge>` `<Tile>` `<Color>` `<Tree>`/`<FileTree>` | labels, image tiles, swatches, file trees |
| `<Danger>` `<Callout>` | severity callout + the bring-your-own-icon variant |
| `<Prompt>` `<GitHub.Repo>` | copyable AI prompts, repo cards |
| `<Visibility>` `<View>` | audience-split and variant content |
| `<Panel>` `<RequestExample>` `<ResponseExample>` | supplementary panels |

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

> **Status (2026-08-23):** closed the component-coverage gap (GAP-REPORT M1 item 5). Added 16
> new tags: `Danger` + a generic `Callout`, `Badge`, `Icon`, `Tooltip`, `Tile`,
> `Tree`/`FileTree` (+ `Tree.Folder`/`Tree.File`), `Color` (+ `.Item`/`.Row`), `Update`,
> `Prompt`, `GitHub.Repo`, `Visibility`, `View`, `Panel`, and
> `RequestExample`/`ResponseExample`. Tag names and props were read off the upstream docs
> rather than guessed — compatibility is the whole point, and a near-miss name is a silent
> fallback.
>
> **The gotcha worth keeping: a member-expression component cannot be a client component.**
> `Tree.File` and `GitHub.Repo` compile to member expressions, so the map entry has to be an
> object carrying `.File`/`.Repo`. Next replaces the exports of a `"use client"` module with
> client-reference proxies, and **those proxies do not carry arbitrary static properties** — so
> the attached sub-components came back `undefined` and MDX threw `Expected component
> `Tree.File` to be defined`. Two ways out, both used here: `Tree` and `Color` are server
> components outright (`Tree` collapses with native `<details>`, so it needs no state at all),
> while `GitHub.Repo` genuinely needs client JS for its API fetch, so the *namespace* is
> assembled in a server module (`GitHub.tsx`) that imports the client card
> (`GitHubRepo.tsx`). Note this is separate from the existing member-expression *fallback* —
> the Proxy in `componentsForCompiled` stops unknown dotted tags from throwing, but a fallback
> only renders children, so the real structure still has to resolve.
>
> **Three deliberate fidelity gaps**, recorded in GAP-REPORT rather than hidden: `Icon`
> resolves Lucide names only (three icon libraries is bad weight for a package built to be
> light; unknown names render nothing and `src` is the escape hatch); `View` renders every
> variant as a labelled section instead of collapsing siblings into one dropdown (sibling
> elements can't see each other — parity needs a page-level MDX transform); and
> `Panel`/`RequestExample`/`ResponseExample` render inline instead of moving into the right
> column (the route fixes the layout before MDX runs). In each case content stays complete and
> linkable, which is the invariant that matters — see "zero page 500s beats fidelity".
>
> Also learned: **`banner` is config, not a component** (`docs.json`: `content`,
> `dismissible`, `type`, `color`). It's on the GAP-REPORT list unparsed, not in the component
> map, which is where an index-page reading would have put it.
>
> **Testing.** `tests/fixtures/components-extended.mdx` + a `CHECKS` entry asserting ~35
> markers. The assertions pair each content marker with *markup only the real component
> emits* — `role="tooltip"`, `id="2026-08-23"`, `rounded-full`, an `<svg class="lucide…">` —
> because a bare marker proves nothing: the children fallback would render the same text.
> `for="agents"` is asserted *absent* rather than hidden, since CSS-hidden content is still
> read by scrapers and screen readers. Implementing `Tree` also broke `unknowns.mdx`, which
> had been using `<Tree.File>` as its example of an *unimplemented* member expression; it now
> uses an invented `<Widget.Panel>`, which is the durable form of that fixture.
>
> Two house conventions caught in review: component anchors need the `card-link` class to
> escape `.prose a` underlines (Tile, GitHub.Repo, Tooltip's cta, Update's label anchor, and
> Prompt's Cursor link all needed it), and the starter example (`scripts/mirror-cli/examples/
> starter/components.mdx`) is now the full showcase — it doubles as the public repo's CI
> fixture, so every component there is actually exercised on each mirror push.
>
> **Verified:** typecheck (root + CLI) clean, unit 981/981, smoke 17 pages green including the
> new fixture, crawl of `docs/` 41/41 with 0×500, clean-room gate green, the mirror snapshot
> self-validates and passes its own `test:cli` against the new starter, and the starter's
> component page browser-checked with a clean console.

- **Theming:** named theme presets (`theme` in docs.json — `mint`/`maple`/`palm`/`willow`/`linden`/`almond`/`aspen`/`sequoia`/`luma`, hosted docs platforms' set) defined as token bundles in `src/lib/theme.ts` and applied as CSS variables on `<html data-theme="…">`, so the whole UI re-skins from one config value. Adding/tuning a theme = one registry entry (+ optional CSS keyed on `[data-theme="…"]`). Brand accent from `docs.json` `colors`; light/dark default from `appearance.default`.
- **Markdown features:** GFM, footnotes, auto-linked headings, frontmatter (title, description, icon, sidebar overrides), `og:` image generation per page (BUILT 2026-08-25 — see the social-cards note at the end of this section).
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

> **Social cards + page SEO metadata — landed 2026-08-25.** Sharing any docs page produced a
> bare URL: nothing emitted an `og:`/`twitter:` tag anywhere, and on a *tenant* route the
> `<title>` was the site name on every page (both tenant routes' `generateMetadata` returned
> only `{ title: { default: record.name } }`, overriding nothing per-page). Fixed in one shared
> pure module, `packages/renderer/lib/seo.ts` — `pageMetadata()` builds title, description,
> canonical, `og:*` and `twitter:*` for a page — called from all four docs routes (apex
> single-repo, `/sites/{slug}`, custom domain, and the published CLI), which previously each
> emitted a different subset.
>
> **The image is generated, not required.** `GET /api/og/{slug}` renders a 1200×630 PNG via
> `next/og` from the site's own `colors.primary` and `appearance.default` plus the page's title
> and description (`packages/renderer/lib/og-card.tsx`). Three decisions worth keeping:
>
> - **Under `/api/`, resolved from the Host.** That's the one path space middleware passes
>   through untouched on every host class, so ONE route answers for tenant subdomains, custom
>   domains and the apex, resolving its tenant exactly the way the page render does
>   (`requestContentSource`). Apex path mode is the only case the Host can't answer, and it
>   carries `?site=` — the convention `/api/search` already uses.
> - **Content-derived, never parameterised.** Title/description come from the page, not the
>   query string, so nobody can mint `…/api/og?title=<anything>` and serve arbitrary text as an
>   image from a *customer's* domain. It costs a content read per card (version-cached), which
>   is the right trade against an image-defacement surface on someone else's brand.
> - **Font-free.** `next/og` ships one bundled face and we pass no `fonts` option, so hierarchy
>   is size/color/spacing rather than weight. That keeps a font file out of the CLI tarball,
>   where §10.6 has already been bitten twice by things that only break once installed.
>
> `metadataBase` comes from the request Host (`packages/renderer/lib/origin.ts`), not from
> config — one deployment answers on the apex, every tenant subdomain and every vanity domain,
> and X drops a card whose image URL isn't absolute. The card URL carries the tenant's synced
> `updatedAt` as `?v=`, because X/Slack cache a card by URL and a re-synced page would otherwise
> unfurl its old title indefinitely.
>
> **Precedence** (docs.json-compatible): page frontmatter meta tags → `docs.json` `seo.metatags`
> → the generated card. `seo` is now parsed (leniently, like every other field) and `metatags`
> is an open map emitted verbatim; in frontmatter, a key counts as a meta tag when it contains a
> `:`, so ordinary fields (`icon`, `mode`, `sidebarTitle`) can never leak into `<head>`.
> Dimensions are declared only for OUR card, whose size we know — guessing them for an authored
> image makes X letterbox it.
>
> **Reader-auth interaction:** a card is fetched by crawlers with no session, so on a gated site
> (§11.2) a non-`public` page's card degrades to the site name alone. Emitting the title would
> unfurl exactly what the 404-not-403 rule withholds.
>
> **A loop this closes.** The editor's page settings (§10) has shipped an "OG Image URL" field
> whose placeholder reads *"auto generated by default"* since it was built — it wrote `og:image`
> into frontmatter that nothing then read, so both halves of that sentence were false. Both are
> true now.
>
> **Verified:** typecheck clean; unit 1186/1186 including 23 new (`tests/unit/seo.test.ts`); smoke green with
> a new `social` fixture (authored override beats the generated card) and three card renders
> asserted as real PNGs — PNG magic + a size floor, since `ImageResponse` *streams* and a satori
> throw yields a 200 with the right header and a truncated body; crawls of `docs/` 45/45 and
> `examples/starter` 36/36 with 0×500; clean-room `test:cli` green with a new assertion that the
> card renders **from the installed tarball** (the wasm + bundled font live inside `next` behind
> a dynamic import — the shape that broke the Turbopack externals). Browser-checked against the
> seeded tenant on all three host modes: subdomain, apex path mode and a gated site, plus the
> long-title / no-description / no-title edge cases and the dark-appearance variant.
> `mirror:cli --dry-run` was NOT run — it refuses an uncommitted tree, and `git stash create`
> omits untracked files, so it would have typechecked a renderer missing the three new modules.
> Its specific risk (an undeclared renderer dependency) is nil here: the audit grep in
> `packages/renderer/README.md` shows no new external import — the additions pull only `next`
> and `react` types, both already peer deps — and `test:cli`, the stronger gate, is green.
>
> **Not done:** no `logo` on the card (fetching a tenant asset mid-render adds a failure mode
> for marginal gain), no sitemap/`robots.txt`, and `seo.indexing` is parsed but not acted on —
> only per-page `noindex` is.

> **The platform's own cards + the `@papervine_io` handle — landed 2026-08-25.** The marketing
> apex declared `twitter:card: summary_large_image` with **no image**, the one combination that
> unfurls as nothing at all, and `/pricing` carried no `og:`/`twitter:` tags whatsoever. Both now
> go through `src/lib/marketing-seo.ts` (`marketingMetadata()`), which supplies the canonical
> host, the `og:`/`twitter:` set, and `twitter:site`/`twitter:creator` = **`@papervine_io`** —
> without it X renders the card anonymously.
>
> **The handle is deliberately NOT in the root layout.** That layout renders for every host,
> tenant docs included, so anything it stamped would attribute a *customer's* docs card to us. A
> tenant that wants its own handle sets `seo.metatags` in its `docs.json` — which our dogfood
> docs site now does, so `docs.{platform}` is itself the proof the feature works.
>
> The artwork is `src/lib/marketing-og-card.tsx`, shared by `home/opengraph-image.tsx` and
> `pricing/opengraph-image.tsx`: the landing page's near-black ground and blue→violet gradient
> (satori does support `background-clip: text`, which is how "grows" is painted). It's a separate
> component from the tenant card on purpose — that one renders a customer's `docs.json`, and the
> apex has none. The pricing card is **price-free**: prices live in the billing catalog and ship
> via `billing:sync` (§10), so baking "$50" into a PNG would strand a stale image on every
> timeline that had already scraped it, with nothing to signal it.
>
> **`metadataBase` for a static image route, verified in Next's source rather than guessed**
> (`next/dist/lib/metadata/resolvers/resolve-url.js`): for a file-convention `opengraph-image`
> Next *always* overrides the base — dev → `localhost:PORT`, `VERCEL_ENV=preview` → the preview
> deployment URL, otherwise → your `metadataBase`, else `VERCEL_PROJECT_PRODUCTION_URL`. So the
> dev-only mismatch between `og:image` (localhost) and `og:url` (`www.{platform}`) is expected
> and correct in every environment — but only because `marketingMetadata` sets `metadataBase`.
> Don't remove it on the grounds that the root layout already provides one: the root layout's is
> what makes *tenant* `og:image` absolute (a relative string, a different code path), and it is
> ignored here.
>
> **Verified:** typecheck clean; unit + smoke green (the `/home` smoke check now asserts
> `twitter:image` and the handle — a card type with no image is exactly the silent failure this
> guards); both cards rendered and eyeballed; `docs/` crawl 45/45 with the new `seo.metatags`.

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
> parser). Many real APIs return 406 / HTML without it, yet specs almost never
> declare `Accept` as an explicit parameter, so the playground sent no `Accept` and the request
> failed. It's injected as a normal, pre-filled + editable header field (so it shows in the
> Headers section and the samples), and skipped when the spec already declares its own `Accept`.
> Unit-tested (`openapi-produces`); verified in-browser against a real customer spec
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

> **Status — the playground remembers credentials for the tab (2026-07-24).** Credentials lived
> in `ApiTryItModal`'s component state, and **every operation page mounts its own modal** — so a
> Basic-auth spec meant retyping username + password on *every single endpoint*. They now persist
> through `packages/renderer/lib/try-it-credentials.ts`, with an explicit **Forget** control in the
> Authorization header row and a line of copy stating the lifetime (the reader should never have to
> guess where their password went).
>
> Two deliberate choices. **`sessionStorage`, not `localStorage`:** it survives navigation between
> endpoints — the actual pain — while staying scoped to the tab and cleared when it closes, rather
> than persisting on the machine indefinitely. Threat model, stated plainly: this is **not** an
> isolation boundary (any script on the origin reads every key, so the per-spec keying is
> correctness, not defense) and **not** memory-only (browsers back session storage on disk for
> crash/tab restore). What it buys is a *bounded lifetime*. The exposure delta over not remembering
> at all is narrow — the playground is client-side by design, so the credential is in page memory
> and on the wire from the browser either way; remembering widens the window during which an XSS
> that lands *later* could scoop it up without the modal ever being open. A durable
> `localStorage` entry would widen that to "forever, on this machine", which is the line we don't
> cross for a convenience feature. **Keyed by spec path, not origin:** in apex path mode (`/sites/{slug}`) every
> tenant shares an origin, and a scheme named `BasicAuth` on one site must not prefill another's;
> the same key also isolates two specs on one site. Reads are filtered to the field keys the
> current schemes declare, so a stale or hand-edited entry can't inject fields into a request, and
> every storage access is guarded (Safari private mode throws on `sessionStorage` access itself) —
> a browser that refuses storage degrades to "doesn't remember", never to a broken modal.
>
> The store is a pure module (the `Storage` slice is injected) and unit-tested —
> `try-it-credentials.test.ts`: round-trip, per-spec scoping, clearing really clearing, foreign/
> corrupt entries ignored, throwing storage. Verified in-browser against the fixtures spec (which
> gained a `BasicAuth` security scheme): filled on `list-users`, credentials prefilled on
> `get-user` after a full navigation, cURL sample showing the right `Authorization: Basic …`,
> **Forget** clearing both pages, console clean.
>
> Still typing them *once* per tab. The zero-typing path is `apiPlaygroundInputs` on the reader-auth
> JWT (§11.2) — the IdP asserts the reader's own API credentials at login and the playground
> prefills from the session. The field is already in `ReaderJwtUser`; wiring it to the playground is
> unbuilt.

> **Status — the playground honors every `security` alternative, with a picker (2026-07-25).**
> `resolveAuth` read **only `requirement[0]`**, so a spec whose root said
> `security: [{BasicAuth: []}, {BearerAuth: []}]` — the ordinary way to say "either works" — showed
> the Basic fields and **silently dropped Bearer**. Found by probing the resolver with the four
> real-world spec shapes rather than reading the code: OR → 1 of 2, AND → both, unreferenced
> scheme → nothing, op-level override → fine.
>
> `Operation.auth` is now `AuthOptions = AuthScheme[][]` — **outer array is OR, inner is AND**,
> exactly mirroring the spec — and the modal renders a picker when there's more than one
> alternative. Only the selected alternative is folded into the request, which is the point:
> rendering both would put two values in one `Authorization` header, with the last write winning
> and a request the reader didn't intend. Credentials are keyed per scheme (`BasicAuth.username`,
> `BearerAuth.token`), so switching alternatives keeps both, and the **choice is remembered per
> spec** alongside them — picking Bearer and landing back on Basic at the next endpoint is the same
> annoyance as retyping. It's stored **by label, not index**, so reordering a spec's `security` list
> can't silently select a different scheme; an unknown label falls back to the first option. The
> choice survives **Forget** (a preference, not a secret).
>
> Two judgment calls worth recording. An empty requirement (`{}`) is OpenAPI's "auth optional" and
> is kept as a **No auth** alternative. But a requirement naming *only* schemes the spec never
> defines is **dropped**, not kept as an empty alternative — it resolves to the same empty array,
> and rendering it as "No auth" would tell readers a broken spec's endpoint is open when it isn't.
> Also surfaced `bearerFormat` (e.g. `bearer · JWT`) on the token field, since it's the spec
> author's hint about what to paste.
>
> Unit-tested in `openapi-auth.test.ts` (OR/AND/optional/op-level-override/dangling-ref, plus
> `bearerFormat`) and `try-it-credentials.test.ts` (label, choice round-trip, label-follows-reorder,
> fallbacks, out-of-range write, survives clear). The fixtures spec now offers Basic **or** Bearer,
> so the smoke gate renders the picker. Verified in-browser: picker switches the fields, the cURL
> sample flips to `Authorization: Bearer …` with no Basic header, both credentials survive
> switching, choice + token persist across a full navigation to another endpoint, console clean.
>
> **Review pass — four real defects, all in the persistence seam.** Worth recording because three
> of them only appear with a *second* scheme or a *second* operation, which is exactly what the
> alternatives work introduced:
>
> 1. **`writeCredentials` replaced the entry instead of merging.** Each modal knows only its own
>    operation's schemes, so on a spec where an operation overrides the root `security`, saving on
>    operation B wiped operation A's credentials — and emptying B's last field deleted the whole
>    entry. Now merges into what's stored; a scheme's own field going empty still removes that field.
> 2. **The key wasn't tenant-unique.** `specPath` is repo-relative, so in apex path mode
>    (`/sites/{slug}`, one origin for every tenant) two sites with `openapi.json` shared a key —
>    the exact leak the keying claimed to prevent. Added `credentialScope`, which mixes in the
>    `/sites/{slug}` prefix; the SPEC/docs claim has been corrected to match.
> 3. **Two OAuth2 alternatives differing only by scope collapsed to one label** → duplicate React
>    keys (a console error, which this repo gates on), two indistinguishable picker buttons, and a
>    label lookup that could never restore the second. Scopes don't reach the playground at all, so
>    `resolveAuth` now dedupes alternatives by resolved-scheme signature — the honest fix, since the
>    two really are identical to everything downstream.
> 4. **A batched pair of edits lost one.** `setAuthValue` read `authValues` off the render closure,
>    so a password manager filling username + password back-to-back persisted the stale copy. Now
>    goes through a ref mirror.
>
> Also: an AND requirement whose schemes both target `Authorization` can't be sent as written (one
> header, one value). Rather than quietly send the last one, the section flags the collision inline
> (`authorizationConflicts`) — and the docs no longer claim both are sent.
>
> **Soft navigation remounts the endpoint page — measured, after two reviews asserted otherwise.**
> Both review passes reasoned that because every endpoint page is the same route file at the same
> tree position, an in-app `<Link>` between operations *reuses* the `ApiTryItModal` instance: pass
> two concluded state leaks across operations (fixed with a `key`), pass four concluded that same
> `key` had broken the in-modal operation switcher. A mount/unmount probe settled it: clicking a
> sidebar link logs `unmount list-users` → `mount get-user`. **The App Router remounts the
> subtree.** So no state could ever have carried across operations, and the `key` was a no-op —
> both findings rested on a premise nobody had checked, including me when I "verified" the first
> fix (`agent-browser open <url>` is a *hard* navigation, which remounts either way and so proves
> nothing about soft navs).
>
> The lesson is the cheap one: a claim about component identity is a five-minute measurement, and
> two rounds of plausible reasoning got it backwards. The clamp on the choice index stayed — it's
> correct defensively — and the probe is gone.
>
> A restructure done on the false premise (open state hoisted out, per-operation state behind a
> keyed child) was **reverted**, because it regressed something real: with state in a component
> that unmounts on close, closing and reopening the playground discarded typed params and body.
> The consolidated single component keeps them (verified: `limit=25`, which is never persisted,
> survives a close/reopen) and drops the 25-prop drill the split had required.
>
> **Fixed the switcher the remount exposed (2026-07-26).** The in-modal operation switcher had
> never done its job: picking a sibling operation navigated *and closed the playground*, leaving a
> control that was a worse version of the sidebar link next to it. `open` dies with the remount, so
> no `key` could save it — the state had to leave the component. It now lives in the URL as
> **`?playground=open`** (`lib/playground-url.ts`): the switcher's links carry the flag, a fresh
> mount reads it back, opening writes it, and closing takes it off so a refresh doesn't reopen
> something the reader dismissed. A query parameter rather than a hash because docs pages already
> use the hash for heading anchors — a page with a `## Playground` heading would collide.
>
> The flag is read in an effect rather than a lazy initializer: the server renders every page
> closed, so reading `location` during the first render would be a hydration mismatch. The cost is
> that a deep-linked playground opens a frame after paint.
>
> Falls out for free: **the playground is linkable**. `…/get-user?playground=open` opens the
> endpoint ready to run, which is what you want to paste into a support thread. Pure core
> unit-tested (`try-it-playground-url.test.ts` — flag round-trip, other query parameters and the
> heading anchor preserved, idempotence); verified in-browser: open → URL gains the flag, switch
> operation → playground stays open showing the *new* operation, close → flag removed, cold load of
> a flagged URL → opens on arrival, console clean (no hydration warning).
>
> The fixture gives `getUser` an operation-level `security: [{ApiKeyAuth: []}]` so the
> differing-scheme case is in the smoke gate, and the in-browser check is: fill Basic on
> `list-users` → soft-nav → `get-user` shows its own apiKey field → both credentials in one storage
> entry.
>
> Also from the fourth pass: **"Forget" now appears whenever the *spec* holds credentials**
> (`hasStoredCredentials`), not only when the current operation's own fields are filled. It clears
> the whole entry, so gating it on the current fields left a reader on an operation with a
> different scheme unable to clear a token they'd entered elsewhere. And a **cookie-located apiKey**
> is emitted as `Cookie: name=value` rather than a header named after the cookie — the old form was
> a snippet that 401s when pasted. (Browsers forbid scripts from setting `Cookie` on a fetch, so a
> live Send still won't carry it; the copyable sample is now correct, which is where it matters.)
>
> Three smaller ones from the same pass: `defaultAuthChoice` now starts on the first alternative
> that *asks* for a credential, because index 0 on the common `security: [{}, {Bearer}]` shape
> selected **No auth** and would send an unauthenticated request from a reader holding a token;
> `authorizationConflicts` no longer warns about a query-located apiKey that merely shares the name
> `authorization`; and the banner says "only one of them reaches the API" rather than naming the
> last, since the builder skips empty fields and the *first* can be the one that survives.
>
> **The read-only samples now derive auth from `op.auth`** (`sampleAuth`), not from an explicitly
> declared `Authorization` *parameter*. That gap predates this work, but declaring security schemes
> in the fixture made it visible: the page showed an unauthenticated cURL sample beside a playground
> sending `Authorization: Basic …`. Placeholders elide the credential (`Basic <credentials>`,
> `Bearer <jwt>` when `bearerFormat` says so, `<key>` in the right header or query parameter).
> Pinned by smoke checks on both fixture endpoints, since the samples are server-rendered HTML.
>
> **Self-review pass — the samples are copy-paste surfaces, and weren't shell-safe.** The cURL
> samples (both the static one and the playground's live one) emitted the URL **unquoted**. That was
> latent before — a real URL with two query parameters carries an `&`, which backgrounds the command
> when pasted — and putting a query-string API key in the sample made it worse: `?api_key=<key>`
> contains `<`, a redirect. Both now quote the URL. Also: an AND requirement combining two
> Authorization-header schemes made `sampleAuth` emit the header twice — a duplicate `-H` and a
> duplicate key in the JS object literal — so it now keeps one value per header name, matching how
> the playground folds them in and what the collision notice tells the reader.
>
> **…and quoting alone wasn't enough (fifth pass).** Single-quoting fixes `&` and `<` but not `'`,
> which *ends* the quoted string — and `encodeURIComponent` leaves it alone, so a path value like
> `o'brien` (or a password containing an apostrophe) produced an unbalanced quote that hangs the
> shell. Every interpolated value now goes through `shellQuote` (`'` → `'\''`), and the JS/Python
> samples embed values with `JSON.stringify` rather than bare quotes for the same reason. Verified
> by generating the sample in-browser and running it through `bash -n`: parses clean, and the URL
> round-trips to exactly `…/users/o'brien`.
>
> Three more from that pass. **Two cookie-located apiKeys ANDed** (a session + CSRF pair) both wrote
> `headers["Cookie"]`, so one credential vanished — they now accumulate into one `Cookie: a=…; b=…`,
> in both the samples and the request builder. **`authorizationConflicts`** flagged a cookie-located
> key named `Authorization`, warning about a collision the builder never creates. And
> `sampleAuthFor` **dropped a documented header**: an operation declaring both a security scheme and
> an explicit `Authorization` parameter used to show the latter, and the new security-derived path
> had turned that into an either/or — it's additive again.
>
> **Sixth pass — the switcher link never left the apex, and spec examples never arrived.** Two
> findings that mattered more than their line counts:
>
> - The switcher's `href` was root-absolute (`/${slug}`), skipping `withBase` — so in **apex path
>   mode**, where a tenant's docs are served under `/sites/{slug}`, clicking a sibling operation
>   left the tenant for the platform apex. Pre-existing, but this branch's headline behavior rides
>   on that link, so it was load-bearing breakage. `EndpointReference` now takes `siteBase` (threaded
>   from `render-tenant.tsx`, empty on a tenant's own host) and the link is base-prefixed like every
>   other internal link.
> - **Every author-written example was silently dropped from the generated samples.** `upgrade()`
>   rewrites a 3.0 spec's `example: x` into 3.1's `examples: [x]`, and `sampleFromSchema` /
>   `paramExample` read only `example` — so a spec saying `example: "O'Brien"` rendered
>   `"name": "string"`. Most real specs are 3.0, so this was near-universal. Found only because a
>   fixture example stopped showing up; fixed in both readers.
>
> Also from that pass: the static cURL's **request body** was still bare-quoted (the modal's was
> fixed, one file over) — and a spec `example` is exactly where an apostrophe comes from, so the two
> bugs above were the same bug meeting itself; the **JS/Python samples** now embed names and URLs
> with `JSON.stringify`, since a scheme name or server URL can contain a quote; a **cookie
> *parameter*** (`in: cookie`) was still mapped to a header named after the cookie — the shape this
> pass had already fixed for cookie-located *schemes* — and now folds into `Cookie: a=…; b=…` with
> its own section in the playground; and `sampleAuthFor` matched an auth parameter by substring but
> deduped by exact name, so a documented `X-Authorization-Token` produced a hard-coded
> `Authorization` header the spec never declared.
>
> **Seventh pass — mostly about telling the reader the truth.** Cookies can't be sent by a browser
> at all: `Cookie` is a forbidden request header, so `fetch` strips it and a live **Send** quietly
> goes out without the credential. The code knew this in a comment; the reader didn't. Both the
> Cookies section and a cookie-located scheme now say so and point at the cURL sample, which does
> work. Related: a security scheme could **silently overwrite a reader-typed `Authorization` header
> parameter** — restored credentials clobbering a value the reader had typed, with the field still
> showing it. Explicit input now wins over ambient stored credentials (`setHeader` skips any header
> a parameter already set), which is the same dedupe the sample side got.
>
> Two more from that pass: the undefined-scheme guard only fired when *every* key failed, so a
> half-broken AND requirement (`{ApiKeyAuth, BearerAuth}` with one undefined) passed silently and
> offered a complete-looking alternative missing a credential — it now warns on any shortfall and
> keeps what resolved. And `paramExample` ran `String()` over whatever it found: since `upgrade()`
> made `examples` the common path, an object example would prefill a field with `"[object Object]"`
> **and send it** — scalars only now. Cookie parameters also gained a reference-table group; they
> were a first-class playground input documented nowhere on the page.
>
> Adjacent fix the review flagged as a note: **`btoaSafe` fell back to returning the credential
> unencoded** when `btoa` choked on a non-Latin1 password (`é`), producing an Authorization header
> that both fails to authenticate and puts the raw password on the wire. UTF-8-encodes first now,
> per RFC 7617.
>
> Also re-added `key={op.slug}`, on better reasoning than the first time. The remount is *observed*
> behavior, and if the App Router ever reconciled instead, the failure would be silent — one
> operation's inputs on the next. The key makes it structural, and it's constant within a page, so
> closing and reopening the playground still keeps what you typed.
>
> **Declined:** clearing the remembered auth *choice* on "Forget". Forget is about credentials; which
> scheme you're using isn't one, and landing back on the picker you were using is what you want when
> you re-enter a credential. Pinned by a test so it stays a decision rather than drift.
>
> A requirement naming only undefined schemes now **warns** (`console.warn`, matching the config
> layer's warn-don't-throw posture). Residual, recorded honestly: if it's the operation's *only*
> requirement, the endpoint still renders with no Authorization section and reads as open. Telling
> readers would mean plumbing "there was a requirement we couldn't resolve" through to the modal;
> the warning goes to the author, who is the one who can fix the typo.

---

## 8. AI Assistant (M5)

A conversational assistant over the tenant's docs + OpenAPI, modeled on hosted docs platforms'
"Ask Assistant" (right-hand slide-out panel). Verified behaviors we target are
cited from hosted docs platforms' own docs/blog where noted.

> **Status — slice 1 built (2026-06-08):** agentic `/api/assistant` route (Claude via
> Vercel AI SDK v6 + tool calling over `searchDocs`/`readPage`/`listPages`/`searchApi`
> in `src/lib/assistant-tools.ts`), slide-out panel (`src/components/assistant/`) using
> `useChat` + `streamdown`, navbar "Ask Assistant" button, `Cmd/Ctrl-I`, and
> `?assistant=` deep link. AI is configured via `src/lib/ai-model.ts` (see the Model
> bullet in §8.1) — graceful 503 when no route is configured.
> **Next:** dedicated `Sources` citation UI, multi-modal attach, current-page context
> polish, embeddings-backed `searchDocs`.

### 8.1 Architecture: agentic retrieval, not single-shot RAG

Modern docs assistants are **agentic RAG with tool calling**: the model decides how to search
the docs per question rather than doing one top-k lookup, and it can navigate a docs corpus
through filesystem-like tools over indexed content. We adopt the same shape — and it's cheap
for us because **the tools are thin wrappers
over capabilities we already have** (M1 content loader, M2 nav, M3 search, M4 OpenAPI):

```
User question ──▶ /api/assistant (Vercel AI SDK streamText, model via ai-model.ts)
                    │  loop: model calls tools until it can answer
                    ├─ search_docs(query)      → M3 search index (titles/headings/body)
                    ├─ read_page(slug)         → full MDX (src/lib/content.ts)
                    ├─ list_pages()            → nav tree (src/lib/nav.ts)
                    └─ search_api(query)       → OpenAPI operations (src/lib/openapi.ts)
                    ▼
                 streamed answer + Sources (cited page hrefs / #anchors)
```

- **Model & routing (config-driven, provider-agnostic — updated 2026-07-18):** the
  model and how we reach it are env config in `src/lib/ai-model.ts`, NOT hardcoded. Both
  AI routes (`/api/assistant`, `/api/editor-agent`) call `aiModel()`.
  - `PAPERVINE_AI_MODEL` = a `provider/model` id (default `anthropic/claude-haiku-4-5`).
  - `AI_ROUTING=gateway` (default) routes through the **Vercel AI Gateway** (one key via
    `AI_GATEWAY_API_KEY`, or Vercel OIDC in prod — unified access to ~all providers/models);
    `AI_ROUTING=direct` bypasses Vercel and calls the provider SDK directly
    (`@ai-sdk/anthropic|google|openai`) with that provider's own key. So we can use the
    gateway when convenient and go direct (own keys, cheaper, no middleman) when we prefer.
  - **Why Haiku is the default:** the assistant is agentic (several model calls/question),
    and the Vercel Gateway's FREE tier hard-throttles the cheap models. *Tested 2026-07-18
    (6-call burst per model): only `anthropic/claude-haiku-4-5` survived 6/6; `amazon/
    nova-micro` 5/6 but leaks reasoning + still throttles mid-conversation; gemini-2.5-flash-lite,
    gpt-5-nano, nova-lite, gpt-oss-20b, glm-4.7-flash, ministral-3b all 0/6; gemini-3.x is
    blocked (paid-only).* So Haiku is the only free-tier-viable model. The **cheap path**
    (~10× less) is `AI_ROUTING=direct` + a Google AI Studio key →
    `google/gemini-3.1-flash-lite`, which sidesteps the gateway's free-tier limits entirely
    (Google's own free/pay-as-you-go pricing). See the two documented model lines +
    routing block in `.env.example`. Prompt caching is wired (2026-07-21): on the gateway
    route `aiProviderOptions` sets `gateway.caching:'auto'` — provider-agnostic (implicit for
    Gemini/OpenAI, auto-injected `cache_control` for Anthropic), so token savings hold for any
    model; direct route keeps `anthropic.cacheControl`. See §10.2 guardrails note.
    See the `claude-api` skill for current Anthropic model IDs/patterns.
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
  hardcoded, so an operator running their own deployment gets everything.

**Where each setting lives.** Published-behavior config (starter questions, deflection
email + help button, search domains) is **version-controlled in `docs.json`'s `assistant`
block** — the dashboard edits it through the authoring layer (§9.2) so it stays in Git.
Operational/metering state (enable toggle, CAPTCHA, credits, plan) lives in our **DB** for
instant effect. An operator running their own deployment reads it all from `docs.json` +
env, no dashboard required.

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
> **Temporarily operator-only (2026-08-23).** The whole *Response handling* row — deflection,
> its enterprise banner, Search Domains — is wrapped in a `platformAdmin` check so customers
> don't meet controls that don't do anything yet. Gated on **platform** admin, not org role: an
> org admin is still a customer. Verified both sides against the seed, which has exactly the
> pair that distinguishes them (`dev@` is a platform admin, `dev2@` is an org admin and is not).
> The wrapper comes out — not the section — when the controls reach the authoring layer; the
> note to do so is on the JSX itself. Starter questions is scaffold too but stayed visible: it
> reads as an empty state rather than a broken control.
>
> **Kill switch now enforced (2026-06-30).** Persisting the toggle wasn't enough — the docs site
> never read `assistant_enabled`, so disabling it still showed the "Ask Assistant" launcher on
> prod. Enforcement landed at both read points, mirroring the `authEnabled` gate: `TenantDocsShell`
> (`render-tenant.tsx`) skips mounting `<AskAssistantButton>` and `<Assistant>` when the row's flag
> is off, and `POST /api/assistant` returns **403** for a positively-resolved disabled tenant (so
> hiding the launcher can't be bypassed by calling the endpoint). Both resolve the row via a new
> `requestSiteRecord` helper (`request-source.ts`), the same tenant resolution the content source
> uses; the apex/preview host (no row) keeps the platform's own docs assistant working. The 403 sits
> *after* the `aiConfigured()` 503 check so the DB-free smoke (no AI route → 503 before any DB read)
> is unaffected. Regression: `tests/e2e/tenant-render.spec.ts` asserts a disabled site renders but
> hides the launcher. **CAPTCHA is still not enforced** — `assistant_captcha_enabled` persists but
> there's no hCaptcha integration on `/api/assistant` yet (separate follow-up).

### 8.7 Embeddable widget (Settings → Widget)

A `<script>` snippet an owner drops into any **external** site they control (their
marketing site, app, support portal — not just their Papervine docs), mounting a floating
chat bubble backed by the same assistant. Modeled on hosted docs platforms' own widget
feature. Unlike §8.6's in-docs assistant (same-origin, can trust a reader session), this is
a **new public, cross-origin, unauthenticated attack surface** — the design leans on
precedent already in the codebase rather than inventing a new access model:

- **Identity is a public widget id, not a secret.** `site.widget_id` (`widget_<uuid>`,
  minted at site creation or lazily on first Settings → Widget visit) is safe to ship in
  client-side code — the same model Stripe.js/Intercom-style embeds use. The security
  boundary is the **origin allowlist** (`site.widget_allowed_origins`, exact-match only, no
  paths/wildcards), enforced by `/api/widget/[widgetId]/chat`'s CORS handling
  (`src/lib/widget.ts`'s `isOriginAllowed`), not a bearer token that client-side JS can't
  actually keep secret anyway.
- **Content access is always anonymous, never the reader's session.** A widget on a
  third-party page can't reliably carry our reader cookie cross-origin, and even if it
  could, an anonymous website visitor must never see gated docs. The widget route calls
  `requestReaderAccess(slug, { anonymous: true })` — the exact mechanism the MCP server
  already uses for the same reason (SPEC §11.2) — so a gated page is as invisible to the
  widget as it is to an external agent with no session.
- **Off by default.** `widget_enabled` defaults `false` (unlike `assistant_enabled`'s
  default-`true`, which gates an already-trusted same-origin surface) — a brand-new public
  endpoint should be opt-in.
- **No bundler.** The embed script (`src/lib/widget-embed-script.ts`) is hand-authored,
  dependency-free, modern JS served verbatim (`GET /api/widget/embed.js`) — this repo has
  no bundler anywhere, and introducing one for one small script wasn't worth it. It mounts
  into a shadow root (host-page CSS can't leak in or out) and hand-rolls its own markdown
  renderer (headings, lists, links, bold/italic, code) rather than pull in a
  markdown-parser dependency for a script that intentionally ships with zero. It builds
  real DOM nodes directly (`document.createTextNode`/`createElement`) and never assigns
  `innerHTML` from model output, so it's injection-safe by construction — no HTML-escaping
  step to get right or forget, and a crafted `javascript:` link or literal `<script>` in
  the AI's own answer can't do anything (verified: `tests/e2e/widget-embed.spec.ts`).
- **Only the model's final answer is shown, not every step's narration.** The agentic
  loop streams one text segment PER STEP — "let me check the intro page…" is a genuinely
  separate segment from the real answer that follows it, not part of it. Concatenating
  every segment (the first implementation's bug) reads as one run-on, half-narrated blob.
  The widget shows only the CURRENT segment (reset on every `text-start`), with a
  "Searching the docs…" placeholder while a tool call is in flight and nothing to show
  yet — so it reads the way the in-docs Assistant UI reads, even though it can't literally
  share those React/AI-Elements components (shipping React + Tailwind into someone else's
  page is exactly what avoiding a bundler was for).
- **Shared conversation core.** The actual agentic loop (content scoping, system prompt,
  `streamText`, billing metering) is `runAssistantConversation` (`src/lib/assistant-run.ts`),
  extracted out of `/api/assistant` so both routes share it — billing-metering logic is
  exactly the kind of thing that shouldn't drift between two call sites.

> **Status — landed (2026-07-31).** `site.widget_id`/`widget_enabled`/
> `widget_allowed_origins` (migration 0020); Settings → Widget page
> (`settings/widget/{page,WidgetForm,actions}.tsx`) matching hosted docs platforms' own
> layout (Availability / Authorized domains / Installation); `/api/widget/[widgetId]/chat`
> (CORS + origin enforcement + anonymous-only content access) and `/api/widget/embed.js`.
> Covered by `tests/unit/widget-origin.test.ts` (origin validation), the smoke DB-free gate
> (`embed.js` 200, unknown widgetId 404/403 not 500), and
> `tests/e2e/widget-settings.spec.ts` / `widget-embed.spec.ts` (the latter drives a real
> cross-origin round-trip against a genuinely different local origin, console-clean
> asserted). Verified in a real browser end-to-end: a static HTML fixture on a separate
> origin loaded the real embed snippet and completed a multi-turn conversation. **Two
> install methods (2026-08-01):** the explicit two-script `init({id})` call shown by
> default in the Settings page, and a single-tag alternative — a `data-widget-id`
> attribute on the loader script itself auto-mounts the widget with no second inline
> script, for sites that just want the default bubble with minimal markup. The settings
> page shows both snippets. `document.currentScript` is always null for module scripts
> (spec, not a bug), so the loader finds its own tag by `src` instead
> (`document.querySelector('script[src*="/api/widget/embed.js"][data-widget-id]')`) —
> covered by a second `tests/e2e/widget-embed.spec.ts` case (a bare data-attribute page,
> no init() call anywhere in its markup, console-clean).
>
> **Markdown rendering + step narration (2026-08-02).** Real usage against a live model
> surfaced two problems the local verification's shorter answers hadn't hit: the widget
> rendered raw `## heading` / `[text](url)` / `- item` syntax as literal text (no HTML),
> and it concatenated EVERY agentic step's text into one bubble — including the model's
> "let me check X" narration between tool calls, not just the final answer. Fixed by
> hand-rolling a DOM-based markdown renderer (see the bullet above) and showing only the
> current step's text segment (reset on every `text-start`) instead of a running
> concatenation. Pinned by two new deterministic `tests/e2e/widget-embed.spec.ts` cases
> that exercise `window.PapervineAssistant.renderMarkdownHTML()` directly with fixed
> input — no live model call needed to catch a regression here.
>
> **Production CORS bug (2026-08-02).** The Settings page computed the embed snippet's API
> base by stripping `app.`/`www.` off the current request's Host header (copied from the
> `settings/domain` page's CNAME-target logic, where that stripping is correct — it wasn't
> here). In prod this generated `https://papervine.io/api/widget/embed.js` — but the bare
> apex domain 308-redirects (a canonical apex→`www`-style domain rule at the infra level),
> and a cross-origin `<script type="module">` load requires CORS on every hop; the redirect
> response itself carries no `Access-Control-Allow-Origin`, so the browser blocked the load
> before it ever reached our route — surfacing as a CORS error even with the origin
> correctly allow-listed. Fixed by using the current request's Host **verbatim**
> (`app.papervine.io` in prod) instead of guessing at a "bare apex" — it's provably
> non-redirecting, since it's the very host serving the settings page itself.
>
> **GFM tables (2026-08-08).** Real usage on an embedded customer site surfaced a table's rows
> squashed onto one line of literal `| Header | ... | --- | ... |` text — the renderer had
> no table detection at all, so a table's lines fell into the generic paragraph bucket,
> and paragraph lines are joined with a space. Fixed: a header line followed by a
> separator line (cells made only of `-`/`:`, GFM's table marker) now renders as a real
> `<table><thead>…</thead><tbody>…</tbody></table>`. Pinned by a third deterministic
> `tests/e2e/widget-embed.spec.ts` case (confirmed failing against the pre-fix renderer
> before the fix, reproducing the exact squashed-text shape reported in prod).
>
> **Markdown coverage audit (2026-08-08).** A mermaid-rendering report prompted a broader
> pass: fed nested lists, blockquotes, horizontal rules, and images through the renderer
> to see what else degraded. Nested lists were a genuine bug, not just missing polish — an
> indented sub-item didn't start at column 0, so it missed list detection entirely, fell
> into the paragraph bucket, and **split the parent list into two separate `<ul>`s around
> a squashed paragraph of stray dashes**. Fixed with a proper recursive block parser
> (`listItemInfo`/`buildListTree`): a list "run" (including indented and blank-line-gapped
> continuation lines) is collected in one pass, then built into a real nested tree — an
> item immediately followed by a more-indented item nests a sub-list inside that item's
> `<li>`. A second bug surfaced while testing THIS fix: collecting a run across a blank
> line didn't check that the next list was the same type, so a `ul` then a blank line
> then an `ol` got glued into one run, and the tree-builder (which correctly stops at a
> tag change) silently **dropped everything after that point** instead of rendering it
> as an adjacent list — fixed by looping the tree-builder over the whole collected run
> instead of assuming one call consumes it all. Also added: blockquotes (`>`) and
> horizontal rules (3+ of the same `-`/`*`/`_`), both simple one-block additions; real
> images (`![alt](src)`, through the same `safeHref` scheme-allowlist as links — a
> `javascript:` image src is defused the same as a `javascript:` link href); and a label
> on ` ```mermaid ` fences ("Diagram — view the full page in the docs…") instead of an
> unexplained bare code block. Also not fixed: backslash-escaped markdown (`\*not
> italic\*` still renders as italic) — rare enough in a Q&A assistant's own prose that
> it wasn't worth the added parsing complexity. Five new deterministic
> `tests/e2e/widget-embed.spec.ts` cases, including one that pins the exact "glued ul+ol
> run, second list silently dropped" bug found while building the nested-list fix itself.
>
> **Mermaid rendered on demand (2026-08-08).** The labeled-fallback trade-off above got
> revisited once it was actually seen in practice — real diagrams were worth it after
> all. Mirrors the main renderer's own approach (`components/mdx/Mermaid.tsx`, §7):
> dynamic-import mermaid lazily, only on a page/turn that actually has a diagram, degrade
> to source-in-a-`<pre>` on any failure, never a break. The difference is *how* it's
> imported — the main renderer dynamic-imports mermaid as a real npm dependency (Next.js
> code-splits it); this script has no bundler and no dependencies at all, so it
> `import()`s mermaid.esm.min.mjs **directly from jsdelivr, pinned to an exact version**
> (`src/lib/widget-embed-script.ts`'s `MERMAID_URL` — never a floating tag, so it can't
> silently change under us). The original plan was to fetch the file ourselves, verify a
> pinned SHA-384 hash, and `import()` it from a Blob URL for real integrity
> verification — abandoned once it turned out mermaid's real distribution is dozens of
> interlinked chunk files (some approaching 1MB) using relative imports that can't
> resolve from a `blob:` origin, and pinning every chunk individually isn't maintainable
> across version bumps. So this is a genuine third-party runtime dependency, trusted no
> further than "this exact, immutable jsdelivr version" — narrower than the vendored/
> hash-verified script this repo's other surfaces get, and worth remembering as the
> tradeoff if this ever needs tightening (vendoring the whole mermaid dist tree, or a
> real build step, are the two ways out). `securityLevel: "strict"` on the diagram
> content itself (stricter than the main renderer's `"antiscript"` — the widget runs on
> an arbitrary third party's page, not our own, so it gets the more conservative of the
> two). Called once per completed turn (never mid-stream — a diagram fence isn't
> reliably complete until the whole answer has streamed in), replacing the fallback with
> mermaid's own sanitized SVG output on success or reverting the note text on any
> failure (network, CSP block, invalid diagram syntax) — verified in a real browser both
> ways, including the on-demand load actually working cross-origin. Two `@external`
> `tests/e2e/widget-embed.spec.ts` cases (they hit the real CDN, so CI skips them via
> `--grep-invert @external` same as the GitHub-connect spec) pin the success and
> fallback paths; `upgradeMermaidDiagrams` is exposed on `window.PapervineAssistant`
> alongside `renderMarkdownHTML` for exactly this deterministic testing.
>
> **Pre-close audit (2026-08-08).** A few loose ends surfaced on a final pass, none of
> them blocking but worth fixing before calling this settled:
> - **The "View guide" link pointed at a domain that doesn't exist.** `docs.papervine.io`
>   was a guess — this repo's own architecture note (AGENTS.md) is explicit that the
>   *apex* (`papervine.io`) serves marketing **and** the dogfooded `docs/` content
>   directly; there is no separate `docs.` subdomain. Fixed to link to the bare apex.
> - **`init()` wasn't idempotent.** A page combining the single-tag `data-widget-id`
>   install with a second manual `init()` call — plausible, since the docs show both as
>   *alternatives*, not as something to combine — mounted two separate bubbles instead of
>   one. Fixed: the first call wins, every later call is a no-op. New e2e case.
> - **No preflight caching.** The chat route's CORS headers had no
>   `Access-Control-Max-Age`, so every single message in a conversation re-triggered an
>   OPTIONS round-trip before the real POST. Added (86400s, the practical browser cap) —
>   only the first message of the day now pays for a preflight. New e2e case.
>
> **Dark theme + init() options (2026-08-08).** Restyled to a dark-first look (matching
> hosted docs platforms' own widget), and added a first slice of the config surface real
> embeddable widgets expose (`init({ id, theme, title, placeholder, disclaimer,
> defaultOpen })`), researched from hosted docs platforms' own widget docs rather than
> guessed. `theme` ("dark" default, or `"light"`/`"system"`) is CSS custom properties on
> `:host`, toggled by a class on the host element — one variable block per theme instead
> of duplicating every rule. The floating launcher bubble stays a FIXED dark style
> regardless of `theme`, deliberately not themed — it sits on an arbitrary host page
> whose background we don't control, so it needs to read clearly against either a light
> or dark page; only the opened panel follows the theme setting. Mermaid diagrams now
> also pick up the matching mermaid `theme` (`"dark"`/`"default"`) so a diagram doesn't
> clash with a dark panel around it — `mermaid.initialize()` is called fresh on each
> render since mermaid has no per-call theme override otherwise. Added a close (✕)
> button in the header (there was previously no way to close the panel except clicking
> the launcher again) and the disclaimer line already used by the in-docs assistant
> ("Responses are generated using AI and may contain mistakes.", SPEC §8.2) for
> consistency — `disclaimer: false` omits the element entirely rather than emptying its
> text (which would've left a visible empty bar). New e2e case exercises the option
> surface end-to-end (theme class applied, title/placeholder/disclaimer respected, close
> button closes the panel) plus real-browser verification of the dark diagram recolor.
>
> **Full config/API parity with hosted docs platforms' widget (2026-08-08).** Built out
> the rest of the option surface researched from hosted docs platforms' own widget docs,
> superseding the "not yet built" list above:
> - **Layout/placement:** `variant` (`"widget"` default floating bubble, `"modal"` a
>   centered overlay with a backdrop, `"panel"` a full-height docked panel independent of
>   `side`/`align`); `side` (`top`/`bottom`/`left`/`right`, plus `inline-start`/
>   `inline-end` treated as left/right — no RTL-aware direction detection, a deliberate
>   simplification) and `align` (`start`/`center`/`end`) position both the launcher and
>   the panel via one `edgePositionCss()` helper; `zIndex` overrides the default (a very
>   high value, so the widget sits above ordinary host-page content by default).
> - **Branding:** `accent` (recolors both the accent surfaces and links), `radius`,
>   `font`, `logo` (a URL, or `{ light, dark }` to swap per theme) replacing the emoji
>   launcher, `trigger` (a text label that turns the launcher into a pill instead of a
>   bare circle).
> - **Content:** `starterQuestions` (up to 3 pills shown until the first message is
>   sent — wired to the same shape as the in-docs assistant's config, SPEC §8.6) and
>   `suggestions` (the heading text above them, default "Suggestions"); `supportEmail`
>   renders a `mailto:` link in the header for a human-fallback path.
> - **Behavior:** `dismissOnInteractOutside` closes the panel on an outside click;
>   `nonce` is copied onto the widget's one `<style>` tag for sites with a strict
>   style-src CSP.
> - **Programmatic API:** `window.PapervineAssistant.open/close/ask/update/reset/destroy`
>   — a no-op before `init()` resolves or after `destroy()`, rather than throwing, so a
>   customer's own code can call these opportunistically (e.g. from a page-wide keyboard
>   shortcut) without guarding every call itself. `update(config)` changes theme/text/
>   accent/radius/font/zIndex live without clearing the conversation; structural options
>   (variant, side/align, logo, trigger) are simplest to change via `destroy()` + a fresh
>   `init()` instead. Event hooks — `opts.event({type, actor, ...})` for
>   `init`/`ask`/`update`/`reset`/`destroy` and `opts.error({code, retryable, status})`
>   for a failed request — let a "headless" integration drive its own UI off the same
>   widget internals; both are wrapped in `try/catch` so a customer's own buggy hook can
>   never break the widget itself.
> - Explicitly NOT built: an `identity` (signed end-user token) option — real auth/
>   identity verification infrastructure, not a small addition, and it would contradict
>   the anonymous-only content-access model this widget was deliberately built around
>   (above); and an `endpoint` override — doesn't map to this codebase's single-backend
>   architecture the way it might for a platform with multiple regional endpoints.
> - Verified extensively live via a real browser: modal/panel variants, accent/radius/
>   font, side/align positioning, `dismissOnInteractOutside`, logo, trigger text,
>   supportEmail, starterQuestions, nonce, all event-hook types (including the error
>   hook), and all 6 runtime methods (including `destroy()` + a clean re-`init()`).
>
> **Per-visitor rate limiting landed 2026-08-29** (see §2, "the first rate limiter"). The
> org-level billing gate caps total spend but never stopped one allowed origin from making
> many cheap/free-tier requests within a period; the chat route now counts each visitor
> (hashed IP, keyed per widget) and answers a 429 with `Retry-After` once the window is
> spent. `Retry-After` is listed in `Access-Control-Expose-Headers` — it is not
> CORS-safelisted, so a cross-origin embed otherwise can't read its own cooldown — and the
> script already surfaces `body.error` for any non-2xx, so the message appears in the
> conversation with no client change.
>
> Still open: analytics that distinguish widget-originated questions from in-docs ones (both
> currently log as the same `source: "human"` event).
>
> **Citation links resolved against the wrong origin (2026-08-08).** The assistant's
> system prompt writes citation links as relative paths (e.g. `[Quickstart](/quickstart)`)
> — correct for the in-docs assistant, which renders same-origin, but wrong for the
> widget: a bare `/quickstart` resolved against whatever CUSTOMER page the widget was
> embedded on, not the tenant's actual docs. Fixed by having `/api/widget/[widgetId]/chat`
> compute the tenant's real public docs URL (`resolveDocsBaseUrl`, `src/lib/widget.ts` —
> same custom-domain / subdomain / apex-path-mode decision as the dashboard's "Open site"
> link) and send it as an `X-Papervine-Docs-Base` response header; the client reads it
> (via `Access-Control-Expose-Headers`, since a custom header on a cross-origin response
> is otherwise invisible to JS) and threads it through the markdown renderer so every
> `/`-rooted link and image `src` is made absolute against it — an already-absolute or
> hash-only URL is left untouched. Pinned by a `tests/unit/widget-origin.test.ts` suite
> for `resolveDocsBaseUrl` and two deterministic `tests/e2e/widget-embed.spec.ts` cases
> (with and without a known base) via `renderMarkdownHTML`'s new optional second
> argument. Verified live: a widget embedded on a separate local origin now renders a
> citation link pointing at the tenant's own docs host, not the embedding page's origin.

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
- ✅ **llms.txt brought to parity + `.md` page twins (2026-08-27):** the index was a flat
  `## Docs` list of HTML links, which is the shape of the convention without the substance of
  it. Now it matches what real AI clients expect (checked against the documented behavior of
  the format's main implementation):
  - **Structure from the nav.** Tabs and groups become `##`/`###` headings (capped at h4), so
    the index carries the same shape the sidebar does instead of one flat list. External leaves
    (frontmatter `url`) are collected into a trailing `## Optional`, per the convention that it
    holds what a client may skip.
  - **Descriptions, summary, instructions.** Each link carries the page's frontmatter
    `description` (truncated to 300 chars); the H1 is followed by a blockquote from `docs.json`
    `description`, then `markdown.instructions` verbatim. Both config fields are new — and
    `description` was already set in `docs/docs.json`, where it had been silently landing in
    the "unsupported key" warning.
  - **`seo.indexing: "all"`** now does something. It was parsed and used nowhere; it adds
    non-navigable pages under `## Additional pages`. Default stays `navigable`.
  - **`noindex: true` excludes a page from the feed** on both paths in (the nav walk and the
    `indexing:"all"` sweep). The opt-out that withholds a page from search and SEO withholds it
    here too — asserted in smoke rather than assumed, since it's a silent leak either way.
  - **OpenAPI/AsyncAPI specs** the nav points at get their own section. Scanned generically for
    `openapi`/`asyncapi` keys at any depth and in every shape `docs.json` allows (bare string,
    array, `{ source }`); externally-hosted specs are skipped — not ours to advertise.
  - **A repo can override the whole file** by committing its own `llms.txt`/`llms-full.txt` at
    the docs root. All-or-nothing, checked before anything is generated.
  - **`/.well-known/llms.txt` + `/.well-known/llms-full.txt`** aliases. These are ROOT paths, so
    they needed the same middleware bypass the Sentry tunnel gotcha is about — rewritten, they'd
    404 on every tenant host and work only on the apex.
  - **Discovery headers.** `X-Llms-Txt` + `Link: rel="alternate"` on every docs page response,
    attached in middleware (the page render never sees the pre-rewrite path).
  - **`.md` page twins (new surface).** Every page also serves its Markdown at `<path>.md`
    (`/index.md` for the index), which is what every link in the index now points at — an agent
    following one gets prose instead of a React render it has to strip. The route tree can't
    match on an extension, so `middleware.ts` maps `*.md` → `/api/page-md/*` in all four host
    classes (tenant subdomain, custom domain, apex path-mode, apex/preview).
  - **Access:** the bulk surfaces stay anonymous (a corpus dump must not leak gated bodies,
    §11.2), but a single page's `.md` honors the reader's real session — same rule as the HTML
    page, 404 for a gated page anonymously. Consequence worth remembering: that response
    **varies by reader**, so it's `private, no-store` whenever a reader cookie is present and
    publicly cacheable only for anonymous fetches. A blanket `s-maxage` there would have let a
    CDN hand a gated page to the next anonymous client — the §11.2 leak reintroduced one layer
    above the code that prevents it.
  - **Cost note:** the index now reads every page's frontmatter for its description. That's
    ~free — `buildNav` already loaded each page for its sidebar title and `loadPage` is
    request-cached — so the only real extra read is the index page, whose slug has two
    spellings. Both surfaces carry `s-maxage=3600` regardless, since they're crawled in bursts.
  - **The published CLI got all of it too**, which is why the generator lives in
    `packages/renderer/lib/` (`llms.ts`, `llms-format.ts`, `llms-discovery.ts`, `page-md.ts`)
    rather than the web app: `apps/cli` has its own route tree (§10.6), so a surface that
    exists only in `src/app/` doesn't exist for `npx papervine`. Before the move it would have
    shipped an index whose every link 404'd — the CLI's `.md` mapping is in *its* middleware,
    and an index full of dead links still looks perfect. The web app keeps the multi-tenant
    wrapper (tenant resolution, reader access, analytics, caching); the CLI's
    `apps/cli/src/lib/llms-handlers.ts` is the same three absences the MCP route documents (one
    repo, one reader, no analytics). Pinned in the clean room (`npm run test:cli`), which
    *follows a link out of the index* rather than guessing a path — the only layer where "the
    module resolved outside the monorepo" and "the middleware shipped" are actually tested.
  - Layers: pure format core in `packages/renderer/lib/llms-format.ts`
    (`tests/unit/llms-format.test.ts`, 24 tests — heading nesting, truncation, spec scanning,
    section order); wiring + filters + `.md` routing in smoke (5 new checks, plus a
    `llms-noindex` fixture that is *in* the nav and must stay out of the feed); packaging in
    `test:cli`. The existing `docs-tools-access.test.ts` gated-corpus test carried over
    unchanged, which is the point of it.
- ✅ **Per-page actions control (2026-08-27):** `.md` twins and `/llms.txt` served agents but
  nothing served the *reader* holding an AI tool — the person whose next move is "paste this
  page into a chat". Every docs page now carries a split button at the top of the article
  (`packages/renderer/components/PageActions.tsx`): **Copy page** as the primary action, with
  **Ask Assistant** and **Download PDF** in a menu.
  - **Each action reuses something that already exists rather than adding a pipeline.** Copy
    fetches the page's own `.md` twin — one definition of "this page as Markdown", so the
    clipboard can't drift from what an agent fetches, and being same-origin the reader's
    session rides along so a gated page copies for the reader who can read it. Ask Assistant
    dispatches the same event the navbar button and Cmd-I use, and the assistant already sends
    the pathname as `pageSlug`, so "about this page" needs no argument. Download PDF opens the
    print dialog — the same trade §10.4's whole-site export makes (full renderer fidelity, no
    server-side PDF pipeline), which is also why it works identically on the CLI.
  - **The print stylesheet is the actually-new part.** Printing any docs page used to carry the
    navbar, tab bar, and sidebar onto the paper. `pv-no-print` now sits on the five *shared*
    chrome components (Navbar, NavTabs, Sidebar, Banner, TableOfContents) — shared is what
    makes one class cover all three surfaces — and the rules ship inside `PageActions` rather
    than in a `globals.css`, because there are two of those and Tailwind's purge can't see a
    class that only appears inside `@media print`.
  - **Placement:** the control is a sibling above `<article>`, not its first child. `prose`
    styles the article's first child, and a control there fights those rules for margins. The
    row keeps `ARTICLE_ROW`'s `min-h-screen` (the sticky-sidebar invariant), and the
    short-page layout e2e still passes — that was the thing most at risk from restructuring it.
  - **The assistant item follows the §8.6 kill switch** (and `aiConfigured()` on the CLI):
    offering it where the panel isn't mounted would reproduce the original bug of a button
    dispatching an event nobody listens for. Generated OpenAPI endpoint pages get no control —
    they have no `.md` twin, so every action would be a dead button.
  - Layers: smoke asserts the control renders with the *right* `.md` href (built from the slug
    plus the site's base path — exactly the shape that renders as `/.md` with nothing failing)
    plus the print CSS; e2e (`tenant-render.spec.ts`) drives the menu in a real browser —
    open/Escape/copy, clipboard contents are Markdown and not HTML, the kill switch hides the
    assistant item, **and the console stays clean**, this being the docs' first interactive
    popover.
- ⏳ **Next:** `/_llms/` split indexes for very large sites (deliberately deferred — nothing
  truncates today, a big site just gets a big file); `docs.json` opt-out + per-tenant rate
  limits; live API execution as MCP tools (depends on the M4 "Try it" auth/proxy slice); index
  built at sync (M2).

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

> **Status 2026-08-23 — the nav tree can add structure, not just navigate it.** Each group row
> gets a **+** (`NavAddMenu`) beside its settings cog: **New page** (creates the file *and* lists
> it), **Add existing page** (a submenu of page files the navigation doesn't reference — computed
> client-side from the `slugs` + `sections` the server already sends, so no extra round trip), and
> **New group**. Both halves of a new page — the MDX file and the `docs.json` entry — land in the
> **same draft session**, so it publishes and reverts as one unit. The mutations are pure
> (`src/lib/nav-edit.ts`, 24 unit tests) and the actions are read → mutate → `saveDraft`, matching
> `saveGroupSettingsAction`; the page file is written *before* `docs.json`, the same ordering
> native publish uses, so a nav entry never points at a file that doesn't exist yet.
>
> The reveal rule matches the cog: `[@media(hover:hover)]:` so it's always visible on touch.
> Menu surfaces are `bg-[var(--option-bg)]`, not `db-glass` — glass is 60% + blur ("frosted
> sticky chrome" per its own definition), which let page text read straight through the items;
> `popover.tsx` had already made that call and menus now follow it, so every popup surface in the
> platform is the same opaque token.
>
> Two spellings of the index page cost a bug here: `listPageSlugs()` reports it as `""` (route
> `/`) while `docs.json` says `"index"` and `buildNav` emits `/index`, so a raw-string diff of
> "files" against "in the nav" found it in neither and offered it as an **unlabelled row** — on a
> site where everything else was listed, that blank row *was* the whole "Add existing page"
> submenu, which is what "empty submenu" turned out to be. `canonicalSlug` / `unlistedPageSlugs`
> now reconcile both sides, and `addPageToGroup` writes the canonical form (an empty nav entry
> resolves to nothing). Also in AGENTS.md — anything diffing nav hrefs against page slugs hits it.
>
> **The non-obvious part: `buildNav` deliberately prunes empty groups**, because a group whose
> every page is reader-auth-gated must not render as a bare label advertising content you can't
> reach (§11.2). That's exactly right for readers and exactly wrong for the *editor*, where the
> tree is the authoring surface for the structure itself — a group you just created is empty by
> definition, so "New group" appeared to do nothing and there was no way to see or fill it. Fixed
> with an `includeEmpty` opt, symmetrical to the existing `includeHidden` the editor already
> passes: readers keep the prune, the editor sees what's authored. It applies at both levels
> (group and tab) and the recursion means a parent whose only child group is empty survives too.
> `tests/unit/nav-include-empty.test.ts` pins both directions, including that a
> fully-gated group is *still* dropped for a reader who lacks the group — the flag must never
> become a way to leak structure.
>
> **New tab** landed too, and it is NOT an append — `tabs` and top-level `groups` are
> *alternative* structures, not siblings (confirmed against the docs.json JSON Schema, and
> `buildNav` takes one branch or the other). So on a tab-less site `addTab` **converts**: every
> root container (`groups`/`pages`/`anchors`/`dropdowns`) moves into an implicit first tab named
> `Documentation`, and the new tab is appended beside it. A naive `tabs = [newTab]` would have
> made every existing group silently vanish from the rendered site — buildNav would simply stop
> reading the root. Two details that are easy to get wrong and are pinned by tests: the
> duplicate-name refusal happens **before** the move (bailing halfway would delete the root
> containers without writing any tabs — i.e. wipe the navigation), and the containers are *moved,
> not copied*, so no ignored-but-present duplicate lingers for a later edit to touch. The action
> returns `converted` and both the dialog and the toast say what happened, rather than silently
> restructuring someone's navigation. This is also the first thing `includeEmpty` pays for
> twice — a brand-new tab has no pages, so without it the tab wouldn't appear either.
>
> **Drag-and-drop reorganizing (2026-08-23).** Rows carry a grip: a page reorders within its
> group or moves to another; a group slides among its siblings. `@dnd-kit/core` + `sortable` +
> `modifiers` (new deps) — chosen over HTML5 drag events, which have no touch support, and over a
> whole-row drag, which fights both tree scrolling on touch and the click that opens a page. The
> grip is a real `<button>`, so keyboard dragging works for free (Space, arrows, Space).
>
> Pages are addressed **positionally** (`{group, index}`), not by slug — the same slug may
> legitimately appear in two groups, and the row you grabbed is the one that should move. The
> mutators splice the entry out and back in rather than reading it as a string, so object entries
> (an OpenAPI selector, a page with its own `href`) survive the trip.
>
> **Optimistic, via `useOptimistic` (revised 2026-08-23).** The first cut deliberately wasn't:
> the tree is the server's view of `docs.json`, so it awaited the write plus a `router.refresh()`
> to avoid a UI that could disagree with the file. Wrong trade — during that round trip the row
> springs back to where it came from and then jumps to its new home, which is worse than the
> risk. The move now applies locally the instant you drop (`nav-tree-move.ts` — the same move in
> the BUILT `NavSection[]` shape, with index semantics deliberately identical to nav-edit's, or
> the row would land in one slot and settle in another). Measured: new order visible **38ms**
> after mouse-up, and no spring-back at any sample out to 3.2s — because `router.refresh()` runs
> INSIDE the transition, React holds the optimistic value until the refreshed RSC payload has
> arrived. The original concern is answered by the revert rather than by refusing to be
> optimistic: on error we simply don't refresh, the transition ends, and React discards the
> optimistic value — verified by aborting the action's POST (identified by its `Next-Action`
> header; aborting *every* POST kills the RSC payload and unmounts the tree instead of testing
> anything). That test also found a real gap: an aborted action REJECTS rather than returning
> `{error}`, so the move calls are now wrapped — a dropped connection gets a toast instead of an
> unhandled rejection.
>
> Three things this cost, all invisible except in the console or a second run:
> 1. **`closestCenter` is type-blind.** Pages and groups share one `DndContext` and page rows are
>    dense, so a dragged group resolved onto the nearest *page* and the drop was silently
>    ignored — no error, no movement. `sameKindCollision` filters candidates to the dragged kind
>    first. A dragged page still accepts both, since dropping on a group row is the only way into
>    a group with no pages.
> 2. **dnd-kit's a11y description id is a module counter**, so server and client disagreed
>    (`DndDescribedBy-0` vs `-1`) — a hydration mismatch visible ONLY in the console. Fixed with a
>    stable `useId()` passed as `DndContext id`.
> 3. Reordering an **empty** group needed `includeEmpty` (above) to be visible at all.
>
> **Full-site draft preview (2026-08-23).** `/preview/{org}/{site}/site/[[...path]]` renders the
> whole site — navbar, tabs, sidebar, search — from the draft, reusing `TenantDocsShell` +
> `TenantDocsArticle` so it is the real renderer, not a second implementation. The editor toolbar
> gets a **Preview** button (a plain `target="_blank"` anchor: a new tab is a hard navigation, so
> it carries the app-host rewrite a soft nav would skip). Sibling of the pre-existing
> `/preview/{org}/{site}`, which renders one article with no chrome for the in-pane iframe —
> "is this page right?" vs "is the *site* right?".
>
> The load-bearing detail: **a draft nav must never be cached.** `buildNavCached`'s key is
> `sha:updatedAt`, neither of which a draft changes — so a cached draft nav would be served to
> readers of the *published* site. `buildNavCached` now takes `draftBranch` and skips
> `unstable_cache` entirely when set, matching how `draftSource` reads live everywhere else. The
> preview also skips `requireReaderForPage` and the `canAccess` filter (`showGated`), because the
> route is already gated to an org member with editor access and bouncing them to the *tenant's*
> reader login is a dead end from inside the dashboard.
>
> **Still not built:** anchors and dropdowns, whose schema *requires* an `href` on each entry —
> so they need a URL field, not just a name, which is a different form rather than a fourth line
> in this dialog. And languages / versions / products, which wrap or duplicate a whole content
> tree rather than adding an item to one. Those belong in a structural `docs.json` editor.

> **Status 2026-08-23 — Studio is usable on a phone.** `EditorShell` had **one** responsive
> class in the whole file, and its two side panels were in-flow fixed-width columns
> (`w-80` agent, `w-64` tree) at every viewport. Measured at 390×844: the tree left the editor
> **38px**, one character per line, with Publish overflowing off-screen — the panel was
> literally in the way of the thing it navigates. Below `lg` both panels are now off-canvas
> overlays (`fixed` + a tap-to-dismiss backdrop) and in-flow columns from `lg` up, so the
> editor keeps the full width (**294px** of 390, no horizontal overflow) and desktop is
> byte-identical (tree 256px `static`, editor 833px — verified in both).
>
> Two decisions worth keeping. **The breakpoint split is CSS, not JS**: reading the viewport
> during render is a hydration mismatch, so the drawer gets its *own* `mobileTreeOpen` state
> while `treeOpen` keeps meaning "the desktop column is open" — one state couldn't serve both,
> because `treeOpen` defaults open and would put a drawer over the editor on arrival. The
> handlers *do* consult `matchMedia` (`toggleTree`), which is safe: they only run after
> hydration. And **picking a page closes the drawer** (`selectPage`) — leaving it open hides
> the page you just chose, which is the same "in the way" bug in miniature.
>
> **Hover-only controls are a touch dead end.** The per-file revert in the Publish panel and the
> nav tree's settings cog were both unconditionally `opacity-0 group-hover:opacity-100`, so on a
> phone they were invisible *and* unreachable — Page/Group settings had no entry point at all.
> Both now hide-on-hover only where hover exists (`[@media(hover:hover)]:`), keyed on the
> **capability rather than a width breakpoint**: a touch laptop at desktop width has the identical
> problem, so a `lg:` gate would have fixed the phone and left that broken. Both also gained
> `focus-visible:opacity-100` — on a hover device they were invisible *while keyboard-focused*.
> The revert's tap target goes 22px → 30px on touch, capped at roughly the row height on purpose:
> a target large enough to overlap the neighbouring row's revert would let a mis-tap revert the
> wrong file. The e2e for this runs with `hasTouch`/`isMobile`, not merely a narrow viewport — a
> small desktop window still reports hover support, so a viewport-only test would pass while a
> real phone stayed broken, and the spec asserts `matchMedia("(hover: hover)")` is false before
> trusting its own assertions.
>
> Found while verifying it: `CardGroup`/`Columns` set `grid-template-columns` as an **inline
> style**, which no media query can reach, so `cols={2}` stayed two columns at 390px and
> wrapped card headings mid-word. That's a **reader-facing renderer bug on every phone**, not
> an editor one — and `docs/rendering/components.mdx` had been promising a grid "that reflows on
> small screens" all along. Fixed in both the renderer (`Card.tsx`) and the Visual editor's
> mirror of it (`NodeViews.tsx`) by passing the count as a CSS variable and letting a
> breakpoint variant apply it (`grid-cols-1 sm:grid-cols-[repeat(var(--pv-cols),…)]`) — a
> variant can't interpolate a runtime value, and an inline style can't hold a breakpoint, so
> the variable is what bridges them. Measured: 1 track at 390px, 2 at 1440px.

> **Status 2026-08-21 — the authoring layer is source-aware.** `publishDraft` now dispatches on
> `site.source_kind` (§10.11): a Git site commits or opens a PR exactly as before, a
> Papervine-hosted site writes its drafts straight to object storage (`native-publish.ts`) with
> no GitHub credentials anywhere in the path. Everything *around* publish is unchanged and
> source-agnostic by construction — the draft buffer, the change list, per-file revert, and
> discard are pure Postgres + storage and needed no branching at all, which is the payoff of
> §9.2's "one backend, two front-ends" split. `checkoutBranch` skips its `getRef` base-head
> stamp on a hosted site (nothing to diverge from, and no repo to read a head from), and the
> agent's toolset drops `list_branches` and loses the PR mode from `publish`'s input schema, so
> the model is never offered a capability the site doesn't have. Editor chrome follows: no
> branch switcher and a single **Publish** action (`publishModeFor` → `'native'`).
>
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
> publish stacks on top and re-publishing is idempotent. (Surfaced on a customer's monorepo; the
> earlier `createTree 403` / `createBranch 422` they hit were the App's missing Contents-write +
> repo rulesets, not this.) Guard: `tests/unit/authoring-publish.test.ts` asserts an existing-branch
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
> **Hosting decision (2026-07-07): run Hocuspocus ourselves, not a managed Yjs SaaS.** The service is
> one MIT container (`docker-compose` `collab` locally; a `$5` Fly/Railway/Render machine or any
> container host in prod; `crossws` makes it portable to Bun/Deno/CF Workers). We considered the
> Vercel Marketplace one-click partner **Liveblocks** (fully-managed Yjs) and rejected it *as the
> default* for a decisive reason: **Liveblocks has no option to run it yourself**, so collab-on-
> Liveblocks would break running Papervine's collab feature outside a hosted SaaS (§13). A managed
> Yjs host (Liveblocks / y-sweet) stays a valid *optional hosted-tier* choice behind the same
> provider seam — never the foundation. This is a different problem from the Activity feed's
> Pusher/Soketi choice (§10.3): that relays content-free pings; a document needs stateful sync
> (correct join-state, awareness, and state transfer that would blow past Pusher's ~10KB message
> cap — which *diverges* between hosted Pusher and a Soketi instance we run ourselves), so a
> purpose-built Yjs server is the right tool here. **Deferred:** binary CRDT
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
> **Links in the Visual editor follow *inside* the editor (2026-08-09).** Bug: clicking any link
> in Visual mode left the editor for a 404. The editor is a control-plane surface on the **app
> host**, so a docs link (`/quickstart`, or a `<Card href>` — the node views render the real
> components, and `Card` is a real `next/link`) resolved against `app.papervine.io/quickstart`.
> next/link made it *worse* than a plain anchor: contenteditable normally suppresses link
> following, so the router's soft-navigation was the thing actually destroying the editing
> session. Fix: a **capture-phase click handler on the editor root** (beats the component's own
> `<Link>`; `preventDefault` alone is enough for next/link, which bails on a default-prevented
> click) routing every link through the pure **`resolveEditorLink`** (`src/lib/editor-link.ts`):
> a page in this site → `loadPage` (the nav-click path, so the pending edit flushes first);
> external/`mailto:`/protocol-relative → a new tab; a bare `#hash` → nothing; an in-site path
> with no page → a toast naming the broken link. Slug resolution mirrors the renderer's —
> root-absolute *and* relative to the current page's folder, `?`/`#`/`.mdx` stripped, root page
> is slug `""` — so the editor agrees with what a reader gets, and a link that 404s live reads as
> broken here too. **The one exception is load-bearing:** a `<Card href>` wraps its *editable body*
> in the `<a>`, so a click landing inside the node view's content hole places the caret instead
> (⌘/Ctrl overrides); everything else on the card navigates. Middle-click is routed the same way
> rather than opening the wrong host in a new tab. Also removed a **duplicate `<Toaster/>`** in
> `EditorShell` (the `app/[org]` layout already mounts one) — every editor toast was rendering
> twice. Guards: `editor-link.test.ts` (9) + two `editor.spec.ts` e2e (follow a link / still click
> into a card's body). Verified in a real browser against the seeded `starter` site.
>
> Token-scoped *external* auth for the authoring MCP (a platform-auth PAT, §11) is the
> follow-up; today it authenticates via the app-host session + `x-papervine-org/site` headers.
>
> **Publish panel: a file-changes list + revert, all or one (2026-08-09).** the incumbent's own
> Publish dropdown lists every changed file with a per-file revert icon; ours only offered
> "Open a pull request" / "Commit to the deploy branch," with no way to see or undo individual
> changes short of publishing them. `discardSessionAction` (whole-session discard) already
> existed in `src/lib/actions/authoring.ts` but had no UI caller — this gave it one, alongside
> the missing per-file primitive. New: `listSessionChanges`/`revertDraftFile`
> (`authoring-core.ts`) classify each draft file against the published S3 content
> (added/modified/deleted, parallelized — each check is an S3 round trip) and delete a single
> draft row (letting the base content, or its absence, show through again); `deleteDraftFile`
> (`draft-store.ts`) is the new per-file primitive discard never needed. `PublishButton`'s
> dropdown is now a real panel: "N file changes" (or "No changes yet," publish buttons
> disabled), one row per file with a hover-revealed `RotateCcw` revert icon (mirrors
> `NavTree.tsx`'s existing hover-icon convention), and a "Discard all changes" row below —
> gated by `window.confirm(...)`, matching this editor's own existing destructive-action
> pattern (`PageSettings`/`GroupSettings`'s page/group delete), not the heavier shadcn
> `AlertDialog`. A real setState-during-render bug surfaced during development (`setOpen`'s
> updater callback also called `setLoadingChanges` — React's own "Cannot update a component
> while rendering a different component" warning caught it) — fixed by reading `open` directly
> instead of through the updater. `MdxEditorHandle` gained `cancel()` (drop a pending debounced
> autosave without persisting it) alongside `flush()`, called before a revert of the
> currently-open file (path-guarded — canceling unconditionally would drop an unrelated
> in-progress edit) or unconditionally before discard-all. **Discard is a soft close, not a
> delete** — `discardSession` only flips `editorSession.status` to `'discarded'`; its
> `draftFile` rows stay in Postgres, just unreachable via `findOpenSession` (a stale comment
> claimed "FK cascade drops the draftFiles" — that cascade is real but only fires when the
> *site* itself is deleted, never on a status flip; fixed the comment). This tripped up the
> new e2e spec before the fix: an unscoped `count(*)` across all of a test site's sessions
> never reached zero after a discard, since the *previous* test's now-discarded session's rows
> were still physically present — scoping every count to `status = 'open'` (matching what the
> app itself queries) fixed it. Covered by two new `tests/e2e/editor.spec.ts` cases (list +
> revert one file; edit two pages, discard all, confirm both the DB and the open pane's content
> reflect it) plus the file's existing console-clean assertion pattern.
>
> **Fixed a real double-seed race — two clients joining an empty room at once could double
> page content (2026-08-09).** User-reported: two editor sessions open on the same page,
> pressing Revert in one "doubled the content... as if two saves got appended to each other."
> Root cause, confirmed by reading both transports and `@hocuspocus/provider`'s own source, not
> guessed: the "first client seeds the room from the page's saved text" decision
> (`useCollabDoc.ts`'s `onSynced`: `if (ytext.length === 0 && initialRef.current) { ...insert...
> }`) was made independently by each client with no coordination. Two clients racing to join a
> genuinely empty room (a first-ever open, or — what the Publish panel's revert above made much
> easier to trigger — a `docKey`-forced remount rejoining fresh) could each conclude "nobody's
> here" and each insert a full copy of the text; Yjs merges two independent inserts as two
> concatenated copies, not a dedup. Not `BroadcastProvider`-specific: `apps/collab/src/server.ts`
> has the identical pattern server-side, and `HocuspocusProvider`'s `synced` fires purely off the
> client↔server handshake with zero peer-count signal at that moment — the real cross-machine
> service has the same exposure, just not what surfaced this (no `COLLAB_JWT_SECRET` configured
> where it was hit). **Fix: a deterministic tiebreak — lowest `clientID` seeds, everyone else
> defers** (a standard leader-election pattern, generalizes past two racers). Each transport
> gained `canSeed(): Promise<boolean>` using whichever peer-discovery signal it already has:
> `BroadcastProvider` tracks the lowest peer id seen via the existing hello/state handshake
> (**a real protocol gap found writing the regression test**: the original `"state"` reply
> carried no `from` field, so a client that only learns of a pre-existing peer through receiving
> *their* state reply — never a fresh "hello" from them, since they were already there — never
> saw that peer's id at all; added `from` to the `"state"` message and update the same tracker
> from both message types now); `HocuspocusTransport` compares `awareness.clientID` against
> every other key in `awareness.getStates()` (reliably populated by the time a short window
> elapses, since `useCollabDoc`'s `wire()` already calls `setPresence` immediately on
> construction, before `onSynced` ever fires). `canSeed()` only adds latency to the genuinely
> ambiguous case — for an already-settled room, a peer's real content is applied *before*
> `markSynced()` fires, so `ytext.length === 0` is already false and `canSeed()` is never even
> called. Pure comparison core (`isLowestClientId`) lives in `peer-roster.ts` so both
> transports share one tested implementation. Guards: `collab-seed-race.test.ts` — two and
> three simultaneous joiners (only the lowest id seeds, never both/none), a lone joiner
> (unaffected), and the pure comparison function directly (no real `@hocuspocus/provider`/server
> needed for that part). **Scope note:** this fixes the race in an *empty* room only — a peer
> who already has a page open when someone else reverts still doesn't learn about the revert
> (their live, already-settled Y.Text is untouched by a revert, which only deletes the Postgres
> draft row); that's a separate, still-open gap, not addressed here.
>
> **That "still-open gap" turned out to make Revert itself broken, plus a separate presence
> leak (2026-08-09).** User-reported immediately after the fix above shipped: with two sessions
> open on the same page, Revert stopped reverting at all, and the collaborator count only ever
> grew. Two distinct, real bugs, confirmed by reading the code (not guessed):
>
> 1. **Revert relied on the exact race it just closed.** The Publish panel's revert/discard
>    (built above) drives a page refresh through `docKey` — a full remount that tears down and
>    rejoins the page's collab room from scratch. If a peer still has that room open, the fresh
>    rejoin finds it *non-empty* (the peer's stale, pre-revert content answers the join
>    handshake), so `ytext.length === 0` is false and the reverted text is never seeded — the
>    room keeps the peer's stale content forever, visible even to the tab that clicked Revert.
>    Worse, `onChanged` fired unconditionally on **every** revert regardless of which file it
>    targeted, so *any* revert click forced this teardown/rejoin cycle on whatever page happened
>    to be open. **Fix: stop remounting for this.** Revert/discard now call a new
>    `MdxEditorHandle.revertTo(next)` that pushes the fresh content straight into the *live*
>    `Y.Text` via the same `binding.setText()` path a normal keystroke uses — an ordinary
>    incremental CRDT update, not a reseed, so it has no room-emptiness ambiguity and broadcasts
>    to any peer with the room open (closing the "still-open gap" noted above as a side effect).
>    `PublishButton`'s `onChanged` now passes the affected path(s); `EditorShell` only touches
>    the live pane when one of them is the page currently open, refetching that page's post-
>    revert content and calling `revertTo` — never a docKey bump.
> 2. **`BroadcastProvider.destroy()` never actually announced a peer leaving.** It set
>    `destroyed = true` *before* posting the presence-leave message, but `post()` refuses to
>    send once `destroyed` is true — so the leave was silently swallowed on every teardown (tab
>    close, page nav, branch switch, and, until fix #1 above, every revert). Every peer's roster
>    could only grow. Fix: send the leave post first, flip the flag after. Regression test
>    (`collab-broadcast.test.ts`) constructs two providers, destroys one, and asserts the other's
>    roster drops to empty — confirmed it fails against the old ordering (peer never removed)
>    before the fix and passes after.
>
> **A separate, unrelated bug surfaced while verifying the above: any edit could 500 forever
> after the branch's first publish or discard (2026-08-09).** `editor_session` had a *full-table*
> unique index on `(site_id, branch)`, but `closeSession` never deletes a row — publish/discard
> are soft status flips (see the earlier fixed-comment note above). So the very first time a
> branch's session was published or discarded, its row stayed forever, and every later
> `checkoutBranch` on that same branch (every deploy-branch direct-commit reuses the same branch
> name every time) hit a duplicate-key 500 trying to insert a new one — permanently, not a
> transient race. The index's own comment already documented the intent ("one **open** session
> per branch") that the implementation didn't match. **Fix:** made the index partial
> (`WHERE status = 'open'`, migration `0022_closed_hemingway.sql`) — closed rows no longer block
> a fresh checkout, while two concurrently-open sessions for the same branch are still prevented.
> That partial index reintroduces a narrower, expected race (two truly simultaneous checkouts of
> a never-before-opened branch), so `createSession` now catches that specific constraint
> violation and hands back the winner's row via `findOpenSession` instead of throwing. Guards:
> `draft-store-session-race.test.ts` (mocked DB — the no-conflict path, the race fallback, and
> that an unrelated unique-violation or non-DB error still propagates) plus a manual run against
> real local Postgres reproducing the exact sequence (create → publish → create again for the
> same branch) to confirm the live fix, not just the mock.
>
> **`<Tabs>` is a real tab strip in Visual mode (2026-08-24).** Tabs and CodeGroup were the two
> components deliberately left as *labelled chrome* (a bordered box with attr badges) because they
> "pick apart their children structurally" and ProseMirror gives a node view exactly **one**
> content hole — you can't split one hole into per-tab panes. `<Tabs>` now gets the strip anyway:
> the parent renders the tab bar, still emits one hole containing every `<Tab>`, and **hides the
> inactive panes in CSS** via a `<style>` scoped to that instance. Declarative, so it survives
> ProseMirror re-rendering its children (an effect toggling classes would not), and the active
> index is React view state — never in the doc, so typing, undo and the collab sync are untouched.
> Click to switch, double-click to rename, `+` appends, `×` removes the active tab (never the
> last one), and a **grip above each tab** reorders via dnd-kit — each mutating through a real
> ProseMirror transaction so it round-trips to MDX and is undoable. A dedicated handle rather than
> a draggable label, for `NavTree`'s reason: a distance-activated drag on the label competes with
> the click that selects and the double-click that renames. It reuses that file's affordance rule
> verbatim — `[@media(hover:hover)]` reveal-on-hover, always visible where hover doesn't exist,
> `focus-visible` for the keyboard — and toggles opacity rather than display so the strip never
> shifts. The position arithmetic lives in a pure
> `visual/tabs-plan.ts` (`insertTargetForMove` / `activeAfterRemove` / `hiddenPaneRule`, 11 unit
> tests) following the `caret-plan.ts` precedent.
>
> Three things the browser found that reading the code would not have. **(1) The selector needs
> every hop spelled out**: TipTap inserts a `[data-node-view-content-react]` element between a
> React node view's hole and its child views (the same wrapper `.pv-cardgrid` flattens) **and**
> wraps each child view in a `.react-renderer` div — so the element that takes `display: none` is
> the *wrapper*, and a rule targeting the pane itself hid nothing. **(2) `useId()` is not unique
> across node views.** TipTap mounts each one in its own React root and `useId()` restarts its
> counter per root, so every `<Tabs>` on a page got `":r0:"`, their scoped rules matched each
> other's panes, and between them they hid *every* tab — a module counter replaces it (node views
> are browser-only, so there's no SSR sequence to match). This is the opposite lesson from the
> `NavTree` hydration fix, where `useId()` was the *cure*: it's right for one SSR'd React tree,
> wrong for N client-only roots. **(3) The compact MDX form doesn't produce `tab` nodes.** MDX
> parses `<Tab title="npm">…</Tab>` with its body on the same line as *inline* JSX inside a
> paragraph, so the converter yields `mdxUnknownText` atoms — and that's what real repos write,
> including our own starter. Rather than normalize on load (which would reformat every compact
> Tabs block on round-trip and break the fidelity gate), the node view **falls back to the
> labelled chrome when it finds no `tab` children**, so that shape is exactly as good as before
> and never renders an empty tab bar over content that's still there. Making the converter lift
> inline `<Tab>`s into real nodes is the open follow-up; it's the only thing standing between
> this strip and every existing Tabs block. Verified in a real browser end to end (insert via
> `/tabs` → switch → type → add → drag → rename → remove → serialize), console clean, both
> platform themes.
>
> **Select All is scoped to the component you're in (2026-08-25).** Fell out of the strip above,
> and it's the more consequential half. ProseMirror's default `Mod-a` selects the whole document;
> measured in a browser with the caret inside a `<Tab>`, that highlighted **604 characters — the
> entire page, including the hidden panes** — so Select-All-then-type silently replaced content
> the user couldn't see. `visual/select-all-scope.ts` makes `Mod-a` select the enclosing component
> node's content first and **widen one level per further press** (tab → tabs → … → document), so
> the built-in behavior is never taken away, just no longer first. Progressive rather than a hard
> override because the alternative is stealing a shortcut people rely on. The rule is one line and
> pure — `nextSelectAllRange` (`visual/select-all-plan.ts`, 8 tests): *the innermost container that
> **strictly** contains the current selection*. Strictly, because equality is what makes a second
> press widen instead of re-selecting forever, and containment is what stops a selection already
> dragged across two tabs from being silently **shrunk** to whichever one the anchor sits in.
> Applies to every component node (derived from `COMPONENTS`, so a new component is scopable with
> no second list) and deliberately not to lists, blockquotes or table cells — whole-document is
> the standard editor behavior there, and nothing in them is hidden. Two implementation notes:
> candidates are normalized through `TextSelection.between` before comparing, since a node's raw
> content bounds aren't always valid text positions *and* the normalized range is what the previous
> press left behind (compare anything else and widening never fires); and the handler returns
> `false` rather than swallowing the key, which is what lets the base keymap's `selectAll` run.
> The bubble toolbar needed no change — it already showed for the selection; it now shows for the
> right one. Guard: a new `editor.spec.ts` case (pane switching, one grip per tab, `ControlOrMeta+a`
> selects only the active pane's text, toolbar visible) carrying the file's console-clean assertion,
> reached via the editor's `?slug=` param rather than a nav click.
>
> **`<Steps>` gets an "add a step" control on its rail (2026-08-25).** Unlike Tabs, Steps already
> rendered correctly in Visual mode — it's in `editorComponents`, its CSS counter survives the
> extra wrapper TipTap inserts, and the numbered badges land on the rail — so this is purely the
> missing affordance: a `+` at the end of the rail, where the next number would be. Clicking it
> appends a `step` and **puts the caret in its body**, so the click is immediately followed by
> typing rather than by hunting for where to type. The `+` is rendered as a **child of `<Steps>`,
> alongside the content hole**, not as a sibling: the badges are absolutely positioned against the
> rail the component itself draws (`border-l` inset by its own margin/padding), so a child inherits
> that geometry and centres on the line, while anything outside would have to re-derive the offsets
> and drift the day the component's styling changes. A useful side effect — the button row becomes
> the container's last child, so the last real step stops matching `last:mb-0` and gets its margin
> back, which is exactly the gap you want above the button. `Steps` is now re-exported by name from
> `editor-registry.tsx` for this, following the `Mermaid` precedent.
>
> The new step is created with **no `title`**: the attr defaults to null and serializes away, so an
> unnamed step round-trips as `<Step>` rather than a `title=""` someone has to clean up — verified
> against the real draft row.
>
> **A step is two slots, and the title one is real (2026-08-25).** Shipping the `+` alone was the
> wrong call and the user said so immediately: a step you can add but not *name* isn't an editable
> step, because the title is an **attr** and attrs weren't editable in Visual mode. `Step` now has
> its own node view with a permanent title field above its content hole — an untitled step shows a
> muted "Step title" prompt rather than nothing, so the slot is discoverable instead of implied.
> `+` focuses that field (via `view.nodeDOM(at)`, addressing the inserted node rather than guessing
> that the last input on the page is the right one), and Enter crosses into the body, so the whole
> gesture is click → name → Enter → describe.
>
> Two things make it work. **The control is passed INTO the real component, not around it**: `Step`'s
> `title` prop is now `ReactNode` (from MDX it's always a string), so the input renders inside the
> component's own `<h3>` and inherits its styling — the same reasoning as the `+` living inside
> `<Steps>`. Copying the classes into the node view would have drifted the day either is restyled.
> And **the attr commits on every keystroke, not on blur**, so the title reaches the autosaved draft
> even if the page is switched mid-word. That's the move that looks risky and isn't: an attrs-only
> change lets TipTap `update()` the existing node view instead of recreating it, so the input keeps
> its DOM node and caret, and `setNodeMarkup` moves no selection. Pinned by typing a whole word and
> then appending to it — a lost caret shows up as a scrambled value on the *next* keystroke, which
> a single-character test would miss entirely. Empty commits back to `null`, so clearing a title
> removes the attribute rather than leaving `title=""`.
>
> Guard: the `editor.spec.ts` Steps case now covers the button being centred on the rail within 2px
> of a badge (the assertion that catches geometry drift) and below the last step, focus landing on
> the new step's title, a multi-character title surviving, and Enter reaching the body — plus the
> file's console-clean assertion. Verified in a browser both ways, both platform themes, with the
> serialized MDX read back from the draft row.
>
> **Video and embeds — and a purged-CSS bug found on the way in (2026-08-25).** Asked for "a video
> component," and the first thing to check was whether there should be one: the docs.json-compatible
> schema has **no video component**. Its own guidance is
> `<video controls className="w-full aspect-video rounded-xl" src="…">` and the equivalent iframe.
> So building a `<Video>` would have created a page that only renders here — against the no-lock-in
> posture — for no compatibility gain. We emit exactly the documented raw HTML instead, which the
> converter already keeps as an opaque block: verified byte-exact round-trip for the self-closing
> form, the `<source>`-list form, iframes, and inside `<Frame>`.
>
> **The real bug was in CSS, and nothing about video would have found it.** `aspect-video` appears
> nowhere in our own source, and Tailwind can only scan source — tenant MDX is fetched from Git or
> object storage at request time. So the documented markup arrived with **no aspect ratio**: an
> iframe fell back to the 150px intrinsic default. Measured against the served stylesheet rather
> than inferred: `aspect-video`, `h-96` and `object-cover` were absent, while `w-full` and
> `rounded-xl` survived *only because our own UI happens to use them* — which media classes worked
> was an accident. `tailwind.config.ts` now safelists the media set, and `tests/smoke.mjs` fetches
> the stylesheet the page links and fails if any are purged. That check is the point: the page HTML
> is byte-identical either way, so no page-content assertion can see this. Confirmed the guard fails
> without the safelist, then confirmed the fix by measuring a rendered iframe — 833×469, ratio 1.778.
> Note one trap the guard also covers: `aspect-video` is currently kept alive a second time by the
> `MEDIA_CLASSES` string in `src/lib/media-embed.ts`, i.e. by exactly the accident being removed —
> move that constant and the class vanishes from the CSS while every page still asks for it.
>
> Editor side: **Video** and **Embed** join the existing Media group in the `/` menu. `/embed`
> resolves the share URL people actually paste into the framable one — every provider serves a
> different URL for framing, and a `youtube.com/watch?v=…` iframe renders a refusal — carrying a
> `?t=` timestamp across as `?start=` rather than dropping the one thing the author chose. And
> because raw HTML is an opaque block, video was the one content type you could put on a page and
> never see: the block atom node view now renders a live player for `<video>`/`<iframe>`, resolving
> a root-relative src through the tenant asset base (the editor is on the app host, so `/videos/…`
> would 404 — same fix as the image node view). `parseMediaElement` returns null for anything it
> can't render faithfully — a `<source>` list, a fallback message, an unsafe scheme — so the source
> box stays the fallback and the editor never shows a half-rendered player. `isSafeMediaUrl` gates
> the insert path to http(s)/protocol-relative/site-relative: not a security boundary (Source mode
> writes anything) but the one path where a *pasted* string becomes markup unread, and a
> `javascript:` iframe src would run for every reader.
>
> **Upload is deliberately not in this**, and it's the gap worth naming: the reference UX offers
> "Select video → Search / Upload", and we have neither, because there is no asset pipeline at all.
> `draft_file.content` is Postgres `text`, so a binary can't enter the draft buffer; publishing one
> would need new paths for both site kinds (base64 blob commit for Git-backed, storage copy for
> hosted), plus draft-asset serving and the `.dimensions.json` merge already flagged in §10.11.
> That's a subsystem, not a control. Guards: `media-embed.test.ts` (14 — every YouTube share shape,
> timestamp carry-through, refused schemes, quote escaping, and each shape `parseMediaElement`
> declines), a `media` smoke fixture, the stylesheet check, and an `editor.spec.ts` case for the
> live player, the resolved asset src, the source-box fallback, and `/embed`'s URL conversion. Two
> incidental notes from writing that spec: the fixture needs a **leading** paragraph, because every
> media block is a non-editable atom (nowhere to put a caret) and because the slash menu floats at
> the caret — with the caret at the end of a tall page the menu anchors off screen and the click
> never lands, which is the below-the-fold trap already in this file's gotcha list.
>
> **The `/` menu's keyboard navigation never worked — `configure()` deep-merges your ref away
> (2026-08-25).** Reported as "arrow keys should work within the menu, not close it," and the
> mechanism is worth writing down because nothing about it fails loudly. `SlashCommand` took a
> `keyHandlerRef: { current }` option that React wrote the open menu's key handler into. But
> `Extension.configure()` merges options with `mergeDeep`, which **recurses whenever the default
> and the supplied value are both plain objects** — and a React ref is exactly that. So the
> extension got a *copy*: it read `{ current: null }` forever while React wrote to the original.
> Nothing errored, nothing warned. Arrows fell through to ProseMirror, which moved the caret out of
> the `/query`, which deactivated the suggestion and closed the menu; Enter fell through too, so an
> item could only be chosen with the mouse — which is why the browser passes earlier in this
> session had to click menu items instead of pressing Enter, a symptom I worked around without
> recognizing. Measured, not guessed: a temporary probe in `onKeyDown` printed
> `handlerRegistered=false` while the menu was visible on screen.
>
> Fix: the option is a **function** (`onKeyDown(props): boolean`), read through the ref by the
> caller. A function is copied by reference and can't be re-broken this way — the same reason
> `CollabCarets` already takes `getAwareness()`, so SlashCommand was the outlier rather than the
> pattern. The ref callback also became a `useCallback` so React stops detaching and re-attaching
> the handle on every render of a menu that re-renders per keystroke.
>
> **The general rule: never hand a mutable handle to `configure()` — pass a getter.** Guards at two
> layers: `slash-command-options.test.ts` reproduces it with no browser at all (a function option
> arrives by identity; a plain-object one does not, and a *captured snapshot* of `options` — which
> is what `addProseMirrorPlugins` takes, once, at editor construction — never sees a later write),
> and an `editor.spec.ts` case for the journey (arrows move the highlight with the menu still open
> and the caret still in the query, Enter takes the arrowed-to item rather than the first, Escape
> closes without inserting). That spec gets **its own fixture page**: these specs share one
> Postgres in declaration order, and on a page an earlier test had typed into the assertions about
> what is and isn't in the document inherited someone else's draft — the order-dependence trap
> already in this file's gotcha list, hit twice in one session.
>
> **The media items get a real dialog (2026-08-25).** The `/video` and `/embed` items shipped with
> `window.prompt`, following the `image` item's lead — and the user's verdict on a native box in
> the middle of the editor was "looks horrific," which is right. Following an existing precedent
> was the wrong instinct: the precedent was itself the thing to fix, and `image` is converted too
> rather than left as the odd one out. New `MediaDialog` (shadcn `Dialog`, so it carries
> `db-portal` and resolves the platform palette outside the `.db` shell) shared by the slash menu
> and the `+` picker, with the copy for all three kinds as data in `MEDIA_INPUTS` so the menu item
> and the dialog can't drift into describing different things.
>
> Being a real dialog is what lets it *say* something, which a prompt never could: **Add** is
> disabled until `isSafeMediaUrl` passes, a rejected scheme explains itself inline instead of
> silently inserting nothing, and an embed **names the provider it recognised** before you commit —
> so a mistyped link is visible up front rather than after you look at the page. Enter submits, so
> it's still one gesture from the `/` menu.
>
> Two things the browser settled. Radix focuses the dialog content (or the close button) on open,
> which beats a plain `autoFocus` on the input — so it claims focus in `onOpenAutoFocus`, and the
> e2e asserts `toBeFocused()`, because the failure mode is swallowing the first keystroke of a
> paste. And the URL is re-validated inside `make()` rather than trusted from the dialog: `make` is
> also reachable from the `+` picker, and a check living in one caller is one refactor from gone.
> Threading it through took a small contract change — `SlashItem.input?: MediaInputKind` plus
> `make(value?)`, and a `requestInput` **function** on the slash options (a function, per the
> gotcha two notes up). Guards: a `MEDIA_INPUTS` meta test (every kind complete, submit labels
> distinct — the dialog reads every field, so a missing one renders a blank label rather than
> failing), and the e2e now drives the real dialog and **counts native prompts, asserting zero** —
> Playwright auto-dismisses a stray `window.prompt`, so its return would otherwise look like an
> insert that just didn't happen. Verified in both platform themes. Still no Upload control: there
> is no asset pipeline behind it, and a button that never works is worse than one that isn't there.
>
> **Media uploads — the asset pipeline (2026-08-25).** The gap named above, built. An upload is an
> **edit**: bytes land under `drafts/{sessionId}/`, a `draft_file` row records it, and it goes live
> only on Publish — so the change list, per-file revert and discard-all work on it with no idea
> that some changes are bytes.
>
> **Presigned PUT straight from the browser, not through us.** Necessary rather than tidy: a Route
> Handler on Vercel caps the request body at a few MB, which one video clears — so bytes uploaded
> *through* the app would fail at exactly the sizes this exists for. Three calls, in this order for
> a reason: `requestMediaUpload` validates and signs, the browser PUTs, `finalizeMediaUpload`
> confirms the object landed (`headObject`) before writing the row. Recording first would leave a
> phantom change for an upload that died halfway. The content type is **signed into** the URL, so
> a client can't upload one thing and have it served as another — an `.mp4` key served as
> `text/html` is XSS on the tenant's own domain. The extension allowlist, not the browser's
> reported MIME type, is what decides: the latter is client-supplied and often absent.
> Cost: the bucket needs CORS for the app's origin. MinIO allows any origin by default so dev is
> untouched; documented as a self-hosting note.
>
> **`draft_file.binary`** (migration `0024`) marks a row whose bytes are in storage and whose
> `content` is empty. Publish then differs per site kind: hosted gets a new `copies` bucket in
> `planNativePublish` — a server-side `copyObject`, the same object one prefix over, bytes never
> entering this process — and Git-backed reads the object and commits it as a **base64 blob**,
> because the tree API's inline `content` is text-only and passing raw bytes through it would
> *corrupt* the file rather than fail. Two deliberate refusals-to-write: the plan skips a binary
> row entirely without a sessionId (the source is unaddressable, and putting `content: ""` would
> replace a real video with a zero-byte file), and the git path skips a missing object rather than
> committing an empty one.
>
> **Serving the draft copy is one route, split by authorization, not by URL.** Studio renders the
> tenant's real MDX, so it asks for `/api/tenant-asset/{slug}/…` like a reader does — an editor
> that couldn't see its own unpublished upload would show a broken player for everything just
> added. So that route tries the draft prefix first *only* for someone who could open the editor
> for this site, and the **cookie-presence check comes first** so reader traffic pays nothing for a
> branch it can never take. Draft responses are `private, no-store`; published ones keep their
> cache. Verified both directions in a browser: the editor gets 200 and a playing video, a
> signed-out reader gets **404** for the same URL while the object demonstrably exists.
>
> Also: `revertDraftFile` deletes the uploaded object, not just the row (otherwise it sits in the
> draft prefix forever, unreferenced, while its path still reads as "taken"), and
> `listSessionChanges` classifies a binary row with `headObject` rather than `getObjectText` —
> the text path would pull a whole video into memory to decide "added" vs "modified". `gateEditor`
> moved to `src/lib/editor-gate.ts` so the new actions and the asset route share one gate;
> deliberately *not* exported from a `"use server"` file, where every export is a public endpoint.
>
> The dialog became a real picker: search, an Upload tile, a grid of what the site already has with
> live thumbnails (`preload="metadata"`, so a grid of videos doesn't pull every byte), and draft
> entries shadowing published ones at the same path. Uploading a taken name gets a numeric suffix
> rather than overwriting a file still referenced elsewhere. Guards: `media-upload.test.ts` (18 —
> the extension/size rules, slugified target paths including a name that slugifies to nothing,
> collision suffixing, and the published/draft listing merge), four new `native-publish-plan`
> cases, and an `editor.spec.ts` case pinning what no unit test can see: a real presigned PUT
> against this storage, the row landing as `binary` with empty content, the slugified path, and the
> editor-200/reader-404 split. Verified end to end in a browser on both site kinds — including a
> hosted publish where the live key went from absent to 9409 bytes of `video/mp4`, byte-identical
> to the source, then fetched anonymously over the tenant host.
>
> Two things that cost time and are worth writing down. Playwright's `APIRequestContext` runs in
> **Node**, whose resolver doesn't do `*.localhost` — every host in this suite is one, so an HTTP
> assertion there fails on DNS rather than on the thing under test; do it with `page.evaluate(fetch)`
> or a real page instead. And Radix's dialog focuses its own container on open, so a child's
> mount-effect `focus()` gets taken straight back — the field is claimed in `onOpenAutoFocus`,
> which is the one callback that fires instead of that. The symptom is the first keystroke of a
> paste going nowhere, and it only showed up in the full-suite run.
>
> **A failed upload said nothing at all (2026-08-25).** Reported as "this fails hard" with a copied
> cURL. The upload path had a real defect regardless of what caused their failure: the `fetch` to
> storage had **no catch**. A rejected fetch — which is what a blocked cross-origin request, an
> unreachable bucket, or a dropped connection produces — escaped, `finally` stopped the spinner, and
> the dialog showed *nothing*. Silent failure is the worst mode here: no message, nothing in the
> change list, nothing to report. Now: a `catch` that names the two things `TypeError: Failed to
> fetch` actually means (browsers give that error no detail on purpose) plus **the endpoint the
> request was going to**, and on a non-ok response the **S3/MinIO error body is parsed and shown** —
> `SignatureDoesNotMatch`, `RequestTimeTooSkewed`, `EntityTooLarge` — because storage already said
> what was wrong and swallowing it sends the next person reading network logs. Pure helpers
> (`parseStorageError`, `uploadThrewMessage`, `storageOrigin`) with 9 tests, plus an `editor.spec.ts`
> case that routes the PUT to a 403 with an XML body and asserts the code is relayed, the spinner
> stops, and nothing is recorded. Verified all three failure shapes in a browser via request
> interception.
>
> **What the reported failure was is still unknown.** Not reproducible here: a fresh presigned PUT
> succeeds from Node with every header shape, MinIO's preflight answers 204 with the right
> `Access-Control-Allow-Origin`, host and container clocks agree to the second, and uploads of 9KB,
> 3.4MB and 150MB all succeed in Chromium — including a filename shaped exactly like theirs
> (`copy_….MOV.mp4`, which slugifies to `copy-…-mov.mp4` by design). Their reporter is Brave, and
> the pasted cURL carries no body (devtools can't serialize a File) and an expired signature, so
> replaying it proves nothing either way. The error-surfacing above is what closes this: the next
> attempt says which of the two it is.
>
> **Backspace stops at a component's edge (2026-08-25).** Reported as "pressing backspace until
> there are no more characters should just stop — it should not keep going and destroy the tab."
> ProseMirror's default Backspace at the start of a block joins it with what precedes it, and
> inside a `<Tab>` the thing that precedes it is the tab's own opening — so emptying a tab and
> holding the key a beat longer lifted the content out and took the tab with it. Reproduced
> exactly: with the guard removed, the browser run reports "the tabs were destroyed — 1 left".
>
> `EdgeGuard` swallows Backspace on a component's leading edge and Delete on its trailing edge —
> the latter is the same damage from the other side (it pulls the FOLLOWING block into the
> component), and fixing only the reported half would leave the mirror-image bug in place. A real
> selection is never blocked: selecting content and deleting it is deliberate, and so is deleting
> a component via a tab's × or the block handle's menu. Applies to every component node, sharing
> `COMPONENT_NODES` with scoped Select All — the container lookup both need is now one
> `enclosingContainers` helper rather than two copies, with the same `TextSelection.between`
> normalization (a node's raw content boundary is usually one short of the first place a cursor
> can sit, so comparing against it would mean the edges never match). Guards: `edge-guard-plan`
> (6 unit tests, including that the blocked direction is the one that would escape and that a
> selection deletes normally) and an `editor.spec.ts` case that hammers Backspace twelve times
> past empty and asserts both tabs survive — on its own fixture page, since it asserts on what is
> and isn't left in a document.
>
> **…and it swallowed one press it shouldn't have (2026-08-27).** Reported as "I'm not able to
> backspace out the first checkbox inside a tab." Guarding the edge was right; treating the edge
> as *"nothing can happen here"* was not. Backspace at the start of a list item normally drops the
> list formatting — a delete that stays **inside** the component — and the first item of a list
> that opens a tab sits on exactly the position the guard swallows. So that one checkbox (or
> bullet) was the only one in the editor that could never be removed; the second item behaved
> normally, which is why the report named the first. Pre-existing since the guard landed, not a
> regression from the `/`-menu fix above.
>
> The rule is now `edgeDeleteAction` → `allow` / `block` / `unwrap`: at the leading edge with a
> liftable list item, lift it instead of eating the key. Whether the lift is legal is a question
> only the editor can answer (`can().liftListItem`), so it goes *in* as a boolean and the decision
> stays pure. Forward Delete gets no equivalent — at the trailing edge it pulls the following
> block in whatever the cursor is nested in — and once the list is gone the next press is
> swallowed exactly as before, which is the second half of the new `editor.spec.ts` case (the two
> behaviours are one keystroke apart, so pinning them separately would let a fix for either break
> the other). Plus 4 unit tests on the new decision.
>
> **…and it was still swallowing two more (2026-08-28).** Reported as "if I add a code block inside
> an accordion and press backspace and delete all the letters, it stops and doesn't remove the code
> block", then "same for blockquote". The list fix above was the right *shape* and too narrow: what
> Backspace means at the start of a block is generally "strip this block's formatting", and every
> form of that stays INSIDE the component. So the guard now holds an ordered list of in-container
> actions — lift the list item, leave the quote, turn an emptied code fence back into a paragraph —
> and runs the first that applies; the pure decision drops to `allow` / `block` / `handle`, with
> the editor answering "is there anything to do here" via `can()`. Clearing an emptied typed block
> is `setNode("paragraph")` rather than TipTap's own `clearNodes()`, because that one *also lifts*
> and would carry the paragraph out of the component — the exact escape being guarded.
>
> Both new actions are pinned twice: `edge-guard-actions.test.ts` (jsdom, three commands at the
> leading edge, each asserted to leave the component standing — the commands were what was in
> question, and they run in milliseconds everywhere) and one browser case for the keystroke.
>
> Getting that browser case honest took four tries and **none of the failures were the product** —
> worth writing down, because each is a way to write a lying editor test. `⌘A` first (Select All is
> component-scoped here, so it deleted the whole accordion). Then clicks landing on a block's
> padding rather than its text. Then the real one: **`keyboard.press` resolves when the event is
> sent, not when ProseMirror has applied it**, so a run of presses raced the editor and two never
> landed — visible only because a temporary `console.debug` in the guard, echoed through
> Playwright's console listener, showed presses arriving at 14, 13, 12, 11, 10 and then stopping.
> That's the tool to reach for when a keystroke "does nothing". The version that stuck stopped
> simulating typing altogether: **empty the block with a triple-click selection and one Backspace**,
> so the only press under test is the one after it. The lesson generalises — when the setup is
> flakier than the assertion, make the setup a single deliberate act.
>
> While seeding that fixture, an adjacent invalid node turned up: `>` alone parses to a blockquote
> with **no children**, which `block+` forbids — the same trap as the empty component, from
> markdown's side. Filled with a paragraph in the converter, with a round-trip test.
>
> **The `/` menu didn't scroll to the highlight (2026-08-28).** 33 blocks in a ~340px scroller, and
> the arrows move a highlight the mouse isn't driving — so nothing brought the new row into view
> and the selection silently ran off the bottom, which reads as the keys having stopped working.
> One `scrollIntoView({ block: "nearest" })` keyed to the selected index. The e2e asserts the
> LIST's `scrollTop` moved, not just that the item is in view: with no scrolling the item would be
> past the fold and a naive in-view check could still pass on a shorter list.
>
> **The whole-site preview became an overlay (2026-08-25).** It was `<a target="_blank">`, which
> put the preview in a window with no relationship to the editor: getting back meant hunting for a
> tab, and the two drifted — the tab kept showing the draft as of when it opened while you carried
> on typing. Now a full-screen overlay with its own header (Site settings · Ask agent · reload ·
> close), Escape to dismiss. The frame points at the same `/preview/{org}/{site}/site` route the
> tab used, so it's still the real renderer reading the real draft rather than a second rendering
> path that could disagree with what publishes.
>
> Two details that only showed up by driving it. It opens on the **page you're editing**, not the
> site root — the first attempt framed the root, and the test caught it because a marker typed into
> `guides/components` wasn't there. `previewHref` normalizes the index page's two spellings (`""`
> and `"index"`), the same trap the nav tree has. And `openPreview` **flushes the pending edit
> first**, for the reason page settings already does: the preview renders the draft and autosave is
> debounced, so without it the last thing you typed is the one thing missing — which reads as the
> preview being broken. Pinned by typing and opening the preview immediately, with no wait, so the
> keystroke is still inside the debounce window. "Ask agent" closes the overlay before summoning
> the composer, which lives in the editor's layout and would otherwise be behind an opaque frame.
> Guard: an `editor.spec.ts` case asserting no tab opens, the four header controls, the framed URL
> is the current page, its content renders, and Escape returns to the editor. Verified in both
> platform themes.
>
> **Video 404'd in the draft preview (2026-08-25).** Reported as "the editor renders the video URLs
> without the tenant parts," and it was broader than the editor: **any** surface with a non-empty
> `assetBase` — path-based tenant serving (`/sites/{slug}`) as well as the draft preview — rendered
> `<video src="/videos/x.mp4">` unrewritten, so it resolved against whatever host was serving and
> 404'd. The markdown image directly beside it worked, which is the tell: an intrinsic `<video>`
> compiles to a bare `_jsx("video", …)` and **bypasses the MDX components map entirely**, so
> `applyTenantUrls` never saw it. This is exactly the literal-`<img>` problem `remarkLiteralImg`
> already exists to solve, and it needed the same trick: `remarkLiteralMedia` renames
> `video`/`source`/`audio`/`iframe` to `PvVideo`/`PvSource`/… so the compiler emits
> `_jsx(_components.PvVideo, …)`, and the map holds overrides that put the real tag back with `src`
> and `poster` run through `withBase`.
>
> The first attempt was wrong in an instructive way: registering `out.video` directly. It
> typechecked, read correctly, and did nothing — the map is only consulted for names the compiler
> routes through it, which an intrinsic never is. Measured rather than assumed: the preview still
> emitted `/videos/sample-clip.mp4` with the image beside it already rewritten.
>
> Three things this had to get right. `<source>` is renamed too, since the src-less form puts every
> URL on the children and rewriting only the parent fixes nothing. The overrides are registered
> **unconditionally**, before the `!linkBase && !assetBase` early return — by then the element has
> been renamed, so a map that didn't hold the name would hit the unknown-component Fallback and the
> video would *silently vanish* on the published site; `withBase` is a no-op with an empty base, so
> host mode stays byte-identical. And the compile cache is bumped to **v7**: the key is
> content-addressed on the source, so without it a cached compile keeps emitting the bare intrinsic
> and the fix appears not to work — the trap that file's own comment already warns about. Guards:
> `tenant-media-urls.test.ts` (8, including that host mode still renders the element and that the
> synthetic name renders back as the real tag), verified failing without the fix, plus the existing
> `/media` smoke fixture covering host mode where the rename must change nothing. Confirmed in the
> browser: the preview's video src went from `/videos/sample-clip.mp4` (404) to
> `/api/tenant-asset/starter/videos/sample-clip.mp4` (200, playing), poster and `<source>` rewritten
> with it, and the external YouTube iframe left alone.
>
> One test debt logged rather than hidden: the e2e does **not** assert that an editor can read the
> draft copy back over HTTP. It works (it's what makes the thumbnail and the inserted player show an
> unpublished upload, verified in a browser, and the reader-404 half IS asserted), but in that
> harness it 404s on roughly two runs in three and polling for 15s doesn't change it — so it isn't a
> race, and something about the harness stops the route's draft branch firing. A test that fails two
> thirds of the time is worse than none; the reason is worth finding before re-adding it. Also, six
> tests in that file now clear the drafts they create through a shared `clearDrafts` — the
> Publish-panel test asserts the session has exactly ONE change, so any test leaving an edit behind
> fails an assertion further down the file, and the two upload tests got their own pages for the
> same reason. `clearDrafts` **deletes more than once**: autosave is debounced, so a keystroke from
> the end of a test is still in flight when it finishes and the row lands *after* a single delete —
> which is what made the Publish-panel test fail intermittently and read as flakiness in itself
> rather than as unfinished work in the tests above it. And the media tests choose their slash-menu item with **Enter, not a click**: the menu
> re-renders on every keystroke, so a click lands on a node React has already replaced ("element was
> detached from the DOM").
>
> **Task lists, and the checkboxes the converter was eating (2026-08-25).** Reported as "editor is
> missing a task list component." It was missing, but looking for where to add it turned up
> something worse: `mdxToProseMirror` **dropped `checked` entirely**. A page containing
> `- [ ] thing` opened in the Visual editor and saved came back as `- thing` — every checkbox on
> the page gone, silently, with no error and nothing in the diff to suggest the editor had done it
> rather than the author. The reader side was always fine (remark-gfm renders the boxes), so this
> only ever bit people who opened an existing checklist in Studio. Both directions now carry it,
> and `undefined` stays `undefined` in each — a plain bullet that became `checked: false` would
> grow an empty `[ ]` on every ordinary list in the product.
>
> **The checkbox has to be a real `<input>`** — the first version drew it in CSS as an `::before`
> on `li[data-checked]`, which screenshotted perfectly, matched both themes, and could not be
> clicked, because a pseudo-element is not a thing you can put a pointer on. It shipped and came
> straight back as "not able to check the checkboxes." A plain-DOM node view (not
> `ReactNodeViewRenderer` — a React root per bullet is the cost the CSS version was avoiding, and
> that part of the reasoning was right) builds
> `<li><label contenteditable=false><input></label><div>content</div></li>`; a plain bullet gets
> `contentDOM === li` and the default rendering, so ordinary lists are untouched. Three things it
> had to get right, each found by driving it: the change handler re-reads the node at `getPos()`
> from the **current** doc rather than closing over stale attrs; `ignoreMutation` rejects
> everything outside `contentDOM`, or toggling — which mutates `data-checked` on the `<li>` —
> reads as a content change and ProseMirror re-parses the label and content div into a stray empty
> paragraph on every click; and the checkbox is positioned in the **marker gutter**, so a task
> item's text lines up with a plain bullet's in a mixed list. `accent-color` plus the platform's
> existing `color-scheme: dark` means the UA paints it correctly in both themes with no bespoke
> box. Verified clicking it in a browser, light and dark.
>
> The editor models a task item as a **`listItem` carrying `checked`**, not as the separate
> `taskList`/`taskItem` node pair `@tiptap/extension-task-list` supplies. GFM has no such split:
> `- [x] done` and `- plain` are both list items in one list, and a schema with two node types
> can't represent a list that mixes them — it would have to either refuse the document or silently
> re-shape it, which is the class of bug this note is about. So `StarterKit`'s `listItem` is
> replaced with a `TaskListItem` that adds one attribute (rendered as `data-checked`), the
> checkbox is drawn in CSS off that attribute rather than as an interactive widget, and
> <kbd>Mod-Enter</kbd> toggles the item under the cursor. `/task` inserts one.
>
> Guards at three layers, because the bug was invisible at two of them. The round-trip suite's
> idempotency check would have passed with the checkboxes dropped — `- thing` is perfectly stable
> once you've lost the `[ ]` — so task lists get a **byte-exact** block asserting the MDX comes
> back identical, not merely stable. `/media`'s smoke fixture gains a task list so the reader path
> stays pinned. And an `editor.spec.ts` case opens a page that **already has** one (the data-loss
> path was about existing content, not insertion), clicks a checkbox, types into it, and asserts
> both states survive the autosave while the plain bullet beside them stays plain. The jsdom
> schema test grew three node-view cases in the same spirit: they assert on the **input** rather
> than on `data-checked`, since the whole failure was a correct attribute nobody could reach.
>
> **…and the READER half was never styled (2026-08-28).** Reported with a screenshot of a checklist
> rendering as "bullet, then checkbox, then text". The editor got the full treatment when task
> lists landed — marker off, checkbox in the gutter, finished item struck through — and the
> published page got remark-gfm's `<li class="task-list-item"><input>` with `.prose ul` still
> drawing `list-disc` over it. Nobody wrote the reader's rules, so the two surfaces disagreed from
> the day the feature shipped; it isn't a regression from the table work above. The same shape now
> lives in `globals.css` — **both copies**, the platform's and `apps/cli`'s, which are hand-kept
> mirrors of the docs `.prose` styles.
>
> The checkbox needed one thing the editor didn't: **`color-scheme`**. `color-scheme: dark` is set
> on `<html>` for the platform shell, and a docs page shares that element, so the UA painted a
> native control dark on a *light* docs page — the two-theme-systems gotcha arriving from the other
> side. It's pinned per-control to the docs appearance instead. Guarded by the existing "docs CSS"
> smoke check, which reads the stylesheet the page actually links (this is CSS, so there is nothing
> in the HTML to assert): verified failing with the rule removed — `task-list styling gone —
> checklists render bullet + checkbox` — and the fixture's `include` list now pins the
> `task-list-item` class the selector depends on.
>
> **`/` inside a component said "No matching blocks" (2026-08-27).** Reported as "if I run a slash
> command inside a tab I don't get the components list." It listed all 33 blocks in a plain
> paragraph and none inside a `<Tab>` pane — the same code, the same query (`""`), the same item
> set. What differs is *who tears the menu down*. The suggestion plugin resolves its items
> **asynchronously** (`await items({query})`, even for a synchronous filter), so a menu opens with
> an empty list and is filled a microtask later. `<DragHandle>` (from
> `@tiptap/extension-drag-handle-react`) `unregisterPlugin`s + `registerPlugin`s inside a
> `useEffect` whose deps include `onNodeChange` — and ours was an inline arrow, i.e. a new
> dependency on **every render**. Reconfiguring the plugin set makes ProseMirror destroy and
> rebuild every plugin view; the suggestion's `destroy()` fires `onExit` and aborts the in-flight
> lookup, so the resolved list never arrives and the palette is frozen on the empty state it
> opened with. Every keystroke did this; what made it *visible* only inside components is where
> the teardown lands relative to that microtask — typing in a node view put it between the open
> and the resolution, and in a plain paragraph the list won the race. Measured, not guessed: a
> temporary debug plugin logged `items() "" 33` immediately followed by `onExit`, with a stack
> ending in `DragHandle.useEffect → Editor.unregisterPlugin`, and no matching state transition —
> the exit came from the plugin view being **destroyed**, not from the suggestion deactivating.
>
> Fix: a `useCallback`-stable `onNodeChange` (it only writes a ref, so it has no deps). The plugin
> set now stays put while you type, which is also the end of a per-keystroke unregister/register
> of a ProseMirror plugin nobody was paying attention to. Hardened alongside it: `SlashCommand`
> deferred its **opens** through `queueMicrotask` (to stay out of the editor's React render phase)
> but closed **synchronously**, so a close could be applied before an open that was queued ahead
> of it — leaving exactly this stuck-open-and-empty menu. Both directions are queued now, so they
> land in the order the editor dispatched them. Guarded by an `editor.spec.ts` case that opens the
> `tabby` fixture, types `/` inside a pane, and asserts a populated menu (and that picking `Info`
> still inserts into that pane) — verified failing on the inline-arrow version first.
>
> **The general rule, and it is not slash-menu-specific: any prop that feeds a TipTap React
> component's effect deps must be identity-stable.** An unstable one doesn't warn — it silently
> rebuilds editor plugins under you, and whatever state those plugins hold (a suggestion, a
> pending fetch, a decoration set) is what you lose.
>
> **Accordions become a real disclosure list (2026-08-27).** Asked for with a screenshot of the
> target: one bordered group, a chevron and an editable name per row, a body you type into. What
> we had was the reader's component pinned open — `FORCE_OPEN` existed because a closed accordion
> hides its own editable content — with the title reachable only from Source mode, and
> `<AccordionGroup>` an invisible `<div>`, so a group read as a stack of separate boxes rather
> than one list. `AccordionNodeView` owns all three: open/closed is React view state (never the
> document, and deliberately NOT `defaultOpen`, which is what a *reader* starts with — the same
> line the tab strip draws for "which tab is showing"), the title is a field committing per
> keystroke, and the group draws the border so its rows can be flat with hairlines between them.
> Which one owns the box is decided in CSS by the parent, because the rows are ProseMirror's
> children and TipTap wraps them in elements of its own — a standalone `<Accordion>` keeps its
> own box, one inside a group loses it.
>
> Two things the browser settled, neither visible in the markup. A fresh row's body looked **height
> zero**, which read as a styling problem and was really the node bug below — an *invalid*
> accordion has no paragraph in it at all, and nothing to give the box height. And typing in a
> title threw `RangeError: Invalid content for node type accordion` on
> **every keystroke** — the real find here, and a pre-existing hole: every component node's
> content is `block+`, so an empty component (`<ParamField … />`, or a tag pair with nothing
> between it) parses to an **invalid node**. Nothing rejects it at parse time; it surfaces later
> on the first `setNodeMarkup`, which is exactly what an inline title field does. So the converter
> fills one empty paragraph in — and `to-mdx` drops it again, or `<X />` would grow into a
> `<X>\n</X>` pair and rewrite every API-reference page on save. The mapping is lossless because
> no MDX produces a *single empty paragraph*: a blank line inside a tag pair parses to no children
> at all. Guards: 5 round-trip unit tests on the empty-component contract (including that a
> self-closing tag stays self-closing) and an `editor.spec.ts` case for the journey — chevron
> hides the body without unmounting it, Enter moves title→body, add/remove, and the result in the
> draft as MDX — with `Invalid content` added to its console-error filter, since that's the shape
> this class of bug takes.
>
> Insert defaults changed with it: `/accordion group` makes **two** rows (one collapsible row is
> just an accordion), and neither carries a `title`. An untitled row writes `<Accordion />` rather
> than publishing an "Accordion title" nobody chose — the same bargain `<Step>` already makes,
> with the slot's placeholder standing in for the name.
>
> **Second pass: "the styling is off and the way to add an accordion is in the wrong place."** Add
> started as an **Add accordion** button in a footer strip under the whole group — which put the
> control nowhere near the row it acts on and read as part of the document rather than as chrome.
> It's now a hover-revealed **+** at the row's right end, inserting **directly below that row**
> rather than at the end of the group, with **✕** beside it; a standalone accordion offers neither,
> because add-and-remove are operations on a *list*.
>
> **Third pass, and the one that was actually the point: "can't we at least try to make it look
> like it does when it's rendered."** Right — and the first two passes were both me hand-drawing a
> second accordion instead of using the one we ship. Every restyle from here would have been
> guesswork against a moving target. So the node views now render the **real** `<Accordion>` /
> `<AccordionGroup>`, the way `StepsNodeView` already hands its controls into the real `<Steps>`:
> the component grew `title: ReactNode` (the editor passes a field and the row's buttons),
> `open`/`onToggle` (the editor owns collapse; readers keep their own state), and `keepMounted`
> (the body is ProseMirror's content hole — unmounting it takes the node's content with it, which
> is what `FORCE_OPEN` was working around). A string title still sits inside the header button, so
> the whole row stays one click target for readers; a node title moves beside it, because nesting
> a field in a button makes it unusable.
>
> One reader-side change came with it, and it's visible on published pages: `<AccordionGroup>` was
> a bare `<div className="my-5">`, so a "group" was a stack of separate boxes. It now draws the
> list — one border, hairlines between rows, rows flattened by a descendant selector so a
> standalone accordion keeps its own box. That is also the shape the reference screenshot showed,
> so editor and reader converge on it rather than on two different looks.
>
> Two editor-only compensations survive in `platform.css`, both from the same cause — the rows are
> ProseMirror's children, so TipTap wraps each in elements of its own and the component's
> direct-child selectors stop reaching them: the group's `divide-y` seam (redrawn by matching the
> row's class at any depth, rather than by counting wrappers) and the body's first/last paragraph
> margins. The seam needed **both** dark selectors — `.dark` for the docs appearance AND
> `[data-db-theme="dark"] .db` for the platform's, which is what `dark:` compiles to here. Keyed on
> only the first, it painted a **white line across a black editor**; that gotcha is already in
> AGENTS.md and I walked into it anyway.
>
> **Tables become an editable grid (2026-08-27).** Asked for with two screenshots: a grid with
> handles while editing, an ordinary markdown table when rendered. A table was the last block you
> could only *type into* — three hand-rolled nodes with no `tableRole` in their specs, which is
> what prosemirror-tables dispatches on, so not one of its commands could run: no add a column, no
> delete a row, no Tab to the next cell, no dragging a cell selection. The schema is TipTap's table
> extensions now, extended back to the converter's shape — `content: "inline*"`, because a
> markdown cell is a run of inline content and TipTap's default `block+` would add a paragraph
> layer to unwrap on every save. `align` still rides on the table node. Column resizing is off on
> purpose: GFM has nowhere to write a width, and a control that silently loses its effect on save
> is worse than no control.
>
> The chrome is a **plain-DOM node view**, and that isn't a preference. React's `NodeViewContent`
> renders a wrapper element around the content hole, and a `<div>` between `<table>` and its
> `<tr>`s is not a table: the rows stop being rows and the columns stop dividing the width. It
> looked *nearly* right — a grid whose cells hugged their text — which is how it survived a
> screenshot and died on measurement (`tableW: 551` while its cells added up to 246). The handles
> are positioned from measured cell geometry, because markdown columns size to their content, and
> re-measured by a ResizeObserver.
>
> The first React attempt also produced "Maximum update depth exceeded": a `useLayoutEffect` that
> measures after **every** render handed React a fresh array each time, so the update scheduled the
> render that scheduled the update. That one was caught the way the class always is — by watching
> the console, not the page. The e2e case has the console-clean assertion for the same reason.
>
> One thing the table selection changed elsewhere: the formatting bubble menu now declines to show
> over a `CellSelection`. Selecting a column with its handle is structural — you're about to delete
> or move it — and the toolbar popped up across the rows you had just selected, hiding them.
>
> **The grid highlights where you are, in violet.** Three states, and they're deliberately not the
> same weight: the caret's cell is outlined, the handles for *its* row and column light at 55%
> ("you are here"), and a handle you actually click goes solid with the whole band tinted ("this is
> what I'll act on"). Violet rather than the blue everything else in the platform uses, because blue
> is the docs link colour and reads as "this is a link" inside body text — editor furniture
> shouldn't. The outline is an absolutely-positioned overlay in the chrome layer, not a class on the
> `<td>`: the cells belong to ProseMirror, and mutating them is an edit as far as it's concerned.
> The one specificity catch was the header shade painting over a selected header cell —
> `:where(tr:first-child)` drops that rule's weight so the selection tint wins, which matters
> exactly when you've selected the header row and need to see it.
>
> **The `+` controls drag, and say so.** Asked for as "add these tooltips", with a screenshot of a
> two-line hint — *Click to add a new row / Drag to add or remove rows*. The tooltip was the ask;
> the **drag was not built yet**, and shipping a control that advertises a gesture it doesn't have
> is worse than shipping neither, so both landed together. Dragging the `+` away from the table
> adds bands and dragging back over it removes them, one per band-width of travel — the unit is the
> last row's height or last column's width, so the table grows exactly as far as the pointer went
> rather than at an invented rate. It stops at one row and one column: deleting the table is the
> drag handle's job, not something you should fall into by overshooting. A drag ends in a click
> event too, so a drag that changed anything swallows that click rather than adding one more band.
>
> **A cell can hold a list (2026-08-27).** Reported as "it's not allowing me to add lists inside a
> table cell" — and it wasn't, by construction: cells were `content: "inline*"` because that is
> precisely what a GFM cell is. Markdown has no pipe-table syntax for a list in a cell; the only
> representable form is HTML, which MDX renders as a real list. So cells hold `block+` now and the
> converter reconciles the two ends:
>
> - **Out** (`cellChildren`): a paragraph flattens to its inline content, so an ordinary cell's
>   markdown is byte-identical to what it always was. A list becomes `<ul><li>…</li></ul>`, with
>   each item's inline content serialized as markdown, so emphasis inside one survives.
> - **In** (`cellBlocks`): the run is walked, and a raw atom matching that exact shape becomes a
>   list again. Walked rather than tested whole because "text, then a list" is what typing one
>   actually produces — the first pass only recognised a cell that was *nothing but* a list, so a
>   reload turned the mixed case back into visible source. Anything that isn't that shape stays
>   raw, which keeps the passthrough guarantee for markup we don't model.
>
> `rawSlice` is no use here: remark gives table cells no position offsets, so slicing one returns
> "". The markup is read off the parsed atom instead. Guards: six round-trip cases (ordinary cell
> unchanged, `<ul>`/`<ol>`, emphasis inside an item, text-plus-list, non-list HTML left alone) and
> an `editor.spec.ts` step that types `- one` into a cell and asserts the HTML in the draft.
>
> **`<CodeGroup>` becomes a real tab strip (2026-08-29).** Asked for with three screenshots: a bar
> of file names with the active one coloured and closable, `+` and a bin beside it, `// add code
> here` in an empty fence, and a language control on the right. It was the last structural
> component still falling back to labelled chrome, for the reason `<Tabs>` used to: a group picks
> its children apart, and ProseMirror gives a node view exactly one content hole. Same answer as
> the tab strip — render every block into that hole and hide all but the active one with a scoped
> `<style>` (`hiddenCodeRule`, now sharing `hiddenChildRule` with the tabs version) — because a
> class toggled from an effect doesn't survive ProseMirror re-rendering its children.
>
> Everything the strip edits is the fence's own syntax, not editor state. A tab's label is its
> **title** (```` ```bash npm ```` or ```` ```ts title="app.ts" ````), so renaming one writes
> `meta` and the reader's tab says exactly what you typed. `code-meta.ts` is the write half of
> `parseCodeTitle`, and it has to mirror that parser's *greediness* to be safe: with no `title=`
> present the parser reads a bare label as the WHOLE meta, so a label sharing the meta with
> anything else (`{1,3-4}`, a `key=value` directive) is written in the explicit form — otherwise
> `app.ts {1,3-4}` comes back as a tab named "app.ts {1,3-4}". Every unit case asserts the round
> trip through `parseCodeTitle` rather than the formatting, since the string is only ever a means.
>
> The language picker is searchable and matches the **spellings authors write**: `ts`, `py`, `yml`
> and `sh` are aliases on their entries, so a fence already written ```` ```ts ```` reads
> "TypeScript" instead of falling through as unlisted, and typing two letters finds it. A language
> we don't list is shown as written and left alone.
>
> Two things the reference showed that deliberately did NOT ship. The "…" menu (line numbers, wrap,
> expandable, twoslash, hide copy) is absent because **the renderer ignores those fence directives
> today** — `parseCodeTitle` reads a title and nothing else — and a control that writes a directive
> nothing honours is worse than no control (the same call as the table `+` tooltip, which only
> shipped because the drag shipped with it).
>
> **Where the violet convention stops.** Reported as "tabs are purple in the editor and green in the
> render". The active tab had been moved to `--violet` on the reasoning that editor furniture is
> violet (the grid highlight's rule) — but the green it replaced was the **site's own `primary`**,
> which is what the reader's `<CodeGroup>` underlines with, so the change was what *created* the
> mismatch. The line is the reader, not the surface: the tab labels are a preview of a published
> component and follow `primary`; the controls beside them (`+`, `✕`, bin, language) exist only in
> the editor and stay violet. The green itself is a stale-content artifact, not a design choice —
> `examples/starter/docs.json` and `docs/docs.json` are both `#7C3AED`, while every seeded site
> carries `#16a34a` from the published `papervine/starter` mirror, which is behind.
>
> One thing measurement caught: the menu is **portaled to `<body>`**. The group's `overflow-hidden`
> is what rounds the code block's corners, and rendered in place it clipped the menu to two rows —
> visible only in a screenshot, since every assertion about it still passed. Portaled it sits
> outside the `.db` shell, so it carries `db-portal` and its own dark surface like the `/` palette.
> Guards: `tests/unit/code-meta.test.ts` (round trips, directive preservation, the alias table) and
> an `editor.spec.ts` journey — switch, rename, language, add, remove, then assert the MDX in the
> draft — with the console-clean assertion.
>
> **Syntax highlighting in the editor (2026-08-29).** Asked as "I imagine it should syntax
> highlight (based on the language selected?)" — and it should. Published pages are highlighted by
> **Shiki at compile time**: server-side, async, WASM-backed, none of which a keystroke can wait
> for. In the editor highlighting is ProseMirror decorations recomputed on every change, so it has
> to be synchronous — that's **lowlight** (highlight.js) via `@tiptap/extension-code-block-lowlight`,
> with the token classes mapped onto `github-light`/`github-dark`, the same two themes the renderer
> uses, so a block reads the same in both places. (Verified by reading the computed colour in both
> platform themes, not by eye.)
>
> The registry (`code-highlight.ts`) is explicit because of what an UNREGISTERED language does:
> TipTap's plugin falls back to `highlightAuto`, which guesses. A ```mermaid fence coloured as
> somebody's guess at Ruby is worse than no colour, so mermaid and prisma are aliased to plaintext,
> and `defaultLanguage: "plaintext"` stops an untitled fence being auto-detected at all.
>
> **Components whose whole content is ATTRS (2026-08-29).** Reported one at a time — "we're missing
> a badge component", then colour, icon, tree — and none of them were missing from the *renderer*:
> `<Badge>`, `<Icon>`, `<Color>` and `<Tree>` all shipped and all match the documented API (Badge's
> is prop-for-prop; `iconType` is accepted and ignored, as Lucide has one weight). What was missing
> was the **editor**: the converter modeled no inline components and no member-expression tags, so
> each one came through as an unknown atom — its own MDX source, in an amber box, uninsertable from
> the `/` menu.
>
> Three shapes had to be added to the typed model, and each one is a schema fact, not a rendering
> choice:
>
> - **Inline** (`ComponentSpec.inline`): `<Badge>Beta</Badge>` sits in a run of text, so MDX hands
>   it over as an `mdxJsxTextElement` and its node belongs to the inline group with `content:
>   "text*"` — the label is the node's content, typed into like the sentence around it. Written on
>   a line of its own it arrives as a FLOW element instead, and gets wrapped in a paragraph so an
>   inline node has somewhere legal to live; the MDX it serializes back to is identical either way.
> - **Void** (`ComponentSpec.void`): `<Icon />` and `<Tree.File />` hold nothing, so their nodes are
>   atoms — selected, arrowed past and deleted as one thing — and serialize back self-closing.
>   Children written into one anyway demote the element to raw rather than being dropped.
> - **Member-expression tags**: `<Tree.Folder>` / `<Color.Item>` are reported by mdast under their
>   literal dotted name, so they're ordinary keys in `COMPONENTS`, and `mdxName` round-trips the
>   exact spelling — a `<FileTree.File>` that came back as `<Tree.File>` would be a diff in
>   somebody's repo.
>
> The node views split on one line, the same one as everywhere else: **is this thing the reader's
> component, or is it chrome?** A badge and an icon ARE the published component (they render live,
> from the registry). A tree row and a colour swatch are not — a `<Tree.File>` is named entirely by
> an attr, so there is no content hole to type into, and the reader's tree collapses with
> `<details>`, which in an editor would hide the rows you're arranging. Those are drawn here from
> the same parts: same icons, same indent, same rail, same swatch tiles.
>
> Two things stay deliberately raw, and both are the passthrough guarantee working rather than a
> gap: a `<Color.Item value={{ light, dark }}>` (an expression attr — flattening it would silently
> lose the dark colour) and a badge with an unknown attr. And one bug the tests caught twice: a
> popover rendered *inside* a component that rounds its corners with `overflow: hidden` gets
> clipped — the colour editor to a sliver, the language menu to two rows — so every menu here is
> portaled to `<body>` with measured coordinates and `db-portal`.
>
> Guards: `mdx-prosemirror-roundtrip.test.ts` (Badge: inline parse, marks, attr preservation,
> demotion), `mdx-prosemirror-tree.test.ts`, `mdx-prosemirror-color.test.ts`,
> `icon-names.test.ts` (the kebab names the picker offers resolve back to real Lucide exports —
> asserted over the whole library, since an unknown name renders nothing and reports nothing), and
> three `editor.spec.ts` journeys.
>
> **Still unmodeled** (they render for readers; in Visual mode they show their source): `Danger`,
> `Banner`, `Tile`, `Panel`, `RequestExample`, `ResponseExample`, `Prompt`, `Tooltip`, `GitHub`,
> `Update`, `Visibility`, `View`. Most are plain containers — a `COMPONENTS` entry, a registry
> entry and a `/` item each.
>
> **The bug the new components surfaced: a namespace component 500'd the draft Preview
> (2026-08-29).** Reported as `Expected component `Color.Item` to be defined` from
> `preview/[org]/[site]/site/[[...path]]`. Not a converter or editor bug at all — `applyTenantUrls`
> rewrites `href`/`src` against the tenant's base by **wrapping every named component in a plain
> arrow function**, and a wrapper carries none of a namespace component's static members. MDX
> compiles `<Color.Item>` to a `components.Color.Item` lookup, found `undefined`, and threw — a
> 500 rather than a degraded render, because the throw lands while React renders the content, not
> inside the compile step's try/catch.
>
> What made it invisible for months is the branch it lives in: the wrap only happens when a link
> or asset base is SET, i.e. the **draft preview** and **path-based serving** (`/sites/{slug}`). On
> a tenant host the map passes through untouched — so `tests/fixtures/components-extended.mdx`
> renders `<Tree.Folder>`, `<Color.Item>` and `<GitHub.Repo>` on every smoke run, and every crawl
> is 0 × 500, while the same page died in Preview. It went unnoticed because nothing could
> *insert* one of these components until the editor learned to; the first `<Color>` a person added
> from the `/` menu hit it immediately.
>
> Fixed by copying the members onto the wrapper (`Object.assign(Wrapped, Comp)`) — unwrapped on
> purpose, since `rewrite` only touches `href`/`src` and no namespace member takes either. Guards
> at both layers: `tests/unit/mdx-tenant-urls.test.ts` asserts the members survive the wrap for
> every namespace we ship (verified failing with the fix reverted), and an `editor.spec.ts` case
> loads the Preview route on a page holding `<Color.Item>` and `<Tree.Folder>` and asserts 200 with
> no page errors. The general lesson for this file's gotcha log: **a components-map transform that
> rebuilds entries has to preserve their statics** — the map holds namespaces, not just functions.

---

## 10. Dashboard / Control Plane (supporting v1)

Minimum to operate the SaaS:
- **Auth:** org + user accounts via **Better Auth** (see §11). RBAC: owner/admin/editor/viewer.
- **Workspace / site switcher:** an org may own several sites (§2), so the dashboard's
  **top-left switcher** selects the **active site** that per-site pages (Analytics, Editor,
  Settings) scope to — mirrors hosted docs platforms' top-left switcher. Lists the sites the user can
  access + a **New site** action, which opens the **start-method chooser** (§10.11) — pick
  a Papervine-hosted site or a connected repo — not a repo form. *(Status 2026-06-10: the control plane is now
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
- **Billing:** Stripe; plan tiers + AI credit metering. **Phase 1 landed 2026-07-16 —
  schema + versioned catalog + pure credit core** (`drizzle/0014`, `src/lib/billing/`).
  Design rules (the "easy to reconfigure" requirement, encoded structurally):
  1. **Catalog is data, not code.** Plans, entitlements, credit pools, prices, packs, and
     token→credit rates live in `src/lib/billing/catalog.json`, published to DB by
     `npm run billing:sync` (idempotent; verified by double-run + edit/re-mint in dev).
     Product code reads the org's *pinned* plan version from the DB — no plan constant
     anywhere in app code. Repricing = config edit + sync, not a deploy.
  2. **Append-only where money lives.** `billing_plan_version` rows are immutable
     entitlement snapshots — a catalog change mints a new version; subscriptions pin the
     version they bought, so grandfathering is the default and repricing live customers
     is always a deliberate migration. `billing_price` mirrors Stripe's own immutable
     Prices (archive, never mutate). `credit_ledger` is the credit source of truth —
     never updated or deleted; corrections are compensating `adjustment` entries with an
     actor + reason; `credit_balance` is a derived cache the ledger always outranks.
  3. **Stripe is the billing authority; the DB is the mirror.** Webhooks (recorded in
     `stripe_event`, keyed by Stripe event id → idempotent redelivery) will be the only
     mutation path into subscription state (Phase 3).
  4. **Credits are rated from tokens** via a versioned per-model rate table
     (`credit_rate_version`): usage events record tokens in/out + model + the rate
     version they were billed under, so historical charges stay explainable after a
     rate change. Consumption order trial → monthly → pack; **hard caps by default**,
     overage is an explicit org-level opt-in (`planDebits` in `billing/core.ts`).
  5. **No billing row → Free entitlements, never an error** (`resolveEntitlements`):
     legacy orgs and DB-free render paths (smoke gate) must not throw or gate harder
     than Free. `past_due` keeps entitlements (dunning ≠ cutoff); `canceled`/expired
     trial collapse to Free.
  Lifecycle: every new org starts on a 30-day all-features **trial** (a lifecycle state,
  not a SKU — `listed:false` plan) with a one-time credit grant; expiry lands on Free,
  which has no AI. The pure decision layer (`rating`, `planDebits`, `resolveEntitlements`,
  `trialStatus`, `authorizeAiDecision`) is unit-tested in `tests/unit/billing-core.test.ts`.
  **Phase 2 landed 2026-07-16 — metering + enforcement + trial lifecycle.** Both AI
  routes (`/api/assistant`, `/api/editor-agent`) now gate on `authorizeAi(org, feature)`
  (402 with `upgrade_required` / `out_of_credits`) and meter real token usage in
  `onFinish` via `recordAiUsage` (fire-and-forget, same never-break-the-request rule as
  track.ts; the platform's own docs stay unmetered). New orgs get the trial via the
  `afterCreateOrganization` auth hook; expiry bookkeeping is `/api/billing/expire-trials`
  (hourly Vercel cron, same CRON_SECRET contract as domain reconcile — enforcement never
  waits for it, since `resolveEntitlements` already treats a past-end trial as Free).
  `npm run db:seed` puts dev-org on active Pro with the monthly grant. *Verified live
  2026-07-16 (dev, real Anthropic calls): Pro org answer = 3,885 in / 124 out tokens →
  9 credits debited (calibration target ~10 ✓), ledger row linked to the usage event,
  balance 25,000→24,991; drained org → 402 out_of_credits; drained + overage opt-in →
  200 with monthly bucket driven negative (−9); no-billing-row org → 402
  upgrade_required; real signup → trialing sub + 5,000-credit grant ending +30d; expiry
  sweep flipped status, wrote the −5,000 expiry ledger entry, second run a no-op.*
  **Phase 3 landed 2026-07-16 — Stripe (checkout, portal, webhooks, publish).**
  `src/lib/billing/stripe.ts` (lazy client — everything degrades to "billing not
  configured" without `STRIPE_SECRET_KEY`; see `.env.example`): `publishCatalogToStripe`
  creates Products/Prices for catalog rows lacking Stripe ids (idempotent, append-only,
  mirroring Stripe's own immutable Prices; CLI twin `npm run billing:publish`),
  checkout sessions for plans (subscription mode) and credit packs (payment mode,
  metadata-carried org/pack), and Customer Portal sessions (card/invoice/cancel
  self-serve). `/api/webhooks/stripe` + `src/lib/billing/webhooks.ts` are the only
  writers of paid subscription state: signature-verified, deduped by Stripe event id
  via `stripe_event` (dedupe on *successful* processing only — a failed handler leaves
  `processedAt` null so Stripe's retry gets through instead of being swallowed).
  Monthly credit grants ride `invoice.paid` keyed to the invoice's own period (the
  partial unique index makes cross-period redelivery safe); rollover expires the old
  bucket's remainder (negative remainder = unbilled overage, forgiven in v1 — overage
  *invoicing* is deferred; the opt-in still works, tracked as negative balance).
  Pack grants are double-guarded (event-id dedupe + one grant per checkout session).
  *Verified live 2026-07-16 without a Stripe account — the webhook path only checks an
  HMAC, so signed fixture events drove the real route against the dev DB: bad sig →
  400; invoice.paid same-period → grant no-oped by the unique index; next-period
  invoice → −25,000 expiry + fresh 5,000 grant (org had switched plans; packs
  survived); pack purchase → +5,000 once across two distinct events sharing a checkout
  session; subscription.updated with a mapped price id → plan flipped pro→team;
  payment_failed → past_due (entitlements retained). Real-key checkout/portal flows
  remain unverified until Stripe keys exist.*
  **Phase 4 landed 2026-07-16 — billing surfaces.** Org billing page at
  `/:org/billing` (org-level rail item — the subscription/credits belong to the org,
  not a site): current plan + trial countdown, per-bucket credit meter, plan cards with
  annual/monthly checkout buttons, credit packs, the overage opt-in switch, recent
  usage table. Checkout/Portal buttons hard-navigate (`window.location.assign`) per the
  Host-rewrite gotcha; owner/admin gating is enforced in the server actions
  (`src/lib/actions/billing.ts`), not just hidden in UI. `/admin/billing` (same §10.10
  gate) shows the live catalog (read-only — the catalog's source of truth is
  catalog.json + billing:sync), publishes to Stripe, and hosts the support
  credit-adjustment form — the only manual credit mutation, writing an `adjustment`
  ledger entry with actor + mandatory reason. *Verified in a real browser 2026-07-16
  (light + dark, console clean): trial/active states render, overage toggle
  round-trips UI↔DB, +1000/−1000 adjustment produced actor-attributed ledger entries
  and correct balances, publish button degrades to "STRIPE_SECRET_KEY is not set".*
  Regression: `tests/e2e/billing.spec.ts` (deterministic — seeds its own catalog,
  backfills the trial the way the signup hook writes it, asserts the page + rail
  journey with the editor.spec console-clean pattern).
  **Phase 5 landed 2026-07-16 — public pricing + docs.** `/pricing` rebuilt to the
  locked shape: four tiers (Free $0 · Team $50/mo, $40 annual · Pro $300/mo, $250
  annual, highlighted · Enterprise contact), the 30-day/5,000-credit trial banner, and
  a four-column matrix whose placements mirror `billing/catalog.json` entitlements
  (SSO/RBAC from Team — the 90-day promo is retired; advanced insights/multi-repo from
  Pro; SCIM/services in Enterprise) plus a Limits group (sites/editors/retention) and
  the credit/overage rows. The old Monthly/Annual toggle (`ProPrice.tsx`) is gone —
  both prices show inline. Smoke's `/pricing` check now pins the new anchors and
  *excludes* the dead promo copy. `docs/control-plane/billing.mdx` is the evergreen
  reference (plans, trial, credit buckets + consumption order, hard caps/overage,
  portal self-serve, org-scoped billing, outside hosted billing = no meter). *Verified in-browser
  light + dark 2026-07-16, console clean; `node tests/crawl.mjs docs` 30/30, 0×500.*
  §2's pricing-thesis paragraph is superseded by this section for plan shape; the
  wedge ("all features from day one, security before procurement") is unchanged.
  **Plan switching + downgrade landed 2026-07-17** (gap found dogfooding: no way to
  downgrade). `changePlan` routes by billing state — a live Stripe sub gets an
  in-place `subscriptions.update` with proration (a second Checkout would mint a
  second subscription; the webhook mirrors the switch), everyone else goes through
  Checkout. **Downgrade to Free** = cancel-at-period-end with confirm + resume, on the
  current-plan card; a Stripe-backed sub cancels through Stripe, while a sub with NO
  Stripe backing (dev seed, support-granted) flips directly in the DB and the hourly
  sweep (`expireTrials`, extended) finalizes it at period end — the sweep is the
  period-end biller Stripe would otherwise be, writing the same expiry bookkeeping as
  `handleSubscriptionDeleted`. *Verified live 2026-07-17 (dev-org, non-Stripe path):
  downgrade → confirm → `cancel_at_period_end=true` + "Cancels/Downgrades on Aug 15" +
  Resume; resume → flag cleared, "Renews" restored; lapsed cancellation swept →
  status canceled, −25,000 monthly expiry ledger entry; plan-switch button without
  Stripe keys → clean "isn't configured" error. Regression: the downgrade/resume
  journey is pinned in `billing.spec.ts` (4/4 green). Stripe-backed switch/cancel
  still needs real keys to verify.*
  **Trial visibility + meter semantics (2026-07-17, from dogfooding):** (1) the credit
  meter renders USAGE semantics — "N / M used", bar fills as credits burn, red past
  quota — never remaining-as-full-bar, which a real user read as "all used up"; trial/
  pack buckets are quota-less "N left" lines. (2) During a live trial the rail's AI
  items (Workflows · Agent · Assistant) carry an amber **"Trialing"** pill
  (`trialBadge` on the rail items; the org layout passes a `trialing` flag from
  `getBillingLookup` + `trialStatus`, failing safe to no-pill) so trial-granted access
  is visibly distinct from the plan's own. Both pinned in `billing.spec.ts`; the
  downgrade affordance is a real bordered button after the quiet-text version was
  overlooked in testing. The Settings→Billing change-plan cards also badge the tier the
  trial samples (Pro) with an amber outline + "Trialing until <date>" during an active
  trial — the tier is configurable via `catalog.json` `trial.representsPlanKey` (the
  trial grants Pro-level features, so it shows as trialing Pro).
  **Billing moved into Settings + split (2026-07-17, competitor-parity IA).** The single
  org-level `/:org/billing` page is retired as a standalone rail item and split into two
  site-Settings surfaces under the Workspace nav group (matching hosted-docs-platform
  settings IA): **Settings → Billing** (`/:org/:site/settings/billing` — current plan,
  change-plan cards, portal, downgrade) and **Settings → Usage**
  (`/:org/:site/settings/usage` — credit meter, **Next-reset date**, overage toggle,
  credit packs, recent usage). Data stays **org-level** — both pages resolve `org` via
  `requireSite` and read `getBillingSummary(org.id)`; every site's tabs show the same
  subscription. Shared read model + derivation in `src/lib/billing/summary.ts`
  (`getBillingSummary`/`deriveBillingState`/`getPlanOffers`/`getCreditPacks`); the
  interactive bits (`BillingActions`/`CancelPlanButton`/`OverageToggle`) and the meters
  moved to `src/components/billing/`. `/:org/billing` is kept as a **redirect** to the
  first site's Settings→Billing (Connect if the org has no site yet), which keeps the
  Stripe return URLs — still `${base}/:org/billing`, org-level being the right scope —
  landing correctly without threading a site slug through the billing actions. The
  "Next reset" is the subscription's `currentPeriodEnd` (or the trial's end date), a
  competitor detail we liked. `billing.spec.ts` rewritten to the two surfaces + the
  redirect (6 tests). *Verified in-browser 2026-07-17.*
  **Shared plan content (2026-07-17):** the tier feature bullets + comparison matrix are
  extracted to `src/lib/billing/plan-content.ts` (`PLAN_TIERS`/`PLAN_MATRIX`, keyed by
  planKey — mirrors catalog.json copy) + `src/components/billing/PlanMatrix.tsx` (a
  presentational `.db`-token table with an optional per-tier `renderCta` slot). `/pricing`
  now consumes them (identical output — smoke still pins the same strings) and the in-app
  Settings→Billing surface reuses both: feature bullets on the change-plan cards and a
  "Compare plans" matrix (all four tiers, incl. Free + Enterprise which aren't purchasable
  cards) plus a "View pricing page" link — so plan copy has one source across marketing +
  in-app.
  **Consolidated to ONE editable file (2026-07-17).** The marketing copy that
  plan-content.ts held was folded back INTO `catalog.json` (which already declared itself
  the single source): each plan gains a `display` block (icon name, badge, highlight,
  cta, lead, feature bullets), plus top-level `positioning` and `matrix`. `plan-content.ts`
  is now a typed LOADER over catalog.json — it maps icon names → lucide components,
  **derives** the card price strings from `prices[]` (so a price edit updates the cards
  automatically, no duplicate number), and validates at load. The billing loader
  (catalog.ts) and `sync-billing.mjs` ignore display/matrix/positioning, so **editing them
  does NOT mint a new plan version** (verified: adding all the display data → `billing:sync`
  minted 0 versions) — marketing edits can't reprice legacy customers, only
  entitlement/credit/price edits do. A drift-guard unit test
  (`tests/unit/billing-plan-content.test.ts`) fails if the matrix's numeric/flag claims
  disagree with the enforced entitlements (verified it bites: an injected "Team SSO=false"
  lie failed the feature-flag assertion). Net: **one file to edit for plans, and the
  displayed copy provably can't drift from what's enforced.**
  **Catalog auto-syncs on deploy (2026-07-17).** `vercel.json`'s buildCommand chains
  `node scripts/sync-billing.mjs` after `drizzle-kit migrate` (the build env already has
  DATABASE_URL), so a catalog.json edit publishes to the prod DB the same way a migration
  ships — commit + deploy, no manual step. Idempotent, so it's a no-op when nothing
  changed. Stripe publishing (`billing:publish`) stays OUT of the build deliberately — it
  needs Stripe keys and creates external objects, so it remains a manual/admin action.
  **Stripe verified working locally (2026-07-17, test mode).** With real test keys +
  `stripe listen`: checkout session creation (real `cs_test_` session, customer, correct
  Team $480/yr price), `billing:publish` (real Products/Prices), the Customer Portal
  (real `billing.stripe.com` session), and the full webhook→mirror — a real
  `customer.subscription.updated` (real sub/customer/price ids, real signature) flipped
  dev-org to Team active, plan-version pinned, period end set, and the UI + rail
  reflected it (trial pills gone). Real-signature verification confirmed on live
  forwarded events. **Setup gotcha (now in `.env.example`):** `stripe listen` must use
  `--api-key $STRIPE_SECRET_KEY` — `stripe login`'s default account can differ from the
  app key's account, and if it does the app's webhooks fire in one account while the
  forwarder watches another, so nothing mirrors (this bit the first attempt). Only the
  final "Subscribe" click on Stripe's hosted Checkout can't be automated — Stripe blocks
  bot submissions (it now surfaces an "I am an AI agent" checkbox) — but checkout
  creation and the post-completion webhook are both proven, so a real human purchase
  works. Credit-rate calibration against real token logs is still the remaining pre-GA item.
  **Admin plan comps landed 2026-07-18 (support lever).** The `/admin/billing` console
  gains a **Grant plan** form beside credit-adjustment: put any org on a paid plan for
  free (partner/support comps). It reuses the non-Stripe subscription shape the seed and
  downgrade path already understand — `store.grantPlan` upserts an `active` sub with
  `stripe_subscription_id = NULL`, pins the latest plan version, and grants the plan's
  included monthly credits with an actor-attributed `grant_monthly` ledger entry
  (idempotent per period via the unique index). **Blank months = indefinite** comp (no
  period end, never swept); **N months** sets `cancel_at_period_end=true` + a period end,
  so the existing `expireTrials` non-Stripe branch lapses it to Free — no new sweep. The
  period math is the pure `compGrantPeriod(now, months)` in `core.ts` (unit-tested:
  indefinite vs time-boxed, fractional truncation). Downstream is unchanged: entitlements
  resolve from the pinned version, and the org downgrades the comp from its own
  Settings→Billing. Free/trial are rejected (Free is a downgrade, trial is the signup
  lifecycle); the picker offers only Team/Pro/Enterprise. *Verified in a real browser
  2026-07-18 against the dev DB: Acme→Pro indefinite (`cancel_at_period_end=false`,
  no period end, 25,000 monthly credits, reason on the ledger) and Beta Co→Team 2-month
  (`cancel_at_period_end=true` + period end set, 5,000 credits). Regression:
  `tests/e2e/admin.spec.ts` grants Team through the UI and asserts the non-Stripe sub +
  monthly grant + actor/reason in the DB.*
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

> **Status 2026-08-23 — Vercel Analytics is ours, and stops at the tenant boundary.**
> `@vercel/analytics` (`<Analytics/>`) is mounted in the ROOT layout, which is the only place
> that covers every surface we own — apex marketing, pricing, signup, and the app-host dashboard.
> But that same root layout also renders **every tenant's docs site**, so it is gated on
> `isTenant` (derived from the `requestContentSource()` the layout already resolves; false on the
> apex and on the app host). Ungated it would put a third-party beacon on customers' pages, bill
> their readers' traffic to our Vercel quota, and double-count against the first-party
> `analytics_event` pipeline below — which is the tenant-facing product and stays the only thing
> measuring tenant traffic. The two never overlap: Vercel Analytics measures *our* funnel,
> `analytics_event` measures *their* docs.
>
> Pinned by a browser test (`tenant-render.spec.ts`), not the smoke gate: `<Analytics/>` injects
> its script client-side, so there is nothing in the server-rendered HTML to assert on — a
> markup-based `exclude` would have passed whether the gate existed or not. The test watches for
> both the injected tag and any request to `/_vercel/insights` from a tenant page.
>
> **Chatwoot live chat (2026-08-24)** joins them behind the same `isTenant` gate, for a sharper
> reason than either: it's a support inbox WE staff, so on a tenant's docs site it would invite
> THEIR readers to open conversations with us about a product they've never heard of — and it
> would fight the tenant's own assistant launcher (§8.6) for the same corner. Installed as the
> documented script snippet, not an npm package: the SDK is served by the Chatwoot instance
> itself, so a package would wrap a script tag and add a dependency for nothing. Both
> `NEXT_PUBLIC_CHATWOOT_BASE_URL` and `NEXT_PUBLIC_CHATWOOT_TOKEN` are required; either missing
> renders nothing, which keeps local dev out of the live inbox. The mount guards on the script's
> element id rather than a module flag, because a client-side navigation can remount the component
> and running the SDK twice mounts two launchers — verified as exactly one SDK request per page.
>
> **LogRocket session replay (same date) covers every surface we own, and stops there.** Init is
> in the ROOT layout behind the same `isTenant` gate as `<Analytics/>`, so replay reaches
> marketing, pricing, the auth pages, onboarding, `/admin` and the dashboard — but never a
> tenant's docs site, where it would be recording our customers' *readers*. `identify` still runs
> from the dashboard layout, the only place a session exists; the two mounts share one init via a
> module-level promise in `logrocket-client.ts`, because React runs a child's effects BEFORE its
> parent's and the identify call would otherwise fire first.
>
> Measuring this taught a lesson worth keeping: **neither obvious detector for "is LogRocket
> running" is sound.** A Next chunk is *named* after the dependency
> (`node_modules_logrocket_...js`), so matching request URLs on "logrocket" false-positives on
> every page that merely bundles it; and `window.LogRocket` is only set by the UMD script build,
> not by a module import, so it false-negatives everywhere. Both fooled an intermediate check in
> opposite directions. The sound signal is a request to LogRocket's own hosts —
> `cdn.logr-in.com` (recorder) and `POST r.logr-in.com/i` (ingest). Verified that way: present on
> all seven of our surfaces, and a tenant page makes NO cross-origin requests at all.
>
> Originally scoped to the dashboard layout only: Replay records the DOM, network and console, so the tenant boundary matters more
> here than for pageview counting: in the root layout it would record our customers' *readers*
> browsing their docs. `app/[org]/layout.tsx` is both the only place it's wanted and the only
> place there's a signed-in user to `identify` — so the mount point supplies the identity for
> free (id, name, email, subscription status; `getBillingLookup` already fails safe).
>
> Two guards are the actual content of the change. The app id comes from
> `NEXT_PUBLIC_LOGROCKET_APP_ID` and is **never a literal** — this codebase is deployable by
> others, and a hardcoded `nnm/papervine` would stream a self-hoster's users' sessions into our
> project; absent env var means the component renders nothing, which also keeps dev machines off
> the quota. And `dom.inputSanitizer` is forced **on**, because dashboard forms hold real
> credentials (the GitHub token, widget keys, the reader-auth JWT secret) and replay records input
> values by default — masking is the only safe posture on this surface.
>
> Verified at runtime rather than by reading the mount point: a second dev server on its own
> distDir with the id set (the isolated-distDir work makes that cheap) confirmed replay loads on
> the dashboard and the editor and loads on *neither* tenant serving mode nor the apex. The
> masking itself is configured, not verified end-to-end — that needs a real project and a replay.

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

> **UI relabel (2026-07-22): the left rail is renamed to its own identity** (was too close
> to the inspiration's). Routes and internal names are unchanged — this is display-label +
> icon + section-heading only, in `AppRail.tsx` and the matching page headers/docs. Mapping
> (old → new): Home→**Overview**, Editor→**Studio**, Analytics→**Insights**; section
> "Automate"→**"Autopilot"** with Automations→**Routines**, Agent→**Teammate**,
> Assistant→**Ask**; section "Admin"→**"Workspace"** (MCP kept), Platform Admin→**Operator**.
> Design-log prose below keeps the original names; the product surfaces the new ones.

The **Automate** rail section groups the three surfaces where Papervine *acts on* the
docs instead of just rendering them. All three mirror hosted docs platforms' "Automate" area and are
gated behind a per-org **Trialing** entitlement (the rail/page badge). **Status
(2026-06-10): UI scaffolded, nothing wired.** The pages render the catalog, onboarding,
and empty states (`/dashboard/automate/{workflows,agent,assistant}`); none of the
toggles, prompts, or inputs post anywhere yet. This section is the speculative target the
scaffold is shaped toward — record decisions here as we build, don't treat it as built.

> **Decision — Automations architecture (2026-07-19).** Studied the reference's shipped
> surfaces (Automations catalog + per-automation config modals, workspace-level
> Integrations settings, agent-integration docs). Recorded before slice 1 lands:
>
> - **Rename "Workflows" → "Automations"** (nav `Automate › Automations`; tabs
>   `Configure | Automations`, the second being run history), matching the reference's
>   shipped naming. The scaffold's "Workflows" naming migrates as slice 1 touches each
>   surface.
> - **One run primitive, three frontends.** An *agent run* is `{ trigger, context,
>   prompt, applyMode, output }`. Automations (cron/event trigger → commit/PR), Agent
>   (Slack `app_mention` → thread reply ± PR), and Assistant (in-docs question → answer)
>   are thin frontends over the same core; all writes go through the §9.2 shared
>   authoring backend, never a parallel write path.
> - **Executor: Trigger.dev Cloud.** The §2 executor-choice trigger condition is met —
>   this is the second background-job use case, and multi-minute sandboxed agent runs
>   with git checkouts can't live in Vercel functions. Intent stays in Postgres
>   (`automation` config + `automation_run` history); Trigger.dev is the projection that
>   executes it, so the executor remains swappable (Inngest/Temporal/run it yourself) per §18.
>   Toolchain landed 2026-07-19: `trigger.config.ts` + `src/trigger/` (project
>   `proj_rjriwuagrstnzwseaytk`), verified end-to-end (local worker registered;
>   `hello-world` run triggered and completed).
>   *Isolation rule:* no existing gate may depend on Trigger.dev. Run-core logic
>   (trigger evaluation, config parsing, apply-mode, prompt assembly, credit accounting)
>   is pure modules behind an executor interface — unit-tested with no executor; no
>   executor configured ⇒ automations show "not configured", never a broken control
>   plane; e2e specs needing real runs `test.skip` unless their env is set (the collab
>   service pattern).
> - **Context model, two tiers.** Repos are **cloned into the run environment**: the
>   docs repo plus optional *context repositories* (read-only clones that never trigger).
>   Integrations are **live read-only API calls** through org-level OAuth connections at
>   run time — no advance indexing, no durable copy, permissions inherited live from the
>   authorizing account (disconnect = instantly revoked). Only first-party docs content
>   is indexed (§6/§8). Consequence: *trigger repositories* ("PR targets the base branch,
>   or direct push") and context repos require the GitHub App connection model to support
>   **multiple repos per site/org** — the biggest new plumbing this feature adds.
> - **Uniform config schema** — predefined automations are presets over one shape:
>   `{ trigger: content_update | cron | code_change` (+ cron expression | trigger repos)`,
>   applyMode: auto` (commit directly) `| review` (open a PR)`, contextRepos,
>   additionalPrompt` (appended to the base prompt every run)`, extras }` (e.g. translate
>   target locales). Catalog metadata per automation: `allowedTriggers`,
>   `recommendedTrigger`, `recommended`, `defaultEnabled`. Cron UX: preset chips + raw
>   cron field + human-readable timezone preview. A manual **run-now** affordance exists
>   alongside cron/webhook triggers (also how you test an automation).
> - **Billing.** Every run is metered: `automation_run` records credit usage and debits
>   the plan's AI credits (§10 "Billing" catalog: `includedMonthlyCredits` / credit packs);
>   config surfaces say "billed by usage with credits".
> - **Build order.** (1) Run core + `Fix broken links` on the content-update trigger,
>   end-to-end (needs only the docs repo and our own sync as the trigger — exercises the
>   whole spine: trigger → queued run → checkout → agent → apply-mode → run history →
>   credit debit); (2) cron + config modals + code-change triggers/context repos;
>   (3) Agent over Chat SDK/Slack (§18); (4) integrations connection store + tool layer.
>
> **Status — slice 1 landed (2026-07-19): the spine works.** Four commits: toolchain,
> domain model, run service + sync hook, and the wired surface.
> - *Run core:* `src/lib/automations/` — catalog (9 presets + trigger matrix + pure
>   config validation), prompt assembly, executor seam (`getExecutor()` null without
>   `TRIGGER_SECRET_KEY`), and the run service (enqueue idempotent on
>   automation+trigger+ref; executor rejection = visible failed run; nothing persists
>   when unconfigured). `fireContentUpdateAutomations` hooks the sync-runner success
>   block. 40 unit tests on injectable stores, no DB/executor.
> - *Executor task:* `src/trigger/automation-run.ts` — loads the run, gates on
>   `authorizeAi(org, "workflows")`, checks out a §9.2 session, runs `generateText`
>   (read tools + write_page/edit_page/delete_page; the agent never publishes), then
>   deterministically applies per applyMode via `publishDraft` (auto→commit,
>   review→PR); meters `usage_event` by `requestId = runId` and rolls the credit sum
>   onto the run row. The Next-tangled stack loads in plain Node via esbuild stubs for
>   `server-only` + `next/cache` (trigger.config.ts).
> - *Surface:* route renamed `automate/workflows → automate/automations`; Configure tab
>   wired (optimistic toggles create rows with catalog defaults; settings dialog covers
>   the full schema; custom automations create/edit/delete), run-history tab, Run now,
>   and an executor-unconfigured banner. Mounted the missing dashboard-wide sonner
>   `<Toaster>` (org layout) — action errors were invisible before. E2E:
>   `automations.spec.ts` (catalog render, toggle persistence, dialog, run history,
>   console-clean gate).
> - *Verified:* in-browser (seeded login, light+dark; config save confirmed in psql;
>   run-now degradation toast; history rendering a real failed run); a dev-executor run
>   executed the full lifecycle (queued→running→failed with the error captured, session
>   discarded). **Agent loop verified 2026-07-19 via the AI Gateway** (§18 provider
>   config): a real fix-broken-links run on `papervine/starter` found and fixed an
>   actual broken Quickstart href across two pages (drafts in the session buffer),
>   returned a coherent summary, and metered 55k/2k tokens → 123 credits
>   (`usage_event` feature `workflow`, requestId = run id; ledger debited −123 trial).
>   The run then failed at publish with GitHub `createTree 401` — **expected**: dev
>   starter had no write creds.
>   **Publish verified 2026-07-20 — the loop is fully closed.** With a fine-grained
>   PAT (Contents+PR write) on a connected site, a UI Run-now produced an
>   agent-authored commit on the real `papervine/starter`
>   (`c51359c "[automation] Fix broken links"` — a genuine fix to a genuinely broken
>   Quickstart href), and an immediate second run correctly finished "no changes
>   needed" (resultRef null). So every stage is live-verified: UI enqueue
>   (`TRIGGER_SECRET_KEY`) → executor → agent via gateway → drafts → publishDraft →
>   real Git → run history. Only PR-mode's incremental delta (createBranch +
>   openPullRequest, unit-tested) hasn't produced a live PR — the broken link is now
>   fixed, so fix-broken-links has nothing left to draft. PAT gotcha for the docs:
>   fine-grained tokens need **Contents: Read and write** (`createTree` 403s with the
>   header naming the missing permission) and the org as resource owner.
> **Measured cost per run (2026-07-20) — the scaling risk.** First real spend data,
> from a day of dev testing against the 9-page `papervine/starter`: 42 runs consumed
> **2.09M input / 77k output tokens** — averaging **~57k input tokens per run** on
> haiku, ≈$0.10–0.12/run, and it exhausted a $5 gateway balance. The driver isn't the
> content, it's the shape: an agentic loop makes ~15 model calls per run and each call
> resends the accumulated conversation, so "read the docs, then edit" costs
> pages × steps. **This does not scale linearly to real customers** — a 200-page site
> would multiply the base, and every automation re-reads from scratch on every trigger.
> Credit rating currently covers it (haiku: 795 credits ≈ $6.36 retail against a few
> dollars of spend).
>
> **Guardrails landed 2026-07-20** (a deliberate `* * * * *` stress test ran **88 ticks
> over 2h11m** and was still firing when we caught it — the only thing that stopped the
> spend was the provider running out of money):
> 1. **Skip-unchanged** — an automated run is abandoned before any model call when the
>    site's head sha equals the one the automation's last *successful* run saw
>    (`automation_run.source_sha`, migration 0017). Catalog-aware: entries carry
>    `inputs: ["docs"] | ["docs","external"]`, and only docs-only automations may skip —
>    a changelog/feedback/code-change automation's input moves while the docs sit still.
>    Nightly crons on idle docs now cost **zero**, which is where nearly all of the 88
>    wasted runs went.
> 2. **Daily run cap** — 500/automation/24h matching the reference (they document
>    "runs that fail do not count"); we count only runs that *reached the model*, so a
>    failing automation may retry while a spending one cannot run away. Manual Run-now
>    is never capped.
> 3. **Prompt caching** — the constant prefix resent across ~24 agent steps bills at
>    cache-read rates. **Provider-agnostic since 2026-07-21:** on the gateway route
>    `aiProviderOptions` sets `gateway.caching:'auto'` (implicit for Google/OpenAI/DeepSeek;
>    the gateway auto-injects Anthropic `cache_control` breakpoints — tail + stable prefix,
>    built for tool-use loops), so caching survives *any* `PAPERVINE_AI_MODEL*` choice, not
>    just Anthropic. The direct route (`AI_ROUTING=direct`) still uses
>    `anthropic.cacheControl` (ephemeral, 1h); the two are mutually exclusive so Anthropic
>    never gets both auto- and hand-placed markers. This retires the §"AI assistant" caching
>    follow-up and unlocks cheap non-Anthropic automations models (e.g.
>    `google/gemini-2.5-flash-lite` at $0.10/$0.40) without losing the cache discount.
>
> *Deliberately not a minimum cron interval:* the reference documents no floor (only
> "queues within 10 minutes of the scheduled time" + the 500/day cap), and a per-minute
> schedule is the user's business — the cap plus skip-unchanged bound the damage without
> forbidding it.
>
> Still open: (a) scope `content_update` runs to the **changed files** rather than the
> whole site — the deeper fix for the ~57k-token base cost; (b) prefer targeted
> `searchDocs` over exhaustive `listPages`+`readPage` in the run prompt; (c) a
> credit-burn warning before the balance cliff.
>
> **Model selection is backed by a committed eval (2026-07-22).** `evals/` (`npm run eval`)
> runs candidate models through the real read→edit agent loop over a fixture corpus with
> planted grammar/typo errors and scores accuracy, over-editing, and code-safety. Not a CI
> test — it calls paid, non-deterministic gateway models (needs `AI_GATEWAY_API_KEY`) —
> run on demand when choosing an automations model. First bake-off (grammar-typos, 9 planted
> errors): **`deepseek/deepseek-v4-flash` 9/9, 0 over-edits, ~$0.001/run**; `claude-haiku-4.5`
> also 9/9 but ~12× the cost; **`gemini-2.5-flash-lite` was worst — 7/9, over-edited, and
> corrupted a technical term ("renderer"→"deployer")**, a caution that "cheapest slug" ≠
> "cheapest in practice" when a bad edit ships as a commit. Provisional pick: DeepSeek-flash
> (weigh its provenance for a customer-facing SaaS), Haiku as the premium fallback. Keep
> `Require review` regardless. Re-run with `--runs=3` before committing the env var.
> Broadened to an 8-model default set (2026-07-22: + gpt-5-nano, mistral-small, gpt-4o-mini,
> deepseek-v4-pro, gemini-3-flash): DeepSeek-flash held 9/9 across every run; gemini-2.5-flash-lite
> is confirmed high-variance (8/9 → 7/9 → 2/9); `deepseek-v4-pro` matched flash at 2.5× cost;
> gpt-5-nano was perfect but 34s (too slow interactive); gemini-3-flash fixes the flash-lite
> over-editing but costs more. A local web UI (`npm run eval:web`) renders the same live.
>
> **Status — in-app review landed (2026-07-22): `Require review` is now an in-app draft, not
> a PR.** Inspired by the reference's Accept / View-changes flow. Instead of publishing a PR at
> run end, a `review` run leaves its `editor_session` open (the buffered `draft_file` overlay in
> Postgres — the same object a human editor's draft is) and ends `review_needed`, storing
> `automation_run.review_branch` (migration 0019). The run row / detail show **Accept** →
> `publishDraft(commit)`, **Reject** → `discardSession` (both existing authoring-core calls, with
> the optimistic base-SHA guard), and **View changes** → the editor at `?branch=<review_branch>
> &review=1&slug=<first changed page>`, which auto-opens the existing line-level `DiffView` (base
> S3 vs draft overlay). The terminal decision is a pure `applyOutcome()` (apply.ts, unit-tested);
> `run-display` gained `review_needed`/`rejected` chips. Decision (locked): **Accept = commit
> only, no PR path** (re-addable as an Accept option later). *v1 limitation:* a pending review
> doesn't suppress the automation's next scheduled run — accept/reject to clear. The genuinely-new
> "inline strikethrough diff in ProseMirror" (the reference's exact look) is deferred; the split
> `DiffView` is the v1.
>
> **Status — slice 2a landed (2026-07-19): cron scheduling.** Schedules live on the
> executor as a projection (`schedules.create` with `deduplicationKey` = automation id
> → idempotent upsert; `externalId` = automation id), registered/deregistered by
> `syncAutomationSchedule` from every config mutation (save / toggle / delete —
> failures surface as action *warnings*, config stays saved). The `automation-cron`
> `schedules.task` re-checks intent in Postgres on every tick — a tick for a
> deleted/disabled/re-triggered automation self-cleans its own schedule — then
> enqueues a normal run with `triggerRef = cron-<tick timestamp>` (redelivered ticks
> dedupe). Verified in dev via simulated ticks: enqueue→chained agent run, duplicate
> tick → `duplicate`, stale tick → `stale schedule`. *Unverified:* real
> `schedules.create` registration from the app actions — the dev Next app has no
> `TRIGGER_SECRET_KEY` yet (grab the `tr_dev_…` key from the Trigger.dev dashboard;
> that also unlocks run-now/content_update enqueues from the dev app).
>
> **Status — slice 2b landed (2026-07-20): code-change triggers + context repos.**
> The trigger matrix is complete. (1) `github.ts` gains read-only `getRepoFile` /
> `listRepoTree` (plain-Node, Trigger-bundle-safe). (2) The push webhook, after its
> site-sync loop, resolves `payload.installation.id → github_installation → org` and, in
> `after()`, calls `fireCodeChangeAutomations(owner/repo, orgId, {repo,sha,changedFiles})`
> — org-scoped so two tenants referencing the same public repo don't cross-trigger; runs
> independent of site sync (a trigger repo need not be a synced site). Matching is
> case-insensitive; idempotent per push sha; never throws (can't 500 the webhook). (3)
> `automation_run.trigger_context` (jsonb, migration 0018) carries the push to the task,
> which threads it into `buildRunPrompt` (what changed) and mounts read-only
> `list_repo_files`/`read_repo_file` tools (`repo-tools.ts`) scoped to the automation's
> context+trigger repos, reading the trigger repo at the push sha and context repos at
> default branch, authenticated by the installation token. (4) Save-time guard: a
> code_change automation (or any with contextRepos) requires `site.githubInstallationId`,
> else a clear error. **Requires the GitHub App** — webhooks and repo reads both need it;
> PAT/public sites can't use these triggers. Unit-tested throughout (fan-out matching +
> org-scoping + idempotency with injectable store; github reads with mocked fetch; prompt
> change-context); e2e proves the webhook 202s and org-resolves for a code_change repo no
> site syncs (executor-blank ⇒ no run row, same degradation as content_update).
> *Unverified live:* a real push → run needs the GitHub App installed in dev (same gap as
> publish); the read tools are exercised only when a run has an installation token.
>
> **Ops — the executor is a separate deploy (2026-07-20).** `TRIGGER_SECRET_KEY` lets the
> app *enqueue*; the tasks run on Trigger.dev's cloud and exist there only once published
> with `npx trigger.dev deploy`. This is distinct from the Vercel deploy — the first prod
> automation run surfaced "Run cannot execute until a version includes the task and queue"
> (i.e. enqueued, no published version). Fixed by wiring a CI `deploy-trigger` job
> (`.github/workflows/ci.yml`) that runs `trigger.dev deploy` on every push to main, gated
> on `verify` (a bundle failing typecheck/unit/build/smoke never ships) and skipped without
> a `TRIGGER_ACCESS_TOKEN` secret — so a main push now deploys both halves atomically. v4
> builds remotely (no Docker on the runner). Locally, `npx trigger.dev dev` runs the tasks
> from the dev machine, so no deploy step there.
>
> **Ops — the executor needs its own env, kept in sync from Vercel (2026-07-21).** The
> deployed task runs in Trigger.dev's cloud and does *not* inherit Vercel's env; its import
> graph (authoring/billing/db/renderer) reads `DATABASE_URL`, the `S3_*` draft-buffer creds,
> the AI route, and the `GITHUB_APP_*` keys. The first prod run failed on its very first
> query (`Failed query … from "automation_run"`) because the Trigger prod env lacked
> `DATABASE_URL` — proven a config gap, not code: the app's insert (which *sets*
> `trigger_context`) had succeeded, so the column exists in the DB the app writes to; the
> task was hitting a different/unconfigured DB. Fix: `syncVercelEnvVars()` in
> `trigger.config.ts` mirrors the Vercel project's env into the matching Trigger environment
> (prod→production) at deploy time, gated on the deploy shell providing `VERCEL_ACCESS_TOKEN`
> + `VERCEL_PROJECT_ID` (CI sets them from secrets; a local deploy without them skips the
> sync; the dev target is self-skipped). Best-effort: the core catches a bad/expired token
> and warns rather than failing the deploy — so a broken token drifts *silently*, which is
> the one thing to watch. Manual dashboard vars remain a valid alternative to the sync.
>
> - *Follow-ups:* verify run→publish with real write creds; mint a durable
>   `AI_GATEWAY_API_KEY` for the deployed executor (OIDC expires); cron scheduling (Trigger.dev
>   schedules API — `executorScheduleId` is ready for it) and code-change webhooks are
>   slice 2; the pre-existing AppRail "Switch site" radix-id hydration warning fires on
>   every dashboard page (excluded from the e2e console gate; fix separately). ~~pricing
>   matrix label still says "Workflows"~~ — renamed to "Routines" (2026-08-09), matching the
>   nav; pure display copy in `catalog.json`, so no new plan version (`sync-billing.mjs`
>   ignores this field, per §10 Billing above).
>
> **The run list (`?tab=runs`) and run-detail pages update live as a run progresses
> (2026-08-09).** Both were pure Server Components — a snapshot at load time, unchanged until a
> manual reload or an in-page mutation's own `router.refresh()` (Accept/Reject). A run started
> elsewhere (a scheduled trigger, a push webhook, another tab) never appeared without reloading.
> Reused the existing Activity-feed realtime plumbing (§10.3) rather than building anything new:
> `automation-run.ts`'s task now calls the same `triggerActivity(siteId)` the sync runner already
> publishes on every status write (running/succeeded/failed/canceled/review_needed) — one
> generic per-site "something changed, go re-read it" signal, empty payload, DB row stays the
> record. A new `RunsLiveRefresh` (mounted on both pages, renders nothing) wires that into
> `router.refresh()` via the existing `useRealtimeRefresh` hook — same realtime-first +
> poll-fallback shape as `BuildingPreview`. No new infra: same Pusher/Soketi channel, same client
> hook, same strict-enhancement contract (unconfigured → falls back to a plain 5s poll, never
> blocks or errors). Verified live: seeded a run row, flipped its status via direct DB write +
> a manual `triggerActivity` call while both pages sat open in a real browser — the list row and
> the detail view updated within ~3s with no reload, confirming the realtime path fires (not
> just the poll fallback). No new automated test: the executor task has no existing unit-test
> harness (its status writes are exercised only end-to-end, never mocked — the enqueue *decision*
> logic in `lib/automations/runs.ts` is what's unit-tested), so adding one for a same-shape
> side-effect call would be new test infrastructure disproportionate to the change; `realtime.ts`'s
> own unit tests already cover `triggerActivity`'s no-op-when-unconfigured contract.

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
  *(§10.11: Sync and the repo/branch rows are **Git-backed only** — there's nothing to
  re-sync from on a Papervine-hosted site, which shows a **Source: Papervine — edited in
  Studio** row in their place. The commit-sha links in the Activity feed already degrade
  when there's no repo URL.)*
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
> **Why this shape:** Vercel functions can't hold a WebSocket open, so a socket server we run
> ourselves isn't deployable on our target — the working pattern is a *protocol* that's identical
> in both environments with a managed equivalent in prod, the same swap we already do for Postgres
> (docker→Neon) and object storage (MinIO→R2). We chose the **Pusher protocol**: **Soketi**
> (run ourselves) in `docker-compose` locally, hosted **Pusher Channels** in prod — same `pusher` /
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
infra); because Papervine's renderer works standalone, `papervine build` (static export of a
docs repo) is a genuine differentiator and a natural fit for the renderer-only package.

**v0.1.0 command surface** (each maps to renderer machinery we already have; ship in this
order, smallest lift first):

| Command | Does | Reuses |
| --- | --- | --- |
| `papervine dev [dir]` | Local preview; edits show on refresh, no HMR (**built, prebuilt tarball**) | `bin/papervine.mjs` → the packed `server/server.js` + `PAPERVINE_CONTENT` |
| `papervine new [dir]` | Scaffold a site from the starter (**built**); `dev` also offers it when there are no docs | the `examples/starter` template, bundled by `prepack` |
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
>
> **Status (2026-08-23):** made the CLI actually publishable, and **changed how it ships** —
> the tarball now carries a **prebuilt** renderer instead of source + a runtime `next dev`.
> Publish is still deferred (see the handover at the end of this note).
>
> **Why prebuild.** Shipping `src/` + configs and running `next dev` from inside
> `node_modules` meant every user paid a ~40s first-run compile *and* needed a TypeScript
> toolchain the package never declared — Next would have tried to self-install one into the
> npx cache. So `prepack` now runs `next build` with `output: "standalone"` and packs the
> result; `bin/papervine.mjs` spawns the compiled `server/server.js`. Measured: **ready in
> ~1.3s** from a real tarball install, no toolchain fetched, `dependencies` empty. Cost:
> **23.9 MB packed / 102 MB unpacked** (vs. 7.3 kB), and **no HMR** — pages are
> `force-dynamic` and re-read content per request, so an edit appears on refresh. `standalone`
> specifically (not a plain build) because it's the only mode designed to be *relocated* to
> another machine: it traces imports and copies a pruned `node_modules`, which is what lets
> the package declare zero runtime deps.
>
> **Four bugs that only exist once published**, none visible to any pre-existing suite —
> they all pass because the workspace's hoisted `node_modules` is in scope:
> - **`shiki` was imported but never declared** by `@papervine/renderer` (`lib/highlight.ts`,
>   added after the dep audit this section records as "exact — nothing missing"). Resolved by
>   hoisting in the monorepo; unresolvable standalone. Now declared, pinned to `1.29.2`.
> - **Turbopack symlinks its `serverExternalPackages` aliases.** It rewrites
>   `@mintlify/mdx` to a content-hashed `build/node_modules/@mintlify/mdx-<hash>` and makes it
>   a *symlink*. `npm pack` drops symlinks, so the tree ran fine from a checkout and 500'd
>   every page once installed from a tarball ("Failed to load external module"). Fixed by
>   copying with `dereference: true`, and prepack now **fails if any symlink survives** into
>   the packed output.
> - **The build reached across the packaging boundary and leaked a production secret.**
>   Turbopack's project root resolves to the monorepo root (it *must* equal
>   `outputFileTracingRoot`, which has to be the root for the workspace renderer to be traced —
>   Next warns and overrides otherwise), so the CLI compiled the **web app's**
>   `src/instrumentation.ts`, and with it `sentry.server.config.ts` and its **hardcoded
>   production DSN**, into the tarball. Every `npx papervine` user's errors would have reported
>   into the hosted Sentry project, from a public artifact. Fixed with a deliberately empty
>   `apps/cli/src/instrumentation.ts` that shadows it — the CLI has no telemetry by design.
>   This is the sharpest argument yet for §10.6's "physically absent, not disabled at runtime":
>   a `files` allowlist would not have caught it either, because the leak was *compiled in*.
> - **`loadConfig()` throws with no docs repo in scope**, which is right for a tenant site and
>   fatal at CLI build time (Next always prerenders `/_not-found`, which renders the root
>   layout). Handled app-locally via `loadBuildSafeConfig()` rather than softening shared
>   renderer semantics; the fallback is unreachable at runtime because the bin refuses to start
>   without a `docs.json`.
>
> **Also fixed/decided:** `packages/renderer`'s stale `phishy/papervine` repo URL (provenance
> validates it); `next` aligned to `^16.3.0` across the workspace (was `^15.5.19`, so the
> lockfile carried a second nested `next@15.5.23`) and `engines.node` to `>=20.9.0`;
> `publishConfig` added; **version `0.1.0`**, not the `0.2.0` briefly in the tree, since this
> section and the published placeholder both promise `0.1.0`. `outputFileTracingExcludes` was
> tried for the over-trace and **does not work** — the whole-project fallback triggered by
> `content.ts`'s runtime-computed reads ignores it (verified on 16.3) — so prepack prunes
> explicitly, and only *our* sources: pruning `node_modules` by size looked free and broke
> everything, because `@mintlify/mdx` imports `typescript` at runtime for twoslash.
>
> **Tests.** The bin had **zero** coverage. Now: its decision core is extracted to
> `apps/cli/bin/args.mjs` and unit-tested (`tests/unit/cli-args.test.ts`, 15 cases), and
> `tests/cli-package.mjs` is a **clean-room gate** — packs both tarballs, audits the listing
> for control-plane code and for a leaked Sentry DSN, installs into a temp dir *outside* the
> repo, and serves `docs/` through the installed binary (pages, nested nav, stylesheet, a
> docs-repo asset, a 404). It is the only layer that can see this whole bug class, so it gates
> the release. Deliberately out of `npm test` (it runs a full build).
>
> **Verified:** root + `apps/cli` typecheck clean; unit **981/981**; smoke all green; crawl of
> `docs/` **41/41, 0 × 500**; clean-room gate green; browser-checked light **and** dark with a
> **clean console**; an MDX edit confirmed visible on refresh.
>
> **Reversal: `@papervine/renderer` is NOT published** (`private: true`). This section's
> earlier plan to publish it (and the "publish vs. `bundledDependencies`" deliberation) was
> settled by the prebuild decision, which made the question moot: the renderer is *compiled
> into* the CLI tarball, so it's a build-time dependency and nothing installs it. Publishing it
> would commit us to a second versioned public artifact plus a stable subpath API it doesn't
> have (`index.ts` is `export {}`, deep imports only, no `exports` map, ships raw TSX) to serve
> an embedder who doesn't exist yet. The publish workflow ships one package; revisit if someone
> actually wants to embed the renderer. Consequence worth noting: an undeclared renderer
> dependency (the `shiki` bug) now surfaces as a missing module *inside the bundle* rather than
> a failed install — which is why the clean-room gate has to exercise the built tarball, not a
> dependency listing.
>
> **The published tarball contains no source.** Only compiled bundles; the four shipped
> `.js.map` files are empty (0 `sources`, 0 `sourcesContent`), so no original TS/TSX is
> distributed. Relevant to the source-availability question, and worth re-checking if the build
> ever turns on productionBrowserSourceMaps or ships `build/server/chunks/*.map` — those *do*
> carry full `sourcesContent` (it's how the Sentry DSN leak above was read back out).
>
> **The publish workflow lives in `papervine/cli`, not here.** It moved out of
> `.github/workflows/publish.yml` (deleted) into the mirror templates
> (`scripts/mirror-cli/workflows/publish.yml`), so it is generated into the public repo and
> triggered by a `v*` tag *there*, gated on that repo's typecheck + unit + `test:cli`. Reason:
> npm validates that a package's `repository` field matches the repo the workflow runs in
> ("Ensure your package.json is configured with a public repository that matches
> (case-sensitive) where you are publishing with provenance from"), and `apps/cli/package.json`
> points at `papervine/cli` — a publish from the monorepo is rejected on that mismatch. It's
> also the right home on the merits: an attestation is only worth something if it points at a
> repo the reader can open. So `NPM_TOKEN` goes on **`papervine/cli`**, not here.
>
> **Correction — provenance does NOT require a public git repository.** An earlier version of
> this note claimed it did; that was wrong, and it matters because it made "flip the repo
> public" look like a precondition for shipping. The only visibility gate npm enforces is on
> the **package** (`libnpmpublish/lib/publish.js`, `ensureProvenanceGeneration`: `if
> (!visibility.public && opts.provenance === true && opts.access !== 'public')` — that
> `visibility` is fetched from `/-/package/<name>/visibility`, the npm package, not the repo).
> The real prerequisites are: a supported CI (GitHub Actions or GitLab), `id-token: write`, and
> `--access public`. So the CLI can be mirrored, reviewed, and even published while
> `papervine/cli` is still private; going public is about provenance being *useful* to a
> reader, not about permission. Note that `--provenance` does write the repo URL and commit sha
> into Sigstore's public transparency log — identifiers only, not code.
>
> **Decision (2026-08-23): the CLI is MIT open source in its own public repo,
> `papervine/cli`.** Not the monorepo made public — that carries this SPEC, pricing/billing
> internals and the whole control plane, and public git history is irreversible. The CLI's
> `repository`/`homepage`/`bugs` now point at `papervine/cli` (and the `directory` field is
> dropped, since the CLI sits at that repo's root), which is also what unblocks `--provenance`.
> `LICENSE` (MIT) lives at **`apps/cli/LICENSE`**, deliberately *not* the repo root: a root
> LICENSE would assert MIT over the control plane too.
>
> **Superseded (2026-08-28): the public half is now the Elastic License 2.0, not MIT.** Same
> boundary, different terms. MIT let anyone take `papervine` + `packages/renderer` — which is the
> whole rendering product — and offer it as a hosted docs service, i.e. compete with the only
> thing being sold, using the thing being given away. ELv2 keeps everything a *user* cares about:
> read it, change it, self-host it, run it in CI, ship your own docs with it, no key required and
> no telemetry. The single limitation is providing the software to third parties **as a hosted or
> managed service**. That is the specific hole MIT left open, and closing it costs a self-hoster
> nothing.
>
> Not OSI open source any more, and the docs shouldn't call it that — "source-available" is the
> honest word, and `docs/roadmap.mdx` says so. The two other ELv2 clauses are inert here by
> construction: there is no license-key functionality to circumvent, and the notices clause is the
> usual "pass the terms along". `LICENSE` stays at **`apps/cli/LICENSE`** for the reason the
> 2026-08-23 note gives — a root LICENSE would assert these terms over the control plane, which is
> not licensed to anyone. SPDX `Elastic-2.0` on `apps/cli`, `packages/renderer`,
> `packages/mdx-prosemirror` and `apps/collab`, on the mirror's generated workspace root, and in
> the README badge + CONTRIBUTING of the public repo.
>
> Worth knowing for anything that reads package metadata: npm shows `Elastic-2.0` as a
> non-OSI-approved license, and some corporate policy scanners flag ELv2 alongside SSPL/BUSL. That
> is the intended trade, but it will produce the occasional "is this open source?" question, and
> the answer to give is the paragraph above rather than a yes.
>
> The earlier MIT notes in this file are left as written — they were true when dated, and this
> file is a log. Anywhere the *present tense* matters (the mirror script's prose, the CLI README,
> CONTRIBUTING, the roadmap page) now says ELv2.
>
> **Consequence to be explicit about: this open-sources the render engine, not just the CLI.**
> `apps/cli` is 19 files of glue; the substance is `packages/renderer` (38 files), and a public
> CLI repo that anyone can actually build has to contain it. That's a coherent open-core split —
> the moat is the hosted control plane (multi-tenancy, Git sync, auth, analytics, assistant,
> billing), none of which is in either package — but it is a bigger giveaway than "the CLI" makes
> it sound, and it is the reason the packaging boundary in this section is worth keeping exact.
>
> **Sync mechanism: a one-directional publish mirror, no submodules and no subtree**
> (`scripts/mirror-cli.mjs`, `npm run mirror:cli`). The monorepo stays the single source of
> truth. The monorepo must never *depend* on the public repo, which is exactly what a submodule
> would create; `git subtree split` is also wrong here because the CLI's build needs
> `packages/renderer`, which lives outside `apps/cli`.
>
> The snapshot is `apps/cli` + `packages/renderer` + `tests/fixtures` + the portable subset of
> `tests/unit` + `tests/cli-package.mjs`, plus a generated two-package workspace root, tsconfig,
> vitest config, `.npmrc` (`legacy-peer-deps` — a plain `npm ci` fails without it), CI, a
> CONTRIBUTING explaining the PR flow, a PR-greeting action, and `examples/starter` (which is
> both the CI fixture and the clone-and-run asset). It's read out of git objects, not the
> worktree, and file modes are carried across — `git show` alone drops the executable bit on
> `bin/papervine.mjs`. Verified: the generated repo installs, typechecks, runs 18 unit test files
> (123 tests), and passes its own `test:cli` end-to-end.
>
> **The portable-test filter resolves paths rather than pattern-matching.** A first version
> rejected only the `@/` alias and let `draft-source.test.ts` through, which reaches the private
> app as `../../src/lib/draft-source`.
>
> **PRs: reviewed on the public repo, never merged there, ported upstream.** A merge on the
> public repo would be silently reverted by the next sync, so the mirror carries a **divergence
> guard** — it rebuilds the snapshot for the sha recorded in `.mirror-source`, diffs it against
> the public tree, and refuses to publish on any mismatch, telling you to port those commits
> first. Silent data loss becomes a loud, actionable stop. It also **replays one public commit
> per upstream commit, preserving author/date/message**, so the public repo has real history and
> contributors get real credit (GitHub matches the contribution graph by commit email) — that's
> what makes "closed, not merged" a fair deal. And it **never force-pushes**: that would break
> open PRs' ability to rebase and would paper over the very divergence the guard exists to
> surface. Tripwire: if porting PRs becomes routine, split for real — move both packages out and
> have the hosted app consume the renderer. That costs atomic renderer + control-plane commits,
> which is why it's premature now, not wrong forever.

> **Status (2026-08-23): the starter site moved into this repo** as `examples/starter`, and
> `scripts/mirror-cli.mjs` gained a second target (`--target starter` → `papervine/starter`,
> `npm run mirror:starter`). Same machinery as the CLI mirror: one-directional, per-commit
> replay with authorship preserved, and a divergence guard.
>
> **Why, and it isn't tidiness.** `db:seed` builds its dev sites *from* `papervine/starter`
> over the network — including `starter-gated`, the reader-auth test bed whose `internal/*`
> pages carry the `groups:` frontmatter that exercises §11.2. So the monorepo's own dev and
> test setup depended on an external repo it didn't version: seeding needed network and a
> GitHub quota, and a change over there could alter what the RBAC tests run against without
> review. That's the same argument that keeps `packages/renderer` in this repo, pointing the
> same way. Now it's versioned with the tests that consume it, and `tests/crawl.mjs
> examples/starter` is a CI gate — nothing verified the starter rendered at all before.
>
> **`db:seed` still fetches from GitHub on purpose.** That fetch walks the tree API and pulls
> raw blobs exactly as `syncSite` does, so seeding doubles as a smoke test of the real sync
> path; reading locally would quietly delete that coverage. `PAPERVINE_STARTER_DIR` overrides
> it with a local directory for offline work, and says so in its output.
>
> **It also collapsed a duplicate.** The component gallery existed twice — in the starter repo
> and as a hello-world in the CLI mirror's templates. The CLI snapshot now ships
> `examples/starter` at the same path, so its `npm run dev -- examples/starter` and its
> `test:cli` fixture are the *same* site that publishes to `papervine/starter`. One copy, four
> jobs (published, CLI example, seed source, crawl target). This supersedes the trim committed
> earlier the same day: that was correct while there were two copies, and moot once there's one.
>
> **Validation differs by target**, because a docs repo has nothing to install. The CLI
> snapshot runs `npm ci` + typecheck + unit; the starter snapshot checks that `docs.json`
> parses and that every page its navigation names exists — a nav entry pointing at a deleted
> file is the realistic breakage, and it would otherwise reach a forker before anyone noticed.
> Rendering is covered by the CI crawl.
>
> **The cost, stated plainly:** a starter template attracts drive-by PRs far more than a CLI
> does, and every one now hits the "reviewed here, merged upstream" flow on the repo where a
> casual contributor is least likely to tolerate it. Accepted because the seed/test-bed
> coupling was a present problem and starter PRs are a hypothetical one — but if community
> edits to the starter become common, that trade should be revisited.
>
> Verified: typecheck clean, smoke 17 pages green, `crawl examples/starter` 10/10 with 0×500,
> both mirror targets dry-run and self-validate, and the CLI snapshot's own `test:cli` passes
> against the starter it now ships (9 pages).
>
> **Status (2026-08-24): the starter mirror is LIVE.** `papervine/starter` is published
> automatically on every green CI run of `main` — seeded by `--initial`, then four commits
> replayed with their original authorship intact (they show as the author's commits there, not
> a bot's), stamp at `cf8973bc`.
>
> **Credential: a user-owned fine-grained PAT (`MIRROR_TOKEN`) for now, scoped to
> `papervine/starter` with Contents: write.** Worth being honest that this is the weakest of the
> options: PATs cannot be owned by an organisation — GitHub only lets an org *approve* tokens
> requesting access to its resources — so this one belongs to a person. If that account rotates
> the token or leaves, publishing stops, and every mirrored push is attributed to them rather
> than to automation. The better answers, in order: a **deploy key** on `papervine/starter`
> (repo-owned, write to exactly one repo, no expiry — and the mirror script needs no change,
> since only the workflow's auth step rewrites the remote), or a **GitHub App** owned by the org
> if more repos get automated. Revisit before this becomes load-bearing.
>
> **The first live run failed in a way worth recording**, because it looks identical to a broken
> token: `remote: Permission to papervine/starter.git denied to phishy` / 403. Everything else
> had already succeeded — clone, divergence guard, replay of all four commits, validation — and
> nothing was published, so there was no partial state. The cause was scope, not validity: the
> secret lives in `papervine/papervine` but the write permission has to target the repo being
> pushed *to*. Note an org can also block fine-grained PATs outright or hold them for approval,
> which presents exactly the same 403.
>
> **Added a `concurrency` group** after watching a manual dispatch and the automatic
> `workflow_run` fire 30 seconds apart on that first run. Both failed, so it didn't matter — but
> two *successful* concurrent runs would race on the same push, and the loser wouldn't fail
> cleanly: it would either push onto a moved parent or trip the divergence guard on a commit its
> sibling had just made, which reads like tampering rather than a collision.
> `cancel-in-progress` is deliberately **false**: a cancelled mirror can already have pushed
> part of its replayed commits, leaving a real-but-partial tip the next run wouldn't recognise.
> Queuing is slower and always correct.
>
> **Second undeclared dependency, found by the mirror: `mermaid`** (`components/mdx/Mermaid.tsx`).
> It hid from the `shiki` audit because it's a **dynamic** `await import("mermaid")`, and a
> `from "…"` grep doesn't match that — the audit command in `packages/renderer/README.md` now
> matches `import(`/`require` too. Note it also hid from `npm run test:cli`: the tarball is built
> *inside* the monorepo, where hoisting still resolves it, so the published CLI was fine and only
> a build outside the workspace fails. That's precisely the gap `mirror:cli --dry-run` closes, and
> it's why renderer import changes now owe both gates.
>
> **Status (2026-08-24): the starter wears the real brand.** It shipped with a placeholder — a
> green tile and a hand-drawn vine glyph, with a green `colors` block — which is a poor first
> impression for the thing published to `papervine/starter`, scaffolded by `papervine new`, and
> used as the `db:seed` source. It now uses the actual Papervine mark, and `colors` matches
> `docs/` (`#7C3AED` / `#A78BFA` / `#5B21B6`); the placeholder preview tile was recoloured too,
> since a purple logo over green accents reads as a mistake.
>
> **There was no SVG of the logo anywhere in the repo** — only `src/assets/papervine-logo.png`
> (917KB, 1254²), which `Brand.tsx` renders through next/image. A 917KB raster is wrong for a
> template people clone (`CONTRIBUTING-starter.md`: keep assets small, prefer SVG), so the mark
> was **traced from the PNG** rather than eyeballed: colours sampled from the source
> (body `#7E5ADF`, fold `#BDA4F1`, vine `#261B62`, tile `#0B0716`), the silhouette and the fold
> boundary scanned row by row, and the vine mapped as a mask to place its stem and two leaves.
> The reproduction was then checked *numerically* against the original — body area within 3%,
> vine within 5%, fold geometry matching (the small area delta is a rounded fold corner) — and by
> eye at the 32px it actually renders at, in both appearances.
>
> The three files have one source: `logo/light.svg` holds the mark, and `logo/dark.svg` (light
> wordmark) plus `favicon.svg` (mark alone) are generated from it, so they cannot drift. The
> favicon keeps the dark tile deliberately — it reads against light *and* dark browser chrome,
> where a transparent mark would vanish in one of them.
>
> Worth knowing for later: `examples/starter/logo/light.svg` is now the only vector Papervine
> mark in the repo. If the web app ever wants to stop shipping a 917KB PNG for a 32px lockup,
> that path is the place to start.
>
> **Status (2026-08-24): the CLI README got a hero.** Logo, title, tagline, badges, nav links and
> a product screenshot, in the shape most well-marketed dev tools use — the npm page is the first
> thing anyone sees of Papervine, and it was a text heading and two badges.
>
> **The images are absolute `raw.githubusercontent.com` URLs, and that is a sequencing
> constraint, not a style choice.** npm renders the README *from the registry*, where a
> repo-relative path resolves to nothing — so the URLs must be absolute, and the only place to
> host them for free is the public mirror. They point at
> `papervine/cli/main/apps/cli/assets/*`, which means **the npm page shows broken images until
> `papervine/cli` is public and has been mirrored at least once.** Publish in that order: flip
> the repo public → `npm run mirror:cli -- --push` → then `npm publish`. Verified by dry-running
> the mirror and confirming both files land at exactly those paths in the staged repo.
>
> They are deliberately **not** in the package's `files` allowlist, so a 93KB hero costs the
> tarball nothing — the images live in git for the README's benefit and never ship to a consumer.
>
> The screenshot is the starter served by the **real prebuilt CLI**, not `next dev`: the dev
> server injects its own overlay button, which would put dev chrome in a marketing image. Taken
> in dark mode at 1440×900, then palette-quantised to 53KB.
>
> **Gotcha: a transparent PNG in a GitHub README gets a grey backdrop.** The logo first shipped
> with rounded corners masked into the alpha channel, which looked broken — a lighter halo
> tracing the tile. GitHub styles README images with
> `background-color: var(--bgColor-muted); border-radius: 6px`, so transparent corners expose
> that muted grey, rounded at only 6px rather than the 56px the artwork used. Markdown cannot
> override the inline style, so the image simply must not be transparent: the logo is now an
> **opaque** square and GitHub's own 6px radius softens it for free. Verified by reproducing
> GitHub's exact inline style over dark, light and npm-white backgrounds. It is also cropped
> tighter than the source — the original centres the mark in ~49% of the square, which reads as a
> small glyph adrift in a box at 120px; ~72% is the usual app-icon proportion.
>
> **Status (2026-08-24): the CLI warms its search index, and a duplicated module cache was
> hiding in the build.** The index was built lazily on the first query. Measured on a synthetic
> 500-page repo: first search **269ms**, later ones ~17ms — and because the index key is file
> count + newest mtime, *saving a file* invalidated it, so the first search after **every edit**
> cost ~210ms again. In a previewer, editing is the whole activity, so that was the recurring
> cost, not the one-off. (At 36 pages the build is ~5ms and none of this is visible, which is why
> it went unnoticed.)
>
> Warming now happens in `apps/cli/src/instrumentation.ts` — the same deliberately-empty file
> that shadows the web app's Sentry instrumentation, so it is worth re-reading the comment there
> before touching it. It builds once at startup and then polls `contentVersion` (stat-only, cheap
> by design) every 2s, rebuilding off the request path when the files change. The timer is
> `unref`'d so Ctrl-C exits immediately instead of waiting out a poll.
>
> **The first attempt appeared to do nothing, and the reason is the finding worth keeping.**
> Startup warming left the first search at 298ms while the after-edit case improved — incoherent
> until the build was inspected: Turbopack emitted the search module into **two** server chunks.
> The route loaded one copy, the instrumentation hook the other, and each had its own
> module-level `indexByVersion` Map. The warmer built an index the route could never see. A
> module-level cache silently assumes one module instance per process, and the bundler does not
> guarantee that. The cache now hangs off `globalThis` under a `Symbol.for` key, which every copy
> in the process shares. Entries are content-addressed, so a stale one simply never matches.
>
> With that fixed, first search on 500 pages went **298ms → 52ms**; the remaining ~50ms is the
> route chunk loading plus the query itself, not the index, which is why a 36-page repo shows no
> change (its build was already negligible). Searching *within* the 2s poll window right after a
> save still pays one rebuild — inherent to polling, and the realistic flow (save, switch to the
> browser, type) is longer than that. Boot is unaffected: the clean-room gate still reports ready
> in ~1.2s, which is the guard against warming ever becoming blocking.
>
> `warmSearchIndex()` is a new export on the shared engine rather than a fake query, because
> `runSearch` returns early on an empty term before it ever reaches the index — there was no way
> to warm the cache through the existing API.
>
> **Status (2026-08-24): Ctrl-C is now bounded, after a report it "seems not to be working".**
> Could not reproduce it: SIGINT to the process group (what a terminal actually does), SIGINT to
> the parent only (what a wrapper like `npx` does), and SIGINT straight to `server.js` with the
> warm timer live on a 500-page repo all exited in 7–36ms. The warming interval is genuinely
> `unref`'d, so it does not hold the loop open.
>
> But reading the supervision code found a real hole worth closing regardless. Installing a
> `SIGINT` handler **replaces** Node's default "terminate now", so the CLI was living entirely at
> the mercy of the child: forward the signal, then wait on `exit` forever. If the server ever
> failed to go — a hung request, a shutdown blocked on a live handle, a bug in a dependency —
> Ctrl-C would do nothing at all, and pressing it again just re-sent the signal already being
> ignored. The only way out was another terminal. That is a bad failure mode for the one key
> everybody trusts.
>
> The wait is bounded now: forward, then `SIGKILL` if the child is still alive after 2s, and a
> **second** Ctrl-C skips the wait entirely (which is what a person does when the first appears to
> have done nothing). Exit codes propagate properly too — `code ?? 0` reported a clean exit for a
> process that was killed; it maps the signal to 128+n instead.
>
> Proven against a deliberately stubborn child that traps and ignores both SIGINT and SIGTERM:
> before, that hangs forever; now the CLI exits after 2.0s with code 137 and the port is freed.
> The normal path is unchanged at ~10ms.
>
> **Design (2026-08-24): the AI assistant in the CLI — one engine, three callers, metering
> decided by the caller. BUILT — see the status note at the end of this entry.** The requirement: the assistant should work in the CLI
> against the user's own key, and work hosted where it stays metered. Investigated before
> designing, and the conclusion is that this is mostly *relocation* — the architecture already
> separates the two. Packaging is decided (ship the SDKs, gate the UI on configuration); what
> remains unbuilt is the module moves and the two routes.
>
> **Retrieval needs no database, which is the fact that makes this feasible at all.**
> `docs-tools.ts` imports exactly four things: `runSearch` (the Orama index the CLI already ships,
> and which now warms at startup) plus `loadPage`, `buildNav` and `loadApiCatalog` from
> `@papervine/renderer`. There are **no embeddings and no pgvector** — retrieval is agentic over
> full-text search and page reads, every capability of which is already in the tarball. Had the
> assistant been embedding-based this would need a vector store and the answer would be no.
>
> **The metering decision already lives in the route, not the engine** (`api/assistant/route.ts`):
> `const billing = record ? await authorizeAi(record.organizationId, "assistant") : { allowed: true, metered: false }`.
> `runAssistantConversation` never decides whether to charge — it is told. And the unmetered
> branch **already runs in production**: it is how the platform's own apex docs assistant works.
> So the CLI is not a new mode, it is a third caller of a function that already has two:
>
> | caller | `record` | `billing` | result |
> |---|---|---|---|
> | hosted tenant | site row | `authorizeAi(org)` | metered, logged, credit-gated |
> | Papervine's own docs | `null` | `{allowed, metered:false}` | unmetered (today) |
> | **CLI** | `null` | `{allowed, metered:false}` | unmetered, no DB touched |
>
> Every hosted-only call is already guarded on `record` — `logEvent`, `setEventStatus`,
> `recordAiUsage` — so the CLI path skips all three without adding a single conditional.
> **Metering cannot leak into the CLI even by accident**: charging requires an `organizationId`
> and a `creditRateVersion` row, neither of which exists in a package that ships no database
> driver, and the CLI has no telemetry path to report anything home (verified in the security
> pass).
>
> **The work is module moves, not rewrites.** Into `packages/renderer`: `assistant-run` (131
> lines), `assistant-tools` (46), `docs-tools` (73), `ai-model` (204), `assistant-outcome` (13),
> and the UI `Assistant.tsx` (294) + `AskAssistantButton.tsx` (17). Four control-plane imports
> have to be broken, and three are near-trivial:
> - `@/lib/reader-access` → the renderer already carries `PageAccess` and an allow-all predicate.
> - `@/lib/search` → a 32-line wrapper; the renderer holds the core, and already re-exports
>   `withSearchIndexKey`.
> - `@/lib/db/app-schema` → a **type-only** import (`typeof site.$inferSelect`); replace with a
>   structural type.
> - `@/lib/track` + `@/lib/billing/store` → the only real injection, and both are already
>   `record`-guarded, so the CLI passes nothing and they no-op.
>
> **The UI slot already exists.** `Navbar` takes an optional "Ask AI" slot that the hosted app
> fills (`assistant={assistantOn ? <AskAssistantButton /> : null}`) and the CLI currently passes
> `null` to. Filling it is the whole integration.
>
> **Keys need no new mechanism.** `ai-model.ts` is entirely env-driven: `ANTHROPIC_API_KEY` with
> `AI_ROUTING=direct`, or a local OpenAI-compatible server via `AI_BASE_URL` — so a CLI user can
> run it **free and fully local against Ollama**, which is a good story for an MIT tool.
> `aiProviderStatus()` already returns human-readable "you haven't configured X" errors.
>
> **Packaging — DECIDED: ship the SDKs to everyone, and show the assistant only when it is
> configured.** The alternative considered was true opt-in (optional peer dependencies the user
> installs themselves), which npm does support — `peerDependenciesMeta.optional: true` is
> genuinely not auto-installed, verified with a throwaway package. It was rejected because it
> makes the good path a manual step and it breaks under `npx`, where a project-local `ai` is not
> on the resolution path from a temp cache dir.
>
> Shipping them as ordinary `dependencies` removes that entirely: npm and npx both install a
> package's own dependencies, so the SDKs are simply *there*, and the only thing a user supplies
> is a key. Four pieces:
>
> 1. `dependencies: { ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google }`. All three
>    providers because `ai-model.ts` imports them statically — and `@ai-sdk/openai` is not
>    optional even for the free path, since `createOpenAI` is what drives a local
>    OpenAI-compatible server (Ollama).
> 2. **`serverExternalPackages`** for each. This is the piece most likely to be got wrong: unlike
>    `sharp` — which nothing imports, because Next probes for it — the assistant genuinely
>    `import`s `ai`, and a static import is **compiled into the prebuilt server at build time**.
>    Without externalising, the SDKs ship inlined in the bundle *and* get installed again as
>    dependencies.
> 3. `prepack` prunes them from `server/node_modules`, exactly as `SHARP_PRUNE` does, so the
>    tarball does not carry a second copy.
> 4. The gate is `aiProviderStatus()`, which already returns a human-readable reason. Configured →
>    fill the `Navbar`'s existing "Ask AI" slot. Not configured → leave it `null`, which is
>    today's behaviour, so there is no new empty state to design.
>
> **Cost, in proportion:** the CLI already installs **92MB** (`server/`). The SDKs add ~24MB —
> `ai` 7.5, `@ai-sdk/openai` 6.1, `google` 5.3, `anthropic` 3.2, `provider*` 2.1 — so the
> installed footprint grows about **26%**, and the tarball stays 15MB because they are pruned
> rather than bundled.
>
> **The boundary assertion needs deliberate updating, not accidental passing.**
> `tests/cli-package.mjs` forbids `ai-sdk` in the *tarball*; because these are pruned, that check
> would keep passing while its intent silently changed. Treat the tarball rule as "not bundled"
> and add the counterpart the sharp work established — assert the SDKs *are* resolvable after a
> real install — so both facts are pinned on purpose. The README's "It carries none of the hosted
> product: no authentication, database, object storage, realtime, or AI assistant" becomes false
> at the same moment and has to change with it.
>
> **Recorded consequence, so it is a decision and not a surprise:** `PAPERVINE_HOST=0.0.0.0
> papervine dev` behind a proxy is a legitimate self-host (it is why the sharp platform-lock was
> worth fixing). With the assistant shipped, someone can serve a *public* docs site with a working
> assistant, on their own key, entirely unmetered. That is not a hole in the billing code; it is
> the honest consequence of an MIT package with a serviceable server and a no-lock-in posture.
> Whether it matters depends on where the hosted value sits — if it is multi-tenancy, Git sync,
> reader auth, the answered/unanswered analytics the local path structurally cannot produce,
> custom domains and not operating anything, then a capable free tier is a funnel rather than a
> leak. A lever exists (restrict the CLI to local/BYO-key providers and keep gateway routing
> hosted-only) but it is easily circumvented in an MIT package and sits awkwardly beside
> no-lock-in.
>
> **Status (2026-08-24): SHIPPED.** The assistant runs in the CLI, and hosted stays metered.
>
> Moved into `packages/renderer`: `ai-model`, `docs-tools`, `assistant-tools`,
> `assistant-outcome`, `assistant-run`, `assistant-link`, and the UI (`Assistant`,
> `AskAssistantButton`). The access *context* (`currentPageAccess`/`withReaderAccess`) moved too
> — the app keeps only `accessForRecord`, which is the part that genuinely needs reader-auth, and
> re-exports the rest so no call site changed.
>
> **Analytics and metering became injected hooks, and the injection point is deliberately
> required.** `hooks` is not optional: an optional field meant a hosted caller could simply forget
> it and lose billing silently, with typecheck none the wiser. Making it required turned that into
> two compile errors naming the exact two routes — which is how it should have failed. Both are
> wired through one `hostedAssistantHooks` object rather than separately, preserving the reason
> `runAssistantConversation` is shared at all: a metering mistake must not drift between the
> in-docs and widget callers. The CLI passes `{}`, which says "deliberately none".
> `SiteRecord` became a structural `AssistantSite = { id, organizationId }`, so the Drizzle schema
> — and with it the database — does not follow the code into the renderer.
>
> **The packaging plan recorded above was wrong, and the clean-room gate caught it.** The plan was
> to externalise the SDKs, declare them as `dependencies`, and prune the traced copy — npm
> delivers one copy, the tarball carries none. That cannot work: Turbopack rewrites every
> `serverExternalPackages` entry to a **content-hashed alias** (`@ai-sdk/anthropic-b7de4e186d…`)
> which the compiled server requires *by that name*, so the pruned tree would have failed at
> runtime. The gate reported it as control-plane code in the tarball — the SDKs shipped anyway,
> because `dereference: true` had turned the alias symlinks into real copies.
>
> They are **bundled** instead, which is right for these: unlike the MDX stack — external because
> it breaks when bundled for RSC — the AI SDKs are ordinary JavaScript. Compiled in they are
> tree-shaken, there is no second copy to reconcile, and the published package declares no AI
> dependency at all. **The measured cost is 4MB, not 24** (`server/` 92MB → 96MB): the earlier
> figure was the size of the packages on disk, not of what a bundler keeps.
>
> **Gating.** `aiConfigured()` is evaluated on the server in the CLI's docs layout, so an unset
> key never reaches the browser as a disabled control — the navbar renders exactly as it did
> before the assistant existed. Verified: unconfigured, no button and `/api/assistant` returns
> **503** naming the variable to set; configured, the button appears, the panel opens, and a real
> POST streams `start` → `error` → `[DONE]` at HTTP 200 against a deliberately fake key, proving
> the whole path — route, run, tools, provider call — short of a live model. No live call was made
> (no key was configured in this environment, and spending someone's credits to prove wiring is a
> poor trade).
>
> The clean-room gate now asserts the *shipped behaviour* rather than installed packages: the
> endpoint must exist and refuse with a 503 that names what to configure. A 404 would mean the
> route never shipped and the button would silently never appear — a failure with no error
> message anywhere. The tarball's forbidden-package list keeps `ai-sdk` on it, with a comment
> that "absent from the tarball" and "absent from the product" are now different claims.
>
> Verified: typecheck (root + CLI) clean, unit 1134, smoke 19 pages, crawls of `docs/` 42/42,
> `mirror:cli --dry-run` typecheck outside the monorepo clean, and the clean-room tarball gate
> green.
>
> **Status (2026-08-24): three follow-ups from first real use, and a near-miss worth recording.**
>
> **The CLI ignored `.env` / `.env.local`.** The server is spawned with `cwd` set to the
> *installed package*, not the user's project, so a key sitting next to `docs.json` did nothing —
> silently, since the only symptom is an assistant that never appears. `bin/papervine.mjs` now
> loads them itself, using `process.loadEnvFile` where available (Node 20.12+) and a small parser
> below that, since `engines` allows 20.9. Two rules: an exported variable always wins, and
> *more specific is loaded first* — which, because nothing overwrites, means the order is the
> reverse of how it reads (`.env.local` before `.env`, content directory before cwd). Verified
> against a project that failed before the change and works after.
>
> **A failed question rendered nothing at all** — reported as "asking the assistant does nothing",
> which is exactly what it looked like. Two causes, both fixed. `useChat` reports failures on
> `error`, which the component never destructured, so there was no branch to render. And
> `toUIMessageStreamResponse()` masks the reason as "An error occurred." unless the route opts
> out. The panel now shows the failure, `assistant-run` **always logs the real error server-side**
> (free, safe, and it lands in the terminal the operator is already watching), and an
> `exposeErrors` flag lets the caller send the real text to the client — true for the CLI, whose
> reader *is* the operator, false for hosted sites, whose readers are not. With a deliberately
> invalid key the panel now reads "API key is invalid." instead of sitting inert.
>
> **Near-miss: an API key was one `npm publish` from shipping.** `examples/starter/.env.local` is
> correctly gitignored, so nothing upstream complained — but `prepack` copies that directory into
> `apps/cli/template/` with a **filesystem** copy, and `files` ships `template/` wholesale. The
> key was found sitting in `apps/cli/template/.env.local`, i.e. inside the next tarball and every
> `papervine new` after it. Not public: the mirror builds from git-tracked files, and the public
> repo has no `template/` at all. The copy now filters `.env*`, `.git`, `node_modules` and
> `.DS_Store`, because a directory someone actually works in will keep accumulating exactly the
> files that must not ship. Worth noting the clean-room gate's `suspicious` check (`/\.env|…/`)
> would have caught it at pack time — the guard worked; the copy should not have created the
> problem for it to catch.
>
> **The assistant is verified live.** Against a real key it called `searchDocs`, then `readPage`,
> then answered with inline citations to `/components/accordions`, `/components/badges` and
> `/components/cards` — quoting those pages' own descriptions. Agentic retrieval over the CLI's
> own content, with citations, confirmed end to end rather than inferred.
>
> **Status (2026-08-24): an infinite prefetch loop, from the index page's two spellings.**
> Reported as ~17,000 requests to `/index?_rsc=…` from a single page load. Reproduced at **5,257
> requests in 20 seconds**, and it had nothing to do with the assistant — it reproduced with the
> assistant fully disabled, and predates it.
>
> **Cause:** `buildNav` emitted `href: "/" + slug`, so the index page — written as `"index"` in
> `docs.json` — got the href `/index`. But that page is *served at* `/`. Next's `<Link>`
> prefetches `/index`, the response is the tree for `/`, the router never records `/index` as
> fetched, and the Link asks again. Forever. `resolveLeaf` now routes slugs through
> `routeForSlug`, which maps `index`/`""` to `/`. Removing the entry from the nav dropped the
> count 5,257 → 23, and the fix does the same on the real starter.
>
> This is the **third** distinct bug from the same root — the gotchas file already records that
> `listPageSlugs()` reports the index page as `""` while `docs.json` writes `"index"`, which made
> the nav tree's "Add existing page" menu look empty. Same mismatch, new symptom. The rule stands:
> anything comparing or constructing a page URL must normalise first.
>
> **Why nobody saw it:** invisible three ways over. Next does not prefetch in development, so it
> only exists in a production build. The CLI's prebuilt server logs no requests, so the server
> side showed nothing. And it costs the *page* nothing visible — it just hammers the loopback. It
> took putting a counting proxy in front of the CLI to see it at all; four earlier reproduction
> attempts "passed" because I was grepping a log that never records requests, which is a
> reminder that an empty log is not evidence of absence.
>
> A wrong hypothesis is worth recording too: the CLI has no `staleTimes` while the web app sets
> `dynamic: 30`, and with pages being `force-dynamic` that looked like an obvious cause. Setting
> it changed nothing (5,257 → 5,280) and was reverted. The loop was never about cache lifetime.
>
> Guarded in `tests/smoke.mjs`: the fixtures nav includes the index page, so the home check now
> *excludes* `href="/index"` — the cheapest possible layer for a bug that needs a browser, a
> production build and a proxy to observe directly.
>
> Rendering was checked against **GitHub's own markdown API** (`POST /markdown`) rather than
> assumed, which caught one real thing: badges on separate source lines render with `<br>` between
> them and stack vertically. They are one line now. Also confirmed `---` under an ATX heading
> becomes a `<hr>` rather than being eaten as a setext underline.
>
> **Status (2026-08-24): the CLI mirror is automated too, and the reasoning that kept it manual
> was wrong.** `mirror-starter.yml` became `mirror.yml` with a matrix over both targets, so
> `papervine/cli` and `papervine/starter` publish on the same trigger — CI completing
> successfully on `main`.
>
> **The prior note said the CLI stayed manual because "pushing it moves the source that
> papervine/cli's own publish workflow builds an npm package from, and a human gate in front of
> an immutable npm publish is worth keeping."** The premise is false in the detail that matters.
> `publish.yml` fires only on `tags: ["v*"]` or `workflow_dispatch`, and `mirror-cli.mjs` pushes
> `git push origin main` — it never pushes tags. So mirroring moves the source and *cannot* ship
> it; the human gate was always the tag, not the mirror. The caution was real, it was just
> guarding a door that wasn't the one it thought.
>
> What automation buys is that a release tag then describes code that is already public, instead
> of a snapshot someone remembered to push. The failure mode being removed is the one that had
> already happened: an entire session of CLI work — the assistant, `.env` loading, the Ctrl-C
> fix, the README, the security pass — sat unmirrored while `.mirror-source` still stamped
> `2deeb95`.
>
> **A matrix rather than a second file**, because the two workflows would have been ~60
> identical lines whose only difference is the npm script name. `concurrency` moves to the job
> and keys on `mirror-${{ matrix.target }}`, so the per-target serialisation the 2026-08-24 note
> added is preserved while the two mirrors — which push to different repos — never queue behind
> each other. `fail-fast: false`, since a CLI validation failure should not cancel a starter
> publish that would have succeeded.
>
> **The gate is stronger for the CLI than for the starter**, which is the other half of why this
> is safe: CI's `verify` job runs `test:cli`, the clean-room test that packs the real tarball and
> installs it outside the repo. So "CI green" for the CLI means the published snapshot survives
> being installed elsewhere, not merely that it parses.
>
> **Unverified, and it is the likely first failure:** `MIRROR_TOKEN` is the fine-grained PAT
> scoped to `papervine/starter`. If its scope wasn't widened to `papervine/cli`, the CLI leg
> fails at the push step with the same `403 ... denied to <user>` that the starter's first live
> run produced — everything up to and including validation succeeds, and nothing is published.
> The token's scope can't be read from here; the first run will say.
>
> **Status (2026-08-24): self-hosting is documented as a supported deployment, and the
> Dockerfile was tested before it was written down.** New page `docs/guides/self-hosting` in the
> Publish group, plus a section and a Dockerfile in the CLI README.
>
> **The premise came from the user: the CLI is a bona fide production server, not a previewer.**
> That is simply true and the docs had it wrong — `bin/papervine.mjs` spawns Next's standalone
> server with `NODE_ENV: "production"` against a prebuilt app. There is no other server. The
> word "dev" in the command name describes the occasion, not the software, and every surface
> that said "preview" was describing a use case as if it were a limit. Fixed across the README
> tagline and headings, the npm `description`, `docs/cli.mdx`, and the CLI's own `--help`.
>
> **Structure borrowed from a competitor's deployment page, but not its content** — theirs is a
> static-hosting guide (GitHub Pages, Netlify, Cloudflare) because their build emits a static
> bundle. Ours cannot be that page: `papervine build` (static export) is roadmap, not shipped,
> so every static host is a *wrong* answer and the page says so in a Warning rather than
> leaving someone to discover it. What transfers is the shape: overview → one section per
> method → checklist.
>
> **Everything asserted was verified in Docker first**, because a deployment guide with an
> untested Dockerfile costs a reader an afternoon. Packed the real 17MB tarball, installed it
> globally in `node:22-slim`, and confirmed: the site serves (home, a nested page, the search
> API all 200), `sharp` installs on glibc so image optimization is available with no warning,
> `docker stop` returns in under a second (SIGTERM is forwarded, no kill-timeout wait), and a
> **read-only** bind mount publishes edits live — both a frontmatter change and an appended
> body paragraph appeared on the next request with no restart. That last one is the claim the
> page is built around, so it was the one worth proving.
>
> A false alarm worth recording, since it looked exactly like a bug: the first live-edit test
> appeared to fail. The cause was the test, not the server — the frontmatter is
> `title: "Introduction"` with quotes and the edit searched for it without them, so no edit ever
> reached the file. The lesson is the cheap one: confirm the input changed before concluding the
> system ignored it.
>
> **The Trust sections needed reconciling, not just extending.** Both the README and
> `docs/cli.mdx` stated the surface "binds loopback" as a flat security property. That stops
> being true the moment a reader follows the new instructions, so both now say *by default* and
> name `PAPERVINE_HOST=0.0.0.0` as the setting you knowingly relax. A doc that contradicts its
> own deployment guide is worse than one that omits it.
>
> **"What you give up" is a table, deliberately.** Reader auth, the browser editor, analytics,
> automations, managed TLS/CDN, multi-site — naming what the control plane does is what makes
> the hosted product legible, and burying it would make the guide feel like a trap. The honest
> framing is that self-hosting is an alternative for public docs written in Git, not a lesser
> tier.
>
> Verified: crawl `docs` 43/43 at 0×500 (was 42 pages), every internal link and in-page anchor
> in the new page resolves, README anchors resolve, and the page was checked in a real browser
> in both appearances with a clean console.
>
> **Status (2026-08-24): the assistant's provider setup is documented, after confirming it fails
> silently.** Reported as "right now it just says direct". New page
> `docs/features/assistant-providers` with a copy-paste recipe per provider, plus self-contained
> recipes in the CLI README.
>
> **The docs weren't merely thin, they set a trap — reproduced before writing anything.** Exporting
> `OPENAI_API_KEY` and running `papervine dev`: the assistant button never renders (0 occurrences
> in the HTML) and `POST /api/assistant` returns 503 with *"model
> `anthropic/claude-haiku-4-5` routes via the AI Gateway but neither `AI_GATEWAY_API_KEY` nor
> `VERCEL_OIDC_TOKEN` is set"*. `AI_ROUTING` defaults to **`gateway`**, and the old table described
> `direct` without ever naming the default. Nothing prints at startup, so the user is told nothing,
> anywhere.
>
> **There is a second trap behind the first**, also reproduced: adding `AI_ROUTING=direct` to an
> `OPENAI_API_KEY` still fails, because `PAPERVINE_AI_MODEL` defaults to `anthropic/…` — *"ANTHROPIC_API_KEY
> is not configured (AI_ROUTING=direct, model=anthropic/claude-haiku-4-5)"*. The model prefix and
> the key must match. That is precisely why the page is organised as **whole recipes** rather than a
> variable table: every block sets routing and model together, so neither half can be missed. The
> table is still there, underneath, for reference.
>
> **Recipes were run, not transcribed.** Ollama end to end on real hardware
> (`PAPERVINE_AI_MODEL=ollama/qwen3.5`, no key, no `AI_ROUTING`) → panel renders, a tool call fires,
> a cited answer streams back. `openai/gpt-5-nano` + `AI_ROUTING=direct` + a key → panel renders and
> the stream reaches the model. And every error string quoted in the troubleshooting section is the
> literal output of `aiProviderStatus()`, so searching the message finds the fix — a quoted message
> that doesn't match reality is worse than none.
>
> **One canonical page, referenced from four surfaces** (`docs/cli.mdx`, `features/ai-assistant`,
> `guides/self-hosting`, `local-ai`), because the alternative is four copies drifting. The README is
> the deliberate exception: it repeats the recipes in full, since a README cannot rely on links.
> `local-ai` keeps the deep operator material (Compose profile, model choice, scheduled-run reach)
> and is cross-linked rather than duplicated.
>
> Two stale references fixed in passing: `docs/features/ai-assistant.mdx` and `.env.example` both
> pointed at `src/lib/ai-model.ts`, which moved to `packages/renderer/lib/ai-model.ts` in the §10.6
> extraction. Also a dangling `#starter-questions` anchor on the assistant page, pointing at a bold
> list item rather than a heading.
>
> **Not done, and it is the real fix:** the CLI still prints nothing about AI at startup, though it
> warns about `sharp`. `aiProviderStatus()` already returns the exact sentence a startup line would
> need. Documentation cannot fix a failure that announces itself nowhere — left out only because the
> ask was explicitly documentation.
>
> Verified: crawl `docs` 44/44 at 0×500, every internal link and anchor in the five edited pages
> resolves, the README round-tripped through GitHub's markdown API (17 headings, 4 tables, 18 code
> blocks, the `[!WARNING]` alert), and the new page checked in a real browser in both appearances
> with a clean console — including clicking a `CodeGroup` tab and asserting the recipe actually
> changed.
>
> **Status (2026-08-24): three feature screenshots in the CLI README.** The API reference pages,
> the search palette and the assistant panel now appear beside the prose that describes them,
> rather than each being a sentence the reader has to take on faith.
>
> **Placed with their prose, not gathered into a gallery.** A screenshot next to the paragraph it
> illustrates is read; a strip of thumbnails is scrolled past. This also exposed a real gap:
> OpenAPI support was a subordinate clause in a list ("…and OpenAPI endpoint pages") for the one
> feature that most needs showing — generated endpoint pages with parameters, schemas, a
> language-tabbed request sample and a working **Try it** console. It has its own paragraph now.
>
> **Downscaled and palette-quantized to match the existing convention** (`screenshot.png` is
> 1200px / 53KB, not a retina dump). The three arrived as @2x captures totalling 1.3MB; resampled
> to 1200px they were 576KB, and a 256-colour quantization took them to **202KB** — 62–68% off
> each, and visually indistinguishable, because a dark UI screenshot is flat panels and text
> rather than photographic gradient. No `pngquant`/`oxipng` on the machine; PIL's median-cut did
> it, keeping the original whenever quantization failed to win.
>
> **They cost the npm tarball nothing.** `apps/cli/package.json`'s `files` allowlist is
> `bin/ server/ template/ README.md LICENSE` — `assets/` is not in it, and the README references
> them by absolute `raw.githubusercontent.com` URL against the public mirror, where
> `MIRRORED_PATHS` carries all of `apps/cli`. So the images live in the public repo that serves
> them and never enter the package a user installs.
>
> Every image carries real alt text: the README is the npm page, and a described screenshot is
> also the fallback when raw.githubusercontent is blocked or slow.
>
> Verified: the README round-tripped through GitHub's markdown API with all five images resolving
> to mirror URLs and its 17 headings, 4 tables and 18 code blocks unchanged.
>
> **Status (2026-08-24): the nine themes are now actually nine themes.** They had the right
> names and near-identical output: every entry carried a font stack and two radii, so seven of
> the nine differed only in a corner radius. The comments described "retro terminal" and
> "card-based" looks that nothing implemented, and `data-theme` was set on `<html>` with **no
> CSS anywhere keying off it** — the four variables were the entire mechanism.
>
> **Measured the real ones rather than guessing.** Each named theme has a live preview site;
> driving a browser over all nine and reading computed styles showed the actual differentiators
> are font family, heading weight and tracking, sidebar width (224–304px), sidebar divider,
> header height, content width, and the active-link treatment — not radius. Ours are built to
> the same *character* rather than copied: different proportions, different type, our own take
> on each brief.
>
> **A theme is now entirely CSS custom properties emitted from `theme.ts`.** This is the load-
> bearing decision. The hosted app and the CLI keep separate `globals.css` files, so per-theme
> CSS would have to be written twice and would drift; generated variables give both apps
> identical values for free and keep the original promise that adding a theme is one registry
> entry. The corollary is that components consume variables instead of hard-coding —
> `w-[var(--db-sidebar-w)]`, not `w-64` — and the rule going forward is that wanting a
> `[data-theme=…]` rule means adding a token instead. Fourteen tokens now: three font stacks,
> two radii, heading weight/tracking, leading, three widths, the divider, and label casing.
>
> **System font stacks only, and there is a test for it.** A webfont fetch would make a theme
> render differently offline and shift layout on a cold cache; `papervine dev` can't negotiate
> either. `ui-rounded` gives almond its softer face on Apple platforms and falls through
> elsewhere, which is the right shape for this — an enhancement, not a dependency.
>
> **Verified by measurement, not screenshots alone.** A script cycled `docs.json` through all
> nine against a live server and read back computed geometry: sidebar 224–288px, dividers 0/1px,
> four font families, weights 500–700, nav radii 0–999px, content 584–664px, leading 25–28px.
> All nine render distinctly. The first run reported one sidebar width for every theme, which
> was the *measurement* selecting the full-width tab bar rather than the sidebar — worth
> recording, because a bad selector reads exactly like a broken feature.
>
> Pinned by `tests/unit/theme.test.ts`, including a pair-wise check that no two themes differ in
> fewer than two tokens — the regression that started this — and an assertion that every stack
> is offline-safe and ends in a generic family.
>
> Also fixed: three references to `src/lib/theme.ts`, which moved to `packages/renderer/` in the
> §10.6 extraction.
>
> **Status (2026-08-25): `papervine serve` — the production command gets its own name.** Asked
> as "shouldn't we have a `papervine serve` that calls `next start` instead of `next dev`?" The
> premise about the implementation was already false — `dev` spawns the standalone `server.js`
> with `NODE_ENV=production`, so it has always been the `next start` equivalent and never a dev
> server. But the instinct was right about the thing that matters: **nobody should have to type
> `dev` on a box serving real traffic**, and the previous fix for that was a paragraph in a README
> explaining that the name lies. A second name is the better answer, because the name is the
> documentation.
>
> **One implementation, two names, exactly two differing defaults.** `runServer(argv, mode)`
> serves both:
>
> - **Bind address.** `dev` keeps loopback — a command you run on your laptop has no business
>   being on the LAN. `serve` binds `0.0.0.0`, because being reachable is the whole point of the
>   word, and making the production command require an environment variable to do its job is its
>   own kind of footgun. Both now **print which address they bound**, since "intended" and
>   "understood by the person who typed it" are different things.
> - **The scaffold offer.** `dev` offers to create a starter site when there is no `docs.json`;
>   `serve` fails. A production server that invents content hides the actual fault — a wrong
>   path, an unmounted volume — behind a site that looks fine and says nothing true.
>
> Everything else is identical: same prebuilt app, same rendering, same signal handling.
>
> **A `--host` flag, not only `PAPERVINE_HOST`.** Precedence is `--host` → `PAPERVINE_HOST` →
> the mode default. A flag is self-documenting in a Dockerfile `CMD` in a way an env var isn't,
> and it makes the reverse-proxy arrangement a one-liner: `papervine serve ./docs --host
> 127.0.0.1` pins it back to loopback so only the proxy can reach it. Still never `HOSTNAME` —
> that gotcha stands.
>
> **What this simplifies:** the self-hosting guide previously had to teach
> `PAPERVINE_HOST=0.0.0.0 papervine dev` in four places — Dockerfile, systemd unit, container
> platforms, checklist. All four are now plain `papervine serve`, and the Dockerfile lost an
> `ENV` line.
>
> **Verified end to end rather than by inspection.** `serve` reachable on the machine's real LAN
> address (192.168.x.x → 200) while `dev` on the same content is refused there and 200 on
> loopback; `--host 127.0.0.1` pins `serve` back to refused-off-loopback; `serve` on an empty
> directory exits 1 with the `docs.json` error rather than prompting. Then in the clean room,
> from the *installed tarball*: `serve` boots, answers, states its bind address, and refuses an
> empty directory.
>
> **A bug of mine worth recording, because its symptom lied.** The new clean-room check called
> `waitForReady(servePort)` — but that function's first parameter was a *timeout*, so a port
> number became a 4.2-second budget against the other server's URL. It reported "`serve` never
> became ready" while the captured log plainly showed the server ready. `waitForReady` now takes
> a base URL first. An argument that plausibly type-checks as another one is worth removing the
> ambiguity from, rather than remembering the order.
>
> Also: `validateContentDir` now names the command that was run, so typing `papervine serve` no
> longer gets you a hint that says `papervine dev`.
>
> **Status (2026-08-25): the MCP server ships in the CLI, and `mcp-handler` left the repo.**
> Asked as a feasibility question, with the deciding observation supplied by the user: people can
> and will host this CLI in production, so an HTTP `/mcp` endpoint is the case that matters — a
> remote client cannot spawn a local stdio process. My first answer had ranked stdio first on the
> reasoning that the CLI is mainly local, which stopped being true the day `papervine serve` and
> the self-hosting guide shipped.
>
> **The blocker dissolved on inspection.** `mcp-handler` declares `redis` as a runtime dependency
> and imports it **eagerly** (`dist/index.js:7`), which would have dragged 4.4MB of `@redis/*`
> into a documentation previewer. But that package exists only to bridge the SDK's
> Node-`IncomingMessage` transport to a Fetch handler — and the SDK ships
> `WebStandardStreamableHTTPServerTransport`, whose signature is literally
> `handleRequest(req: Request): Promise<Response>`, which *is* a route handler's contract. With
> nothing to bridge, the dependency had no job.
>
> **So it was removed from the monorepo entirely**, not just avoided in the CLI: both hosted
> routes (`/mcp` and `/authoring/mcp`) now use the Web-standard transport directly, and
> `mcp-handler` + the whole Redis tree are out of `package.json` and the lockfile. The hosted
> `/mcp` was already documented as "stateless (no Redis)" — it just still carried the client.
>
> **Measured cost of shipping MCP in the CLI: +0.5MB packed** (17.0 → 17.5MB), +1.3MB unpacked,
> +15 files. The tarball listing contains **zero** paths matching `modelcontextprotocol`, `redis`
> or `mcp-handler` — all compiled in — so the §10.6 packaging-boundary grep passes unchanged.
>
> **One registration, two transports, per the `AssistantHooks` template.**
> `packages/renderer/lib/mcp-tools.ts` owns the tool names, descriptions and schemas, because a
> tool description is a **prompt** an external client reads to decide what to call, and two copies
> of a prompt become two different products. The hosted route keeps what only it has: tenant
> routing, the anonymous reader gate (SPEC §11.2 — an external agent carries no reader session, so
> a gated site exposes only its public subset), and agent analytics via a required `McpHooks` bag
> the CLI passes `{}` to. `McpServer` is a **type-only** import in the renderer, so nothing that
> doesn't serve MCP takes a runtime dependency on the SDK.
>
> **Verified as a protocol, not a status code.** A real JSON-RPC exchange against the built
> server: `initialize` → correct `serverInfo`; `tools/list` → four tools; `search_docs` → 4 hits
> with `#anchors`; `read_page` → 932 characters of markdown; `search_api` → 4 operations. The
> clean-room test now runs that same exchange **from the installed tarball**, where it reports
> three tools rather than four — `docs/` has no OpenAPI spec, so the conditional `search_api`
> correctly does not register, which is the conditional working rather than a gap.
>
> Noted in passing: the SDK marks `server.tool(...)` **`@deprecated`** in favour of `registerTool`.
> The shared registration uses the current API; the authoring route's six tool bodies were left on
> the old one deliberately — converting them is worth doing, but not in the same change as a
> transport swap, on an authenticated surface that writes to Git.
>
> Verified: typecheck (root + CLI), unit 1162, smoke 19 pages, `next build` of the web app (both
> hosted MCP routes compile), crawl `docs` 44/44 at 0×500, `mirror:cli --dry-run` (the renderer
> typechecks outside the monorepo with the new dependency declared), and `npm run test:cli` green.
>
> **Status (2026-08-26): Deploy to Vercel — the CLI is a Next app, and I argued it wasn't.**
> Asked whether a Deploy button was easy. I said no, on the grounds that Vercel runs serverless
> functions while the CLI is a long-lived process. The user's correction was one line — "the CLI
> is a nextjs app" — and it was right. `output: "standalone"` is a *packaging* choice for the npm
> tarball, not an architecture; the app underneath is ordinary Next.
>
> Proved by building it both ways: with standalone disabled the app builds clean and `next start`
> serves the starter — home, a nested page, `/mcp` and `/llms.txt` all 200. My other two
> objections were also wrong: the mirror repo is a complete npm workspace (root `package.json`
> with `workspaces: ["packages/*","apps/*"]`, a lockfile, and `examples/starter` for content), so
> a clone has everything to build, and `root-directory` **is** a supported deploy-button query
> parameter, so the button can target `apps/cli`.
>
> **The button's repo is now `papervine/papervine` (2026-08-28) — a rename, not a retarget.**
> The public mirror was renamed `papervine/cli` → `papervine/papervine`, and the monorepo took
> the name `papervine/platform`. The button still clones the mirror, exactly as designed above;
> only the string changed. Worth stating plainly because the new name reads like the monorepo
> and invites the wrong conclusion — the source repo is **private**, so it could never be a
> clone target.
>
> **Swept the rest of the name in the same pass.** Everything else said `papervine/cli` and
> worked only because GitHub redirects a renamed repo — a redirect that dies the moment
> anything is created at the old name, and the load-bearing one was `scripts/mirror-cli.mjs`'s
> push remote, which publishes on every green CI run of `main`. Also updated: `apps/cli`'s
> `package.json` (`homepage`/`repository`/`bugs`, which npm renders as links), the README's
> five `raw.githubusercontent` asset URLs and its source link, the marketing home's `GITHUB`
> constant with the smoke assertion that pins it, the generated mirror templates
> (`CONTRIBUTING*.md`, `workflows/ci.yml`), and `mirror.yml`'s comments.
>
> The **dated notes above keep saying `papervine/cli`** on purpose: they record what was
> decided when, and a log that rewrites its own history stops being evidence. Only statements
> of *current* fact were changed.
>
> **Three changes.** `output` becomes `process.env.VERCEL ? undefined : "standalone"` — one source
> serving both targets, since Vercel sets `VERCEL` on every build. `apps/cli/vercel.json` supplies
> framework, the workspace build command, and `PAPERVINE_CONTENT`. And an
> `outputFileTracingIncludes` entry for the content, because `content.ts` resolves the docs folder
> from an env var at *runtime* — nothing statically references those files, so a serverless
> function would ship without them. The whole-project trace fallback happens to include them
> today, which means it worked by accident; stating the include makes it deliberate.
>
> **Verified by reading the trace manifests, not by deploying.** `.nft.json` files list exactly
> what each route bundles, so the question "does the content travel" is answerable locally and
> precisely: 42 starter files reach `(docs)/[[...slug]]`.
>
> **And that is how a secret leak got caught.** The first version of the include was
> `examples/starter/**`, and the trace showed `examples/starter/.env.local` in all eleven route
> bundles. That file is gitignored, so a Deploy-button clone never has one — but anyone deploying
> from their own checkout would have uploaded their API keys into the deployment, silently. This is
> the *second* time this session a copy-everything rule over a directory humans keep secrets in
> produced that outcome (the first reached `apps/cli/template/`). The include now enumerates
> content extensions; re-traced at 0 `.env` files and 42 content files. The pattern is worth
> naming: **a recursive glob across a human-managed directory is a secret leak waiting for an
> occasion.**
>
> **Stated cost, not buried:** every page renders per request, so a Vercel deployment is a
> function invocation per view with no caching. Correct, but the opposite of the perf posture
> recorded elsewhere — `papervine build` (static export) remains the right answer for traffic, and
> both the README and the guide say so next to the button rather than in a footnote.
>
> **Not verified:** whether the relative `PAPERVINE_CONTENT=../../examples/starter` resolves
> against the right cwd inside a Vercel function. That needs a real deploy, which needs a project
> on the account — the one step the local trace inspection can't stand in for.
>
> Verified: typecheck (root + CLI), unit, smoke, crawl `docs` 46/46 at 0×500, and
> `npm run test:cli` green — the standalone path is untouched, which is what the packaging
> boundary depends on.
>
> **Status (2026-08-24): `papervine new` shipped, and `dev` offers it.** Prompted by a
> competitor leading with `pnpm dlx create-shiso-app my-docs` — the observation being that a
> tool should generate a folder when the user hasn't got one. Ours dead-ended instead: `dev`
> with no `docs.json` printed an error and stopped, which is a wall for exactly the person
> we most want to keep.
>
> Two halves, and the second matters more. `papervine new [dir]` is the explicit command
> (§10.6 already planned it; `mint new` is the parity). But the higher-value half is that
> **`dev` offers to scaffold** when it would otherwise fail — someone who typed the obvious
> command shouldn't have to discover a second one exists.
>
> **The offer is gated on a TTY.** In CI or a pipe it keeps the old behaviour exactly: plain
> error, non-zero exit. A prompt blocking on stdin that nobody can answer is worse than a
> dead end. `--yes` scaffolds without asking. Note `--yes`/`--port` had to become *declared*
> `parseArgs` options rather than `argv.includes(...)` sniffing — parseArgs rejects an
> undeclared flag before any such check can run, which is how the first attempt failed.
>
> **The template is bundled, not fetched.** `prepack` copies `examples/starter` into
> `apps/cli/template/` and `files` ships it: 68K against a 24MB tarball. That buys offline
> scaffolding and, more importantly, a template that can never drift from the CLI version
> that wrote it — a fetch-at-scaffold-time design gets both wrong. It also gives the one
> starter a fifth job (published to papervine/starter, the CLI's `examples/starter`, the
> db:seed source, a CI crawl target, and now the scaffold template) with no new copy.
>
> **Scaffolding the full starter, not a trimmed variant**, on purpose: a newcomer landing on
> a working site with the component gallery learns more than one with three empty pages, and
> a "minimal template" would reintroduce exactly the second copy that was just eliminated.
> Delete what you don't want.
>
> **Refuses a non-empty directory** unless `--force`. Overwriting someone's files because
> they mistyped a path isn't recoverable, and dotfile-only directories (a fresh `git init`)
> count as empty, since refusing there would be pedantic.
>
> **Held: a `create-papervine` package** for `npm create papervine@latest my-docs`, which is
> the idiom the competitor uses. Good for discoverability, but it's a second published
> package after deliberately getting down to one, and it's a thin wrapper over `new` whenever
> we want it. Worth noting the zero-install path already existed (`npx papervine dev`), so
> the gap was never distribution — only that we failed when there was nothing to render.
>
> Pinned by `tests/unit/cli-args.test.ts` (26 cases over the two pure cores) and by
> `tests/cli-package.mjs`, which scaffolds *with the installed binary* and asserts the
> non-empty refusal. That layer is the only one that can prove `new` works: the template
> doesn't exist in a source checkout's `apps/cli`, so every other suite would pass while a
> published `new` had nothing to copy.
>
> Verified: typecheck (root + CLI) clean, unit 1083, smoke 17 pages, crawl of docs/ 41/41 and
> examples/starter 10/10 both 0×500, clean-room gate green, and a scaffolded site crawled
> 9/9 with 0 broken images — plus `dev --yes` scaffolding then serving in one command, and
> the non-TTY paths confirmed to error rather than hang.
>
> **Reversal of the 2026-06-14 "strip the incumbent from user-facing surfaces" note (below):** on
> **discovery** surfaces the competitor names are the point — they are how people search. The npm
> `description`/`keywords`, the public repo description/topics, and the CLI README's
> Compatibility section now say "docs.json-compatible" and "alternative to GitBook / ReadMe"
> deliberately. This is nominative comparative use (describing real interop), carries a
> not-affiliated disclaimer, and must never use another product's logo or imply endorsement.
> **In-product docs prose stays neutral** — a docs page explaining a feature by reference to a
> competitor reads worse and ages badly. So: name them where people are searching, not where
> people are already reading.
>
> **Status (2026-08-24): the CLI's output is styled, in the Papervine palette.** `--help` was a
> flat wall of text; it now has a header, aligned EXAMPLES / COMMANDS / OPTIONS blocks, and the
> brand purple from `docs.json` `colors` (`#7C3AED`, with `#A78BFA` for URLs and next-step
> commands) — so the CLI and the site it serves are visibly the same product. Runtime lines
> (`▲ papervine serving …`, the port-move warning, errors) use the same palette.
>
> **The interesting part isn't the colours, it's the three ways they turn off.** All of it lives
> in `apps/cli/bin/style.mjs`, which resolves a level *once* at module load:
>
> - **Not a TTY → no escapes at all.** Piped or redirected output is plain, so
>   `papervine --help | grep` and anything parsing us get clean text. Same principle as the
>   scaffold prompt: the pretty path is for the interactive case and must never be the only path.
> - **`NO_COLOR` → off** (no-color.org), and it **wins over `FORCE_COLOR`** when both are set.
>   `FORCE_COLOR` exists for the deliberate "colour through a pipe" case; `FORCE_COLOR=0` and
>   `TERM=dumb` are off too.
> - **No truecolor advertised → the 256-colour palette,** not a truecolor escape. `#7C3AED` needs
>   `38;2;r;g;b`; a 256-only terminal renders that as garbage, so each tier carries its own
>   escape and every colour has a hand-picked 256 near-match.
>
> One layout gotcha worth recording because it's silent: `rows()` measures column width on the
> **undecorated** label. Escape codes have no display width, so padding a coloured string by
> `String.length` counts the colour bytes and drifts every row after the first by however many
> bytes the colour took. `Math.max` is seeded with `0` for the same class of reason — an empty
> list would otherwise give `-Infinity` and throw in `" ".repeat()`.
>
> Help is deliberately **not** grouped into categories. Category headers earn their keep at a
> dozen commands; over `new` and `dev` they'd be more chrome than content. The roadmap commands
> (`broken-links`, `validate`, `openapi-check`, `build`) are what turn this into
> Preview / Quality / Build groups, and `rows()` already takes the shape.
>
> Pinned by `tests/unit/cli-style.test.ts` (14 cases): each tier's exact escape, all four
> off-switches including the NO_COLOR-over-FORCE_COLOR precedence, and the alignment invariant
> asserted on escape-stripped text. The level is captured at load, so each case is a
> `vi.resetModules()` + dynamic import with a `process.stdout.isTTY` shim — vitest runs without a
> TTY, so without the shim every case would take the piped branch and no tier would be reachable.
>
> Verified: typecheck (root + CLI) clean, unit 1097, smoke 17 pages, crawls of docs/ 41/41 and
> examples/starter 10/10 both 0×500, clean-room gate green (which is also what proves
> `bin/style.mjs` ships — the installed binary imports it), and all four tiers confirmed by their
> emitted bytes rather than by assertion.
>
> **Known cosmetic wart, not fixed:** Next's standalone server prints its own `▲ Next.js 16.3.2`
> banner right under ours, repeating the URL. Suppressing it means piping the child's stdout and
> filtering on version-specific strings — which risks swallowing real diagnostics — so
> `stdio: "inherit"` stays. The `▲` glyph predates this change.
>
> **Status (2026-08-24): code-block copy buttons + titles BUILT, and the starter's gallery became
> a browsable index.** Both halves of this came out of one request — "alphabetize the components,
> set up the index like theirs, and put a copyable snippet under each example" — and the third
> part turned out not to exist yet.
>
> **The copy button (§5 parity target, previously unbuilt).** Fenced code had no copy affordance
> at all. `pre` is now overridden in `mdxComponents` → `CodeBlock`, a **server** component that
> recovers the block's plain text by walking the compiled children and hands it to a small
> `"use client"` `CopyButton`. The walk stays on the server, so a page with a dozen fences ships
> one small button each rather than a dozen token-walkers. It works because the serializer
> compiles a fence to `<pre><code><span class="line">…</span>\n…`, with the newlines as literal
> text nodes *between* line spans — so concatenating every string in document order reproduces
> the source exactly, no separators to insert. Verified the override actually intercepts (a
> temporary marker prop on `pre` showed up on all 9 fences) before building on the assumption.
> `<Prompt>`'s internal `<pre>` is literal TSX, so it correctly keeps its own single copy action
> instead of sprouting a second.
>
> **Code titles: the transform was dead code for months.** `remarkCodeTitles` rewrote a fence's
> `meta` to `title="…"` and the serializer's Shiki integration **drops `meta` entirely** — it
> emits only `class`, `style` and `language` — so no title ever reached the DOM. Nothing failed,
> because nothing asserted. The visible symptom was `<CodeGroup>` labelling all three tabs of an
> npm/pnpm/yarn group **"shellscript"**, while the starter's own prose said "the tab label comes
> from the text after the language". Probed every title form against the rendered HTML to
> confirm before rewriting. The label is now carried out-of-band on a `<PvCodeTitle>` wrapper —
> the same trick `remarkMermaid`/`remarkTreeList` already use to hand structured data to a real
> component — and `CodeGroup` reads it from `data-code-title`, hiding the bar so the label isn't
> shown twice. Pure core extracted to `lib/code-title.ts` (`parseCodeTitle`) and unit-tested:
> the distinction that matters is title vs. **not** a title, since a line-highlight range or a
> `key=value` directive misread as a label becomes a tab that actively lies.
>
> **This required bumping the compile cache key** (`mdx-compile-v3` → `v4`). The key is
> content-addressed on the *source*, so a changed remark plugin set produces different output for
> identical input and the pre-change compile keeps being served until the TTL expires. The
> comment there says "bump when the compile pipeline changes"; this is that. Worth remembering
> that a plugin change with no visible effect is the signature of a missed bump.
>
> **Line highlights remain unbuilt** — and `docs/` was claiming otherwise. A ```` ```js {2} ````
> block renders **byte-identical** to a plain one (measured, not assumed). `parseCodeTitle`
> deliberately rejects `{…}` as a title, and nothing else consumes it. The docs page now says so
> rather than promising it; §5's table above is corrected too.
>
> **The starter's gallery: one 307-line page → an index + 26 alphabetized pages.** `components.mdx`
> is a card grid (icon, one-line blurb, link) and `components/<name>.mdx` is one page per
> component: the thing rendered, then the **exact source that produced it** in a fence, then a
> props table taken from the real component signature rather than from upstream docs. A new
> **Components** tab keeps 26 entries out of the Documentation sidebar. Ordering is alphabetical
> throughout, deliberately *unlike* the upstream index's group-by-purpose — a reader hunting for
> "Tooltips" shouldn't have to guess which of seven purposes it was filed under.
>
> The pages are **generated from a single authored source** (scratch script, not committed) so
> the live example and its snippet can't disagree at authoring time; `CONTRIBUTING-starter.md`
> now says to keep them in step by hand thereafter. The index page lives at `components.mdx`
> *beside* the directory, not `components/index.mdx`: the renderer has no implicit
> directory-index mapping, so the latter serves at `/components/index` and a reader typing
> `/components` gets a 404 (upstream's own URL is `/components/index`, so this isn't a
> compatibility gap — just a nicer URL).
>
> Two real bugs fell out of the sweep: the starter's homepage card used `icon="puzzle-piece"`, a
> **Font Awesome** name Lucide doesn't have, so it had been rendering no icon at all; and an
> audit of every `icon=` across `examples/starter`, `docs/`, `content/` and `tests/fixtures`
> found exactly one other, a deliberate fixture testing the degradation. `docs/` is clean.
>
> Pinned by `tests/unit/code-title.test.ts` (12 cases) and an extended smoke check on the
> `components` fixture asserting both title forms, the CodeGroup tab label (`>Python</button>` —
> a group renders only its *active* block, so the second fence's title exists solely as the tab)
> and a copy button on the untitled fence, with an `exclude` guard that an untitled fence never
> sprouts a language-named title bar.
>
> Verified: typecheck (root + CLI) clean, unit 1109, smoke 17 pages, crawls of `docs/` 41/41,
> `examples/starter` 36/36 and the bundled scaffold template `apps/cli/template` 36/36 all
> 0×500 and 0 degraded, `mirror:cli --dry-run` typecheck outside the monorepo clean, clean-room
> tarball gate green, and in-browser: index + component pages screenshotted light and dark, the
> copy button confirmed appearing on hover and reaching the `Copied` state (which only happens if
> `writeText` resolved), and no new console errors. The one console error present — "Encountered a
> script tag while rendering React component" — is the root layout's no-flash theme script and
> predates this work; a page with zero fences shows it too.
>
> **Status (2026-08-24): pre-publish security pass on the CLI.** Everything below was probed
> against the real packed tarball and a running server, not read off the source — several of the
> conclusions I'd have drawn from reading were wrong.
>
> **Clean:** traversal above the content root is refused in every encoding tried (`../`, `..%2f`,
> double-encoded, backslash, absolute); SSRF through `/_next/image` is refused for every sink
> (external https, `169.254.169.254` IMDS, loopback-to-self, `file://`, protocol-relative) because
> `remotePatterns` is empty; the route surface is exactly four routes with no `/monitoring` tunnel,
> no auth, no admin; `npm audit` over all **198 vendored packages** at shipped versions reports
> **0 vulnerabilities**; no `postinstall`/`preinstall`, so installing runs no scripts; no
> telemetry endpoint; the search route neither reflects input nor chokes on a pathological query;
> a secret sweep for 14 credential shapes plus internal infra found only false positives
> (`ta`**`sk-async`**`-storage`, `a`**`sk-user-about`**`-…` matching an `sk-` pattern); the five
> shipped `.js.map` files are empty stubs with no `sourcesContent`; binds `127.0.0.1`, sends no
> CORS headers.
>
> **FIXED — `/dbasset/*` was an arbitrary-file reader for the previewed folder.** `middleware.ts`
> only rewrites known asset extensions, which reads like the filter — but its matcher *excludes*
> `dbasset/`, so the route is reachable directly and had no allowlist of its own, just an
> `application/octet-stream` fallback. `/dbasset/.env` returned the secret; so did `id_rsa`,
> `docs.json`, `index.mdx`. Someone running `papervine dev .` at a project root was serving their
> own secrets over loopback. The route now serves only the extensions it has a content type for —
> the same set middleware routes there — and the fallback type is gone.
>
> **FIXED — a symlink in the repo escaped the content root.** The containment check was lexical,
> so `link -> /etc` inside the previewed folder made `/dbasset/link/passwd` readable: the path is
> inside on paper and `readFile` follows the link. Containment is now re-checked on the
> `realpath`'d target. The subtle part is that this *needs* the root realpath'd too — `/tmp` is a
> symlink to `/private/tmp` on macOS, so comparing a resolved target against an unresolved root
> would 403 every asset for anyone previewing under `/tmp`. Verified both directions: a symlinked
> `.png` pointing outside gets 403 while a real one gets 200, and serving *through* a symlinked
> content dir still works.
>
> **Threat-model correction worth recording:** both of those are defence-in-depth, not holes,
> because the MDX trust boundary is already total (below). They matter for the *benign* repo case
> — another local process, or a browser page via DNS rebinding — not against a hostile repo,
> which has strictly more power already.
>
> **FIXED — `HOSTNAME` decided the bind address.** The LAN escape hatch read `HOSTNAME`, which the
> environment sets for unrelated reasons: Docker to the container id, Kubernetes to the pod name,
> interactive shells export it. So in a container the server bound the container's hostname,
> `curl 127.0.0.1:3000` was refused, and the CLI printed `http://<container-id>:3000` and said
> Ready — found by installing the tarball in `node:22-slim`, where it looked like a total failure
> to serve. A variable that ubiquitous has no business controlling network exposure, so the knob
> is **`PAPERVINE_HOST`** now and an ambient `HOSTNAME` is ignored (it's still what gets *passed*
> to Next's standalone server, since that's Next's interface — set from ours, never inherited).
> Guarded in `tests/cli-package.mjs`, which now spawns the installed binary with a deliberately
> unresolvable `HOSTNAME`; confirmed that value really does fail to bind (`ENOTFOUND`), so the
> assertion has teeth rather than passing vacuously.
>
> **Documented, not fixable: rendering a docs repo is remote code execution.** MDX expressions are
> real JavaScript executed server-side at render time. Confirmed concretely: `process.env` is
> reachable and a probe rendered a secret env var's *value* into the page, and a dynamic
> `import("node:child_process").then(m => m.execSync(...))` **created a file on disk** just from
> loading the page. `require` is undefined (ESM) but that stops nothing. This is inherent to every
> docs generator that executes MDX/JSX and can't be closed without sandboxing the render, so the
> fix is honest wording: `docs/cli.mdx` and the CLI README now say a previewed page "can read your
> environment variables, reach the network, and run commands as your user — the same power a
> `postinstall` script has" instead of the vaguer "arbitrary JSX/JavaScript", which reads like it
> might mean sandboxed component code.
>
> **RESOLVED 2026-08-24 (see the sharp/optionalDependency note below) — was: a publish blocker,
> the tarball is platform-locked.** The prebuilt server vendors
> its whole runtime, including `sharp` and libvips as **native binaries for the build machine
> only** (17MB of the 107MB extracted / 23MB compressed). Measured on a Mac-built tarball:
> `/_next/image?w=64` on a 220,526-byte PNG returns **3,124 bytes** on macOS and **1,512 bytes**
> as WebP — and on `linux/amd64` returns the **full 220,526 bytes**, unchanged, `image/png` even
> when the client sends `Accept: image/webp`. Silently: no warning, no error, `images.unoptimized`
> is `false` so optimization is expected. A 145× regression for anyone not on the publisher's
> platform. Note CI's clean-room gate runs on ubuntu and would pass, because it builds *there* —
> whichever machine publishes decides which platform works. Options: declare `sharp` as an
> optional runtime dependency and exclude the vendored copy (npm then resolves each user's
> platform, and the tarball loses 17MB), or set `images: { unoptimized: true }` so behaviour is
> identical everywhere and drop sharp entirely. Deliberately left as a decision rather than
> fixed — it changes packaging strategy and product behaviour.
>
> **Status (2026-08-24): the MDX execution model — server renders data, the browser evaluates
> author logic. Decided, then BUILT (steps 1–2).** This continues the security-pass thread
> above: rendering a repo is RCE because author MDX executes
> server-side (`run()` in `packages/renderer/lib/mdx.tsx`) with full Node scope. Two questions
> had to be answered together — how to close that, and how to match the incumbent's documented React
> support (`/customize/react-components`) so "renders as-is" stays true — because the same
> mechanism decides both.
>
> **What the incumbent does, inferred from their rules (not a runtime sandbox).** Their constraints
> are all *compile-time* tells: `function`-keyword and `export default` are rejected (pure syntax
> bans, no runtime rationale) → an **AST allowlist pass**; hooks (`useState`…`useReducer`) work
> without import → an **injected scope**; no npm / JSON / dynamic `import()` / cross-snippet /
> nested imports, "all code compiles into the page" → a **bounded static module graph, no runtime
> resolver**; hooks + `useEffect` + `navigator.clipboard` → **client-side execution**. And
> `@mintlify/mdx` depends on `next-mdx-remote-client`, whose whole job is client-side runtime MDX
> evaluation — direct corroboration. So their "sandbox" is: compile to a closed-world client
> bundle with a curated scope; nothing dangerous is ever *in scope*, rather than fenced off at
> runtime. Their published npm serializer has no guard because the guarding lives in their
> platform build layer, not the package.
>
> **The model we chose (one boundary, both products):** split by *what is provably safe to
> execute*, not by product.
> - **Server executes only data:** markdown, our built-in components (our own trusted code), and
>   literal/constant expressions. None of that is author *logic*, so there is nothing to sandbox
>   and the server never needs restricting.
> - **The browser runtime-evaluates author logic:** `export const X = () => …`, hooks,
>   interactivity — compiled to a string server-side and evaluated client-side with an injected
>   `React`+hooks scope and a closed import surface.
>
> This is the same "literal-only" idea from earlier in this thread, but reframed correctly: not a
> *restriction on authors* (they can still write hooks; those just run client-side, exactly as
> the incumbent does) but the *line between server-render and client-eval*. It satisfies every
> requirement at once — **security** (author logic never runs on the server → no RCE, hosted or
> CLI; the code simply is not there, so no worker/`vm`/scope-stripping is needed), **compatibility**
> (hooks and interactivity work → incumbent parity), **perf** (server path stays static and
> cacheable; client eval only on pages that use author components), **CLI** (the evaluator is a
> runtime lib in the prebuilt bundle, NOT the Next bundler — so prebuild stays; dropping it was
> considered and rejected: it only removes one CLI bundler constraint while re-paying the whole
> §10.6 toolchain/compile/deps cost and does nothing for the multi-tenant case, where a live
> per-request bundler is the RCE surface, not a fix for it), and **elegance** (one mechanism in
> `packages/renderer`, shared, no per-product divergence).
>
> **Proof-of-concept (2026-08-24), verified end to end before committing to the design:**
> - *Injection mechanism (Node).* `run(code, opts)` is `new AsyncFunction(code)(opts)`, so inside
>   the compiled body `arguments[0]` is the options object. Injecting hooks is therefore a
>   one-line prelude — `const {useState,…} = arguments[0]._pvHooks;` prepended to the compiled
>   source, with the hooks passed in `opts._pvHooks`. No globals touched. On our REAL compiled
>   output: without injection, `run()` throws `useState is not defined` (the exact 500 we hit
>   probing the current renderer); with it, the same source renders `COUNTER_0` plus the
>   surrounding markdown.
> - *Client island (real browser).* Server (Node) compiled the MDX to a ~900-byte string written
>   into the page as inert data; a browser bundle (React + `run()` + injected hooks, one IIFE via
>   esbuild, no toolchain) evaluated it and mounted the component. The **static HTML the server
>   produced contained no `COUNTER` at all** — proving the author component never executed
>   server-side — and two clicks in a real browser drove it `COUNTER_0 → COUNTER_2`, proving
>   genuine client-side `useState`. So: server compiles (compilation does not execute author
>   code), browser evaluates, state works, secrets are never in reach.
>
> **Phased plan, cleanest first:**
> 1. **Server-side:** render markdown + built-ins + literal expressions only; stop executing
>    author logic server-side. *This is the step that kills the RCE.*
> 2. **Client evaluator** (`packages/renderer`) with injected `React`+hooks scope for author
>    components, shipped in the bundle. *This restores compatibility and fixes the `useState`
>    500.* Also owes the C1 validation (arrow-const exports only, closed imports), snippet gather,
>    and a "degrade, don't 500" boundary for author code that throws inside the browser eval.
> 3. **Optional later:** worker-backed SSR (empty `env`, stripped globals, denied module
>    resolution — a separate PoC in this thread showed `new Worker(f,{env:{}})` gives 0 env keys,
>    `new Function("return process")()` does not recover a removed global, dynamic `import()` is
>    deniable via a loader hook, and runaway renders are killed by `terminate()` + a parent
>    timeout with the parent surviving) for the narrow case of an author component that must
>    appear in SSR HTML. NOT needed for the baseline, which is why the baseline is simpler than
>    the worker.
>
> **Decided (C4): client-evaluate every author component; the server renders only provable
> data.** The fork was whether a *static* author component (no hooks, purely presentational) that
> today renders in SSR HTML should keep server-side SSR behind the step-3 worker (C3) or be
> client-evaluated like everything else (C4). C4, on three grounds, in priority order:
> 1. **Security by construction, not by containment.** With C4 no server code path ever evaluates
>    author logic, so server-side author-RCE is *impossible*, and no sandbox has to stay correct.
>    C3 keeps author code running server-side (de-privileged in the worker) plus a classifier
>    deciding "is this static?" — both must be correct forever, and a classifier that mislabels a
>    dynamic component as static is an RCE. For a multi-tenant product (attacker ≠ victim),
>    "can't happen" beats "contained if the sandbox holds."
> 2. **One path.** C4 is a single mechanism for all author components. C3 is two paths + a
>    classifier + the worker on the critical path indefinitely — the divergence the whole model
>    set out to avoid.
> 3. **No hydration mismatch.** SSR-then-hydrate (C3) requires the server HTML to match the
>    client's first render exactly; author code running in two environments (stripped worker vs.
>    real browser — `window`, `Date`, `Math.random`) is a prime mismatch source. C4 is
>    client-only render, so that class of React-19 hydration bug cannot occur.
>
> The cost is narrow: author components are absent from SSR HTML. But the content that must be in
> SSR HTML for docs (prose, headings, links, code) is markdown + built-ins, which C4 still renders
> server-side; author-defined components are near-always interactive widgets, which are
> client-side regardless. Mitigate the one visible symptom — layout shift — with a server-rendered
> placeholder that reserves height.
>
> **The one scenario that would reopen this:** an author component rendering *indexable text* that
> must be in SSR HTML for SEO (a content-bearing `<Pricing>`/`<FAQ>` with no hooks). If that
> pattern proves common among real customers, it is the specific trigger to add C3 via the step-3
> worker — as an **opt-in** path, not the baseline. C4 does not foreclose it: shipping C4 first
> and adding the worker only when a real case demands it is strictly less wasted work than
> building the worker on spec. So the worker stays the documented escape hatch, unbuilt until
> needed.
>
> **Caveats recorded so they are not rediscovered:** the dev/prod JSX-runtime match applies to
> this path too (compile `development` flag must match the evaluator's runtime, or React 19 throws
> the "production element in development" error — the same gotcha that made us leave plain
> next-mdx-remote); and the PoC proved the mechanism, not a clean console — a `pageerror`/React
> `console.error`-failing e2e (the `editor.spec.ts` pattern) is still owed on the real island.
>
> **Status (2026-08-24): steps 1 and 2 SHIPPED.** The split is live in `packages/renderer`.
>
> - **`lib/author-code.ts`** — the pure decision layer. `isServerSafeExpression` (literal-only,
>   allowlisted so an unrecognised ESTree node is a "no" rather than an assumption), `inspectEsm`
>   (named arrow-const exports and `/snippets/` imports only) and `findDynamicImports`. 24 unit
>   tests, written against hand-built ESTree so a parser change can't silently move the goalposts.
> - **`remarkCollectAuthorCode`** — runs first in the remark chain, so it classifies the author's
>   own syntax rather than our transforms' output (`<PvCodeTitle>`, `<Mermaid>`, `<PvImg>`), and
>   fills a collector cached alongside the compiled source. Compile cache key `v4 -> v5`.
> - **`Mdx()` now branches.** Violations degrade to the notice *before* anything is evaluated on
>   either side. Author code goes to `ClientMdx`. Everything else takes the unchanged server path.
> - **`components/ClientMdx.tsx`** — the browser evaluator: the hook prelude, the shared component
>   map, and an error boundary so an author component that throws at *render* time degrades
>   instead of escaping the try/catch (the exact trap that made a `useState` page 500).
> - **`lib/mdx-runtime.tsx`** — the client-safe half of `mdx.tsx` (component map, Fallback,
>   `applyTenantUrls`, `TenantImage`), extracted because a client component cannot import a module
>   that pulls in `next/cache`. Moved, not copied: one definition, used by both sides.
>
> **Measured results.** The `{process.env.DATABASE_URL}` probe that previously rendered
> `postgres://user:pw@loc...` and a marker secret into a page now yields **zero occurrences of
> either secret in the server response**, and the browser renders `unreachable` for all three
> probes because `process` does not exist there. The hooks page that returned **500**
> (`useState is not defined`) now returns **200** and drives `COUNTER_0 -> COUNTER_2` on click in
> a real browser. A page importing `node:child_process` with an `export default` returns 200 with
> a notice naming both violations, evaluated on neither side. Crucially, the marker
> `STATIC_COMPONENT_RENDERED` appears in the response **only inside the compiled-source string
> shipped as inert data** (`const Static = () => _jsxDEV("b", {children: "..."})`), never as
> rendered `<b>` markup — the server compiled without executing.
>
> **No perf regression:** an audit classifying every page across `docs/`, `examples/starter`,
> `content/` and `tests/fixtures` found **94 of 96 on the unchanged server fast path**; the only
> two that client-evaluate are the fixtures written to exercise the new paths. Literal props
> (`cols={2}`, `tags={["release"]}`, `value={{light,dark}}`) classify as data, which is why real
> content is untouched. And the MDX **compiler does not reach the client bundle** — `@mdx-js/mdx`
> is `sideEffects: false`, so importing only `run` tree-shakes the rest away (verified by grepping
> the built chunks for `micromark`: absent; for `_pvHooks`: present).
>
> **A unified gotcha worth recording:** `remarkPlugins: [remarkCollectAuthorCode(report), ...]`
> passes a *transformer* where unified expects an *attacher* — it invokes it with no tree, the
> compile throws, and **every page degrades to the notice**. The symptom is not a crash but a
> site-wide silent downgrade, and the smoke suite caught it as missing markers. Use the tuple form
> `[[remarkCollectAuthorCode, report], ...]`.
>
> Guarded by `tests/unit/author-code.test.ts` and two smoke fixtures: `author-code` (asserts
> `{"SERVER" + "_EVALUATED"}` — whose concatenated result appears nowhere in the source or the
> compiled module, so finding it in the HTML would prove server evaluation) and `author-violation`
> (asserts the notice). Verified: typecheck (root + CLI) clean, unit 1133, smoke 19 pages, crawls
> of `docs/` 42/42 and `examples/starter` 36/36 both 0x500, `mirror:cli --dry-run` typecheck
> outside the monorepo clean, and the clean-room tarball gate green.
>
> **Still open:** step 3 (worker-backed SSR) remains unbuilt by design, per the C4 decision above.
> Snippet *resolution* is unchanged (GAP-REPORT) — the import is allowed, resolving it is separate.
> The `pageerror`-failing e2e for the client island is still owed.
>
> **Status (2026-08-24): the classifier missed JSX spread attributes — found by probing, fixed.**
> The first version checked `mdxJsxAttribute` and its value expression, which is a list of node
> *type names* — and enumerating that list is how things get missed. A JSX **spread**
> (`<Card {...process.env} />`) is a different node (`mdxJsxExpressionAttribute`), so it was never
> judged: it classified as server-safe and **leaked a real env var into server HTML**, verified
> with a live probe. The fix judges embedded JavaScript by **shape** — any node carrying
> `data.estree` is an expression to check — rather than by a name list, so a node type added later
> is caught by default. Pinned by a spread case in the `author-code` fixture, asserted with the
> same concatenation trick (`{..."SPREAD" + "_EVALUATED"}`) whose result exists nowhere in the
> source.
>
> **And the fix appeared not to work, because the *classification* is cached.** `compileMdx`
> caches the report alongside the compiled string, so tightening the classifier without bumping
> the key keeps serving the old verdict and a page that should now go to the client keeps being
> evaluated on the server. Key `v5 -> v6`. Second time this trap has bitten in one day; the
> comment at the cache key now says the classification is cached too, not just the source.
>
> **Status (2026-08-24): `sharp` moved to an optionalDependency — the platform-locked tarball is
> fixed.** Recorded above as the one open publish blocker; the resolution reverses the earlier
> lean toward `images: { unoptimized: true }`. The argument that changed it: **people will run
> this in production.** "Previewer, not a deployer" is about publishing (no `deploy`, no `login`),
> not about whether it can serve — it runs a prebuilt production Next server, and
> `PAPERVINE_HOST=0.0.0.0 papervine dev ./docs` behind a proxy is a natural self-host, consistent
> with the no-lock-in posture. For a self-hosted site, serving a 220KB image where 1.5KB would do
> is a real bandwidth and Core Web Vitals problem, not a missing nicety — so crippling
> optimization for everyone to make behaviour uniform was the wrong trade.
>
> `sharp` is the **only** platform-specific thing in the package: an audit of the packed tarball
> for native code returned exactly two files, both libvips/sharp binaries for the build machine.
> Everything else is portable JavaScript. So rather than change the distribution model (per-platform
> packages, Docker, a standalone binary — each costing the `npx papervine` entry point that the
> README, docs and marketing all lead with), the fix removes the one non-portable thing from the
> tarball and lets npm resolve it per platform through sharp's own mechanism:
>
> - `prepack` prunes `node_modules/sharp` and `node_modules/@img` (including the copies Next
>   nests under `node_modules/next/`, where the tracer actually put them — pruning only the top
>   level would have left the lock in place). This is the deliberate exception to the "leave
>   node_modules exactly as traced" rule, and it is safe for the opposite reason `typescript` was
>   not: nothing *imports* sharp, Next probes for it and degrades when it is absent.
> - A new prepack guard **fails the build if any `.node`/`.dylib`/`.so`/`.dll` survives**, in the
>   same spirit as the symlink guard — the platform lock cannot come back silently.
> - `optionalDependencies: { sharp: "^0.35.3" }`, so npm installs the right build per platform and
>   an install that cannot get one still succeeds.
> - The CLI **says so at startup** when optimization is unavailable. The original objection was
>   never that optimization might be missing; it was that it failed *silently and differently per
>   machine*.
>
> **Measured, cross-platform.** A **Mac-built** tarball installed on `linux/amd64` in Docker now
> resolves `@img/sharp-linux-x64` + `libvips-cpp.so`, ships zero binaries inside the vendored
> server tree, and returns **3,124 bytes** for `/_next/image?w=64` on a 220,526-byte PNG —
> **1,512 as WebP** — which are the same numbers macOS produces. Before: the full 220,526 bytes,
> silently. Installed with `--no-optional`, it still serves and prints the warning. Tarball
> **23MB -> 15MB**; `server/` 107MB -> 89MB.
>
> Guarded in `tests/cli-package.mjs`: the tarball audit now fails on any native binary, and the
> install step asserts `sharp` resolved for the running platform. Both hold on macOS and ubuntu,
> so CI catches a regression wherever it runs.
>
> **Consequence for the trust story:** with author code no longer executing server-side, the
> README/`docs/cli.mdx` claim that previewing a repo can "read your environment variables and run
> commands as your user" is no longer true, and both now say so accurately — the RCE payload that
> previously created a file on disk is refused outright (dynamic `import()` is a contract
> violation), and the env probe renders `unreachable`. What remains, and is stated, is that it is
> still someone else's JavaScript in your browser on the preview's origin.

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

> **Update (2026-08-08):** the seam paid off exactly as designed — invitations now send for real
> through Resend with no change to the action or the UI (§11.1). The **Copy-link stays**: it
> works when email is unconfigured, and it's the fallback when a message lands in spam.

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

> **Status 2026-08-24 — split into a real console.** It was one page: four stat cards followed by
> an unbounded stack of org cards, each inlining that org's members and sites. Fine at three
> customers, unusable at thirty — and there was no way to answer "which sites are stuck in
> draft?" or "is anything failing across tenants?" because sites only existed nested inside their
> org's card. Now a list → detail console with its own subnav, deliberately the same two-mode
> shape as `SettingsNav` (mobile pill strip / desktop grouped sidebar) so it reads as part of the
> product: **Overview** (counts + newest orgs/sites/recent deploys), **Organizations** (searchable
> table → per-org detail carrying the members, impersonate controls and sites), **Sites**
> (cross-tenant, the view that didn't exist), **Deploys** (cross-tenant activity, with the error
> inline — a run of failures spanning customers means something of *ours* broke), and the existing
> **Billing**. `ADMIN_NAV` in `src/lib/admin-nav.ts` is the single source of truth; its one piece
> of real logic is `activeAdminSlug`, longest-prefix rather than equality, so a detail route keeps
> its parent tab lit.
>
> Every query is now bounded — counts are aggregates, lists are `LIMIT`ed, and rollups are
> computed only for the ids on the current page. The old page fetched every org, member, site,
> deploy aggregate and analytics aggregate to render one screen.
>
> Two SQL dead ends worth not repeating, both recorded in `admin/data.ts`. Joining four GROUPED
> subqueries failed because each aliased its count `"n"`, so drizzle rendered every reference as a
> bare `coalesce("n", 0)` — ambiguous, query rejected. Rewriting them as correlated scalar
> subqueries failed differently: drizzle renders columns inside a `sql` template UNQUALIFIED,
> giving `(select count(*) from "member" where "organization_id" = "id")`, which Postgres can't
> resolve either. The working shape is aggregate-in-SQL, join-in-JS, bounded by the page's ids.
>
> The allowlist gate moved to the layout (it can't be forgotten when a section is added) and is
> ALSO called per page: Next renders a layout and its page concurrently, so a layout-only gate
> still lets a cross-tenant query run before the 404 wins. `getSession` is per-request cached, so
> the second check is ~free. Still read-only apart from the pre-existing impersonate and billing
> actions.

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

### 10.11 Creating a site — the start-method chooser

Adding a site is a **choice of where the content lives**, not a repo form. `/:org/connect`
presents the start methods as a card list; picking one expands its fields inline, and one
primary button submits.

Two ways in today:

- **Start from scratch** — a **Papervine-hosted** site. No repo, no GitHub account. The draft
  buffer (`editor_session` / `draft_file`) is the source of truth, and publishing writes it
  straight into the site's object-storage prefix. Seeded at creation with a starter
  `docs.json` + two pages, so it renders immediately.
- **Connect a GitHub repo** — the existing flow, unchanged: `syncSite` copies repo → storage
  and the editor publishes by commit or PR.

The discriminator is **`site.source_kind`** (`'git' | 'native'`, default `'git'`). Deliberately
*not* `contentSource`: `ContentSource` is already a renderer type, and **both kinds render
through the same `s3Source`** — only the *authoring* source of truth differs. Read it through
the three predicates in `src/lib/site-source.ts` rather than comparing the string inline:
`isNativeSite` (affirmatively-hosted copy), `hasGitRepo` (the honest gate for every repo-shaped
control — also false for a git site whose connect never completed), and `hasRenderableSource`
(the render gate).

**Hosted publish** (`src/lib/native-publish.ts`, pure core in `native-publish-plan.ts`) is
**at-least-once and retry-safe, not atomic**. There is no transaction across N object writes,
so: writes are phased **pages → `docs.json` → deletes** (a partial publish never leaves
navigation pointing at absent pages, and a crash before the deletes leaves orphan objects the
renderer can't see rather than nav entries that 404), and the session is left **open** on
failure so the drafts survive and a retry is an idempotent overwrite. Real atomicity needs a
content-addressed prefix (`sites/{id}/@{rev}/` + a pointer flip) — which would also fix the
concurrent-sync race — and is the deferred upgrade for both. Until then, concurrent publishes
reuse the existing `syncInFlight` time-window guard rather than a second mechanism; the
`pg_advisory_xact_lock` named earlier in §3 remains the real fix, and this is the cheapest
place to prove it when we get there.

**`updatedAt` is load-bearing.** The content-cache version key is
`${lastSyncedCommitSha ?? ""}:${updatedAt}`, and a hosted site's sha is null *forever* — so
`updatedAt` is the entire key. The bump therefore lives in exactly one place,
`markSiteLive` in the new `src/lib/deployment-log.ts` (which also holds the `openDeployment` /
`resolveDeployment` pair that `runSync` and the connect flow had each copy-pasted). Its
revalidation is wrapped in try/catch: `markSiteLive` is reachable from a Trigger.dev task and
from `after()`, neither of which has a Next request context, and the bytes are already written
by then — the `updatedAt` write is the invalidation that always works, the tags just make it
immediate instead of TTL-bounded.

**No sidecars for a hosted site.** `.manifest.json`'s values are *git blob SHAs* and its only
consumer is `planSync` inside `syncSite`, a path a hosted site never enters; absent is also
positively correct for a future git-upgrade, whose first sync must be full. `.dimensions.json`
absent means `{}` by `s3Source.loadAssetDimensions()`'s contract, and the starter ships no
images — **but the moment the editor can upload an image to a hosted site, that upload must
measure and merge dimensions**, or hosted sites permanently lose `next/image` sizing.

Repo-shaped UI degrades through the predicates above: the Re-sync button, the Repository row
(replaced by **Source: Papervine — edited in Studio**), the *Git settings* nav item **and its
route** (`notFound()` — hiding a link is not gating a URL), the editor's branch switcher, and
Publish's PR/commit menu entries. `publishModeFor` returns `'native'` for a hosted site on any
branch, and `PublishResult` gained a third arm (`mode: 'native'`) rather than a fabricated sha
— `publishResultRef` is what the two automation call sites use to record a commit sha, a PR
URL, or nothing.

> **Status 2026-08-23 — "no changes" was lying on every hosted automation run.** A run's status
> chip and its **Result** row both derived from `resultRef`: `!resultRef` meant "no changes".
> That was a safe proxy while every publish was a commit or a PR, but a hosted publish has
> neither, so `publishResultRef` returns null **forever** — and every successful hosted run
> rendered as *no changes* / "No changes were needed." on a page that simultaneously listed the
> file it changed and an agent summary describing the edit. The stored row was correct
> throughout; only the reading of it was wrong. Fixed by making the predicate mean what it says:
> `changedFiles` is the authoritative signal (`runDidChangeNothing`, `runResultKind` in
> `run-display.ts`), and a hosted run that changed something now reads **succeeded** /
> "Published to the live site." A missing ref is still checked *first* so a legacy row that has
> a sha but no recorded `changedFiles` keeps reading as a real result. Deliberately **not**
> fixed by stamping the deployment id into `resultRef` — same reasoning as refusing a synthetic
> `pub_<id>` in `last_synced_commit_sha`: a column named for a ref shouldn't carry a non-ref,
> and the UI would render the UUID as though it were a sha. The lesson worth keeping: when a
> hosted site made one field permanently null, every consumer that had been using that field as
> a proxy for something else silently inverted its meaning — grep the consumers, don't just
> null-guard the producer.
>
> Audited the sibling proxies while here. `fireContentUpdateAutomations`' skip-unchanged guard
> (`runs.ts`) compares `siteSourceSha` against the last succeeded run's, and on a hosted site
> both are null forever — but it's written `if (docsOnly && sourceSha)` / `if (lastSha && …)`, so
> the nulls make it fail **open**: a hosted run proceeds instead of being skipped forever. That's
> the safe direction and needs no fix; the cost is that hosted sites don't get the
> skip-unchanged optimization at all. Giving them one means feeding it a content version that
> *does* change — the `updatedAt`-based cache-version key is the obvious candidate — which is a
> follow-up, not a defect.

Branch semantics are unchanged: a hosted site keeps `branch = 'main'` as an inert label for the
published stream. Dropping the concept would mean a nullable `editorSession.baseBranch`, a
changed `draftSource` cache key, and touching the partial unique index — for no gain, since
working branches there are already just Postgres draft namespaces.

> **Status — start-method chooser + Papervine-hosted sites (2026-08-21).** `/:org/connect` is
> no longer a repo form; it's the chooser described above (`NewSiteChooser.tsx` +
> `GitConnectFields.tsx` / `ScratchFields.tsx`, on the shadcn **RadioGroup** retargeted to
> `@radix-ui/react-radio-group` to match this repo's scoped-radix convention, so radiogroup
> semantics and arrow-key nav come for free). **One route, client step state:** `connectHref`
> is the redirect target for a site-less org and the Git path's shell already carries
> `maxDuration = 300` plus the `githubInstallation` lookup, so a second route would duplicate
> both and gain nothing, while a `?method=` param would round-trip the server on every radio
> click and lose the inline expansion. The URL kept its name deliberately — renaming to
> `/:org/new` would cost `connectHref`, `RESERVED_SITE_SLUGS`, three e2e URL waits and two
> `SiteSwitcher` links for a cosmetic gain. **One `<form>` wraps the card list AND the submit
> button**, with the action chosen by the selected method: only the selected method's fields
> are mounted, so a single dynamic action is unambiguous. Framing is state- and role-aware —
> *Create your first site* for a site-less org (no Back link: `/:org` redirects straight back
> here, so one would loop), *Add a site* otherwise, and the scratch card renders
> disabled-with-a-reason for a `member`, since Studio is gated to `editor.workspace: "admin"`
> and they'd otherwise create a site they can't edit. Post-create landing is the pure
> `postCreateHref`: Studio for anyone who can see it, Overview otherwise — so it follows the
> feature gate with no code change. Migration `drizzle/0023_slippery_vermin.sql` is one
> additive `ADD COLUMN` (Postgres fills `NOT NULL DEFAULT` from the catalog; no backfill, and a
> pre-existing row with a null `repo_owner` is a *failed git connect*, not a hosted site).
> Also landed here: `insertSiteWithUniqueSlug` retries the check-then-insert slug race that
> used to 500 `connectRepo` (hosted sites make collisions far likelier — everyone types
> "Docs"), `TEXT_CONTENT_TYPE` names the content type both storage writers share so hosted and
> synced storage are indistinguishable, and two CSS tokens the old connect form was the only
> user of (`--border`, `--bg-subtle`) were replaced with the real `--line` / `--card`.
> **The one thing not to regress:** `fireContentUpdateAutomations` deduped on
> `commitSha ?? \`manual-sync-${randomUUID()}\`` — a *fresh* key every fire, which defeats the
> self-trigger loop breaker its own comment describes. A hosted publish always has a null sha,
> so a `content_update` automation that published would re-trigger itself until
> `DAILY_RUN_CAP` (500/day) stopped it. Fixed both ways: the parameter is now a general `ref`
> (callers pass `commit?.sha ?? deploymentId`, which also hardens the manual-sync path), and
> an automation's own publish passes `origin: "automation"` to suppress the fan-out entirely.
> Verified end-to-end in a browser on a seeded hosted site: create → seed → render at
> `{slug}.localhost` → edit in Studio → Publish → the edit live on the tenant host, with the
> Activity feed reading "Published from the editor", and the Git path (Re-sync, Repository row,
> Git settings, branch switcher, PR/commit menu) unchanged. Tests: `tests/unit/`
> `site-source` · `site-template` · `native-publish-plan` · `native-publish` · `start-methods`
> (new), `authoring-publish` · `authoring-tools` · `publish-mode` · `settings-nav` ·
> `dashboard-nav` · `overview` (extended), and `tests/e2e/new-site.spec.ts` — the chooser and
> every degradation deterministic in CI, the create journey `@external` because it needs
> MinIO. Smoke gained no check: the page needs a session *and* Postgres, so the only DB-free
> fact — the `/login` redirect — was already covered.
>
> **Status — hosted → Git conversion (2026-08-22).** Hiding *Git settings* on a hosted site
> was wrong: the first thing anyone does after writing in Studio is look there for a way to
> connect GitHub, find nothing, and conclude it's impossible. The item is now shown for **both**
> kinds and the page branches — a Git site gets the re-point form, a hosted site gets
> **Connect to GitHub** (`ConnectToGitHubForm`). `settingsNavFor`'s `hasRepo`/`gitOnly` gating
> is gone with it.
>
> The operation is a **hand-over, not a re-point** (`convertToGit`): read the site's live
> content out of storage, commit it into the target repo, then flip `source_kind` to `'git'`,
> set the repo columns, and let the normal sync pull it back. `saveGitSettings` still refuses a
> hosted site and now points at this action, because *it* would attach a repo without moving
> the content over first — the destructive path the refusal was always guarding.
>
> **An empty repo needs no decision; a non-empty one gets asked about.** `repoEmptiness`
> (`src/lib/git-conversion.ts`) classifies the target, treating GitHub's initializer files
> (`README`/`LICENSE`/`.gitignore`, top level only) as still-empty — otherwise we'd reject the
> exact thing we tell people to create. `commitFiles` gained parentless-initial-commit support
> (`baseCommitSha: null` → no `base_tree`, `parents: []`) so a repo with *no* commits works
> too, with `createBranch` creating the ref instead of `updateRef` moving it.
>
> An earlier cut of this **refused** non-empty repos outright, on the grounds that merging two
> `docs.json` navigations has no safe answer. The merge premise still holds — but refusing was
> the wrong conclusion, because a repo with existing docs is a legitimate target and the owner
> knows which side is current. So `handOverToGit` takes a `resolution` (`'local' | 'repo'`) and
> **never guesses**: without one it returns `needsResolution`, which the UI turns into a
> which-version-wins dialog rather than an error.
>
> **The two outcomes aren't symmetric, and that's the whole design.** `'local'` commits the
> hosted content over the repo's, whose version survives in git history — safe by construction.
> `'repo'` lets the sync overwrite the storage prefix, and the hosted pages have **no history to
> fall back on**, so they're committed to a **`papervine/hosted-content`** branch first (landing
> on its tip when re-run, avoiding the non-fast-forward trap `publishDraft` documents). Nothing
> is unrecoverable either way. `'repo'` additionally requires the repo to carry a
> `docs.json`/`mint.json` — adopting one without a config leaves the site with nothing to
> render and `loadConfig` **throws**, so that option is refused server-side and disabled in the
> dialog rather than flipping the site into a permanently 500ing state.
>
> Ordering makes every failure recoverable: commit → flip the row → sync. A crash after the
> commit leaves a repo holding the content and a still-hosted site (re-run it); after the flip,
> a Git site whose repo has everything (a Re-sync finishes it).
>
> **Status — one-click repo creation (2026-08-22).** An earlier note here claimed a GitHub App
> can't create a repo on a personal account. **That was wrong**, and the correction matters:
> GitHub documents `POST /user/repos` as **Administration: write, UAT ✓ / IAT ✗** — an
> *installation* token can't, but a **user access token** from the same App can. So no separate
> OAuth provider is needed; the App just has to act as the person rather than as the
> installation. That's what a competitor's "Authorize with GitHub — we'll need access to create
> or connect a repository" screen is doing.
>
> Built as `src/lib/github-user-auth.ts` + `api/github/user-auth/callback`: authorize →
> exchange `code` for a user token → `POST /user/repos` (`auto_init: true`, so a first commit
> exists and `repoEmptiness` still passes — a top-level README is an initializer file) → the
> same `handOverToGit`. The hand-over core was extracted to `src/lib/git-handover.ts` so the
> manual and one-click paths share the risky part. Gated on `GITHUB_APP_CLIENT_ID` /
> `GITHUB_APP_CLIENT_SECRET`: unset, the UI shows only the manual path, so this degrades like
> every other configured layer.
>
> **The user token is never persisted.** It can create repositories, it's needed for exactly
> one call, and the whole exchange completes inside one callback request. What crosses the wire
> is the `state`, which is AES-GCM-encrypted via the existing `encryptSecret` — GCM is
> authenticated, so a tampered state fails to decrypt rather than steering the flow, and the
> site/repo names aren't readable in the URL. Authorization is still re-derived from the
> session in the callback; the state is a hint, never a capability.
>
> **The constraint that shaped the design:** `PUT /user/installations/{id}/repositories/{id}`
> — "add a repository to an app installation" — is documented as **PATs (classic) only**, so we
> *cannot* programmatically add the freshly-created repo to the App installation. The push
> therefore tries the installation token first (the durable credential syncs will use) and
> falls back to the user token; if neither can reach the new repo, the callback reports that the
> repo *was* created and names installing the App on it as the fix, because otherwise a retry
> just hits "repository already exists" with no explanation.
>
> **Still not built:** "download my content as a zip". `src/lib/tar.ts` only *reads* archives
> and `export-content.ts` feeds the PDF export, so there's no archive writer to reuse.

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

- **Owns its own schema in our Postgres.** Every deployment runs the exact same code
  with zero third-party accounts to provision; no separate configuration fork (resolves
  the spirit of Open Question §16.4). This rules out Clerk/Auth0 as the
  *core* — they'd bake a vendor dependency into the product itself.
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
fastest DX, only if we decide a vendor-free core is *not* a real goal (we've decided it is).
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

> **Status (2026-08-08) — Google sign-in landed, optional and off by default.** Better Auth's
> `socialProviders.google`, gated on `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`: with either
> half missing the provider isn't registered and the auth pages render no button, so a bare
> checkout, CI, and the zero-dep smoke gate need no OAuth setup. The enable/disable decision is
> a pure function (`src/lib/social-auth.ts`, unit-tested) read by the server components behind
> `/login` and `/signup` — the pages became server shells around client forms so the answer
> never has to be mirrored into a `NEXT_PUBLIC_` variable.
>
> **The design problem was the redirect URI, and it's a host problem, not an auth problem.**
> Sign-in happens on the app host (§10), so the obvious URI is
> `app.papervine.io/api/auth/callback/google` — but **Google refuses to register any `http://`
> redirect URI on a subdomain of `localhost`** ("Invalid Redirect: must end with a public
> top-level domain"), so `http://app.localhost:3000/…` is unregisterable and local dev could
> never exercise the flow. Options were (a) app host in prod + a dev-only detour, or (b) the
> apex everywhere. We chose **(b)**: the provider's `redirectURI` is pinned to
> `${BETTER_AUTH_URL}/api/auth/callback/google` (the apex), and `middleware.ts` forwards
> `/api/auth/callback/*` from the apex to the app host — extending the bounce that already
> moves apex `/login`/`/signup` there. One URI to register, and the dev path is the prod path
> rather than a code path that only ever runs on a laptop. It must be a **redirect, not a
> rewrite**: the PKCE/state cookies are host-only on `app.`, so the browser has to re-issue the
> request there or the code exchange always fails.
>
> **Account linking keeps Better Auth's secure default.** A Google identity only folds into an
> existing account whose local email is already verified; we have no verification flow, so a
> collision with a password account surfaces as "sign in with your password instead" rather
> than merging. Loosening it (`requireLocalEmailVerified: false`) would make pre-registering a
> victim's address a working account takeover — the classic pre-hijack. Revisit when email
> verification exists, or by adding an explicit "link Google" action for a signed-in user.
>
> Verified: unit tests for the enable/redirect-URI/error-mapping helpers and for the middleware
> forward (`social-auth.test.ts`, `middleware-routing.test.ts`); typecheck + `npm test` green;
> in-browser on a dev server with dummy credentials — button renders in both platform themes,
> console clean, the outbound authorize URL carries
> `redirect_uri=http://localhost:3100/api/auth/callback/google`, and the apex callback 307s to
> the app host with `?code`/`?state` intact. **Unverified:** a real Google account completing
> consent — that needs live credentials from the Google Cloud console.

> **Status (2026-08-08) — transactional email, and the verification gap closed.** Papervine had
> **no email at all**: invitations were a `console.log` + a Copy-link UI (the 2026-06-29
> decision below), there was no password reset, and `emailVerified` was `false` for every
> account ever created — which is what made Google account linking refuse (above). One gap,
> three symptoms.
>
> **Provider: Resend**, behind a one-function seam (`src/lib/email.ts` → `sendEmail(to, body)`),
> with bodies built by pure functions in `email-templates.ts`. Chosen for the TypeScript/Next
> fit and because templates live in the repo rather than a vendor dashboard — a self-hoster
> clones them with the code and swaps one `deliver` call. Same "no vendor baked into the core"
> rule that picked Better Auth over Clerk. Free tier is 3,000/month at 100/day, one domain;
> the one-domain limit is the thing to watch if per-tenant sending domains ever matter.
>
> **Optional — with an environment-dependent meaning, which is the subtle bit.** The console
> log is a **transport**, not a failure mode: outside production, no `RESEND_API_KEY` → messages
> are logged *with their links* and every flow works. In production, unconfigured genuinely
> disables the inbox-dependent flows, because "check your inbox" for a message that reached a
> log file lies to a real user. The first cut conflated the two ("no key = feature off") and
> made `/forgot-password` unreachable on every dev machine **and in e2e** — caught only because
> the new e2e spec couldn't reach its own form. `sendEmail` **never throws** — every caller is
> an auth flow Better Auth awaits, so a provider outage would otherwise surface as "sign up
> failed" on an account that was in fact created.
>
> **Sends are capped at 5s.** Better Auth awaits `sendVerificationEmail` *inside* the sign-up
> request, so a slow provider makes signup slow and a hanging one holds it open until the
> platform timeout — for an operation whose real work is already committed. Found concretely:
> a real key in a dev `.env.local` turned e2e signup into a network-bound call and stalled the
> suite. Which also exposed a **test-isolation** bug — `playwright.config.ts` now blanks
> `RESEND_API_KEY`/`EMAIL_FROM`/`GOOGLE_CLIENT_*` the way it already blanks `TRIGGER_SECRET_KEY`,
> so a configured dev machine runs the same suite as CI.
>
> **Three decisions worth keeping:**
> - **`requireEmailVerification` stays OFF.** Turning it on would lock out every pre-existing
>   account at once (all unverified). Verification's job here is to unlock Google linking and
>   make reset trustworthy — not to stand between a new signup and their dashboard.
> - **All emailed links point at the APP host, not the apex.** Better Auth builds its `url` from
>   `baseURL` (the apex), so we ignore that argument and rebuild from the raw `token` via
>   `appOriginFor()`. Verification and reset callbacks set session cookies, and those are
>   host-only on `app.` (§10) — an apex link would set the cookie on the wrong host. Note this
>   is the *opposite* of the OAuth callback, which is forced onto the apex by Google's
>   registration rules; emailed links have no such constraint.
> - **Reset revokes all other sessions** (`revokeSessionsOnPasswordReset`), and the
>   `/forgot-password` confirmation is identical whether or not the account exists (no
>   account-enumeration oracle).
>
> The password pages are excluded from the app host's signed-in bounce, alongside `/onboarding`:
> someone clicking a reset link often still holds a live session, and bouncing them to the
> dashboard makes the link useless to exactly the people who need it.
>
> **One-shot backfill (`drizzle/0021_backfill_email_verified.sql`).** Every pre-existing account
> carried `email_verified = false`, which recorded *"we never shipped verification"* rather than
> any real doubt — and it blocked all of them from linking Google. The migration flips today's
> rows to true. Cost, stated rather than buried: it asserts ownership that was never proven, so
> a password account registered on someone else's address inherits that address's Google login.
> Accepted deliberately — the exposure is bounded to accounts existing at migration time, the
> user base is small and known, and `requireLocalEmailVerified` stays ON so new accounts still
> earn verification. A data migration, not a schema change, so it needed
> `drizzle-kit generate --custom` (there's no schema diff to detect).
>
> Verified end-to-end locally (email in console mode, real Postgres): signup → verification link
> → `email_verified` flips true + session cookie set on the app host; reset request → token
> persisted → emailed link 302s to our form with `?token=` → new password signs in (200) while
> the old one fails (401) → token reuse redirects to `?error=INVALID_TOKEN`. With a deliberately
> bad API key the send failed, was logged, and the flow still completed — the never-throws
> contract. **Unverified:** real delivery through Resend, which needs a live key and a verified
> domain.

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
   first (**Google OAuth landed 2026-08-08, optional**; GitHub the same shape when wanted —
   §11.1), **Neon** Postgres (provisioned via Stripe Projects),
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
| Object storage | **S3 API** — hosted: **Cloudflare R2**, local: **MinIO** | compiled bundles, assets. Code to the S3 API (pluggable `S3_ENDPOINT`); R2 chosen for **zero egress** (docs serving is read-heavy) + built-in CDN; `S3_ENDPOINT` can point at any S3-compatible store |
| Queue/workers | **BullMQ** / serverless functions | git sync jobs |
| AI | **Vercel AI SDK** (`ai`) via config-driven `ai-model.ts` — Vercel AI Gateway or direct provider (`@ai-sdk/anthropic\|google\|openai`); **AI Elements** for chat UI | agentic assistant (§8) |
| Auth (platform) | **Better Auth** (+ `organization`) | owns its own schema, orgs + RBAC; WorkOS for enterprise SSO later (§11) |
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
- **CI** (`.github/workflows/ci.yml`): five parallel jobs — `checks` (typecheck + unit),
  `build`, `smoke`, `crawl`, `cli-package` — aggregated by an empty `verify` job that the
  deploys gate on; `e2e` job = Playwright against a Postgres service (skipping `@external`).
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
4. **Portability story.** How portable must the deployment be vs. the hosted SaaS? Affects how much we hardwire to R2/Vercel/etc. **Resolved (2026-06-08):** code to portable interfaces, not vendors — Better Auth owns its schema in Postgres (§11.1), and storage is the **S3 API** (hosted default R2, local MinIO, `S3_ENDPOINT` can point anywhere; §3.1). Domain/TLS: **resolved (2026-06-09)** — `*.papervine.io` via host-platform wildcard cert; custom domains via the host-platform domains API, escaping the per-project cap with a SaaS-domains proxy (Approximated / Cloudflare-for-SaaS / Caddy) + `X-Forwarded-Host` when it nears (§2 → Custom domains). That proxy can be swapped for Caddy on-demand-TLS directly.
5. **License & governance.** MIT vs. Apache-2.0; CLA; what (if anything) is SaaS-only (open-core) vs. fully open.
6. **Pricing/limits** for the hosted version (out of scope for build, but shapes tenancy/metering design).
7. ~~**Web editor** — defer past v1? hosted docs platforms treats it as a differentiator.~~ **DECIDED & BUILT (2026-06-14): build it now, agent-native.** Shipped the full 3-panel editor (editing-agent chat · navigation · multi-modal editor) on a shared authoring backend — see §9.2's build note. We chose to lead with the differentiating axis (agent-native) rather than defer. Editing is **Source MDX + a Preview rendered by our own renderer** (revised 2026-06-15 — the original MDXEditor WYSIWYG was dropped because a second rendering engine only approximates real-world MDX; see §9.2). Git stays the source of truth and the preview is byte-faithful to publish.

---

## 17. Non-Goals (v1)

- In-place WYSIWYG editing (we ship Source + a faithful real-renderer Preview instead; §9.2)
- Migrating from non-docs.json sources (Docusaurus/GitBook importers)
- Embeddable AI on third-party sites
- Marketplace / plugin ecosystem
- On-prem enterprise deploys

---

## 18. Cost & Performance Posture

Standing principles for infra/tooling choices, in priority order. (Originally recorded
2026-07-06; that draft was discarded uncommitted and re-recorded 2026-07-19 — treat this
section as the durable home for decisions of this kind.)

1. **Performance is paramount.** Slow is a product bug, not a cost optimization.
2. **Vendor lock-in is unacceptable.** A managed service is adopted only with a named,
   **tested** escape hatch (run it ourselves or a drop-in alternative) — verified before
   paying customers depend on the feature, not after.
3. **Cost is managed with escape hatches and metering, not bans.** No absolute technology
   bans; frame posture as defaults with measured escalation triggers.

Derived rules:

- **Use the datastore a dependency was designed for.** If a library asks for Redis, run
  Redis (commodity API — Valkey/Upstash/any `REDIS_URL` — so no lock-in); don't hand-write
  a Postgres shim. Postgres stays home for our own domain state and metering.
- **OSS libraries in our own compute over hosted runtimes.** (Vercel Eve rejected; Chat
  SDK adopted — below.)
- **AI model + route are env config, not code** (`src/lib/ai-model.ts`, every AI
  surface — assistant, editor agent, automation runs). `PAPERVINE_AI_MODEL` is a
  `provider/model` id (default `anthropic/claude-haiku-4-5` — the best model the
  gateway free tier reliably runs for our agentic use; `google/gemini-3.1-flash-lite`
  is ~10× cheaper once gateway credits/BYOK exist). `AI_ROUTING=gateway` (default)
  goes through the **Vercel AI Gateway** (auth: `AI_GATEWAY_API_KEY`, or OIDC on
  Vercel / `vercel env pull` locally — OIDC expires ~12h, so long-lived workers like
  the Trigger.dev executor need the key); `AI_ROUTING=direct` calls the provider SDK
  with its own key (anthropic/google/openai) — the no-lock-in escape hatch in both
  directions, a pure env change. (Landed via worktree-pricing + agents-workflows
  merge, 2026-07-19, replacing the earlier "direct API, no gateway" line.)
  **Per-surface override:** `PAPERVINE_AI_MODEL_AUTOMATIONS` — automations write docs
  that land in Git, so they may run a stronger writer (sonnet-class) while the
  high-volume assistant stays on the cheap default. Credit rating strips the provider
  prefix (`billing/core.ts rateForModel`) so a family costs the same on either route.
  *Bundling gotcha:* `@vercel/oidc` dynamic-imports siblings by relative path and dies
  inside an esbuild bundle — the Trigger.dev build marks it `external`
  (trigger.config.ts).
  **Local inference (2026-07-20).** `ollama/`, `lmstudio/`, and `local/` model ids
  route to any OpenAI-compatible server (`AI_BASE_URL` overrides the prefix's default
  endpoint; required for `local/`), always via the direct path — the hosted gateway
  can't reach a private network. Built with `createOpenAI({ baseURL })` rather than
  `@ai-sdk/openai-compatible`, whose current release targets provider spec v4 while our
  `ai` speaks v3; revisit when `ai` moves to v4. Local models are **rated at zero
  credits** (`creditRates.models["ollama/"]` etc., v2 of the rate table — `rateForModel`
  now matches the full provider-scoped id before the bare model, so a whole route can be
  priced). Ollama ships as an **opt-in** compose profile (`--profile local-ai`); never a
  default service (multi-GB weights; no GPU passthrough on macOS). This is a
  local-inference affordance, not the SaaS path — the honest caveat, documented at
  `/local-ai`, is that our AI is agentic and small models are unreliable at
  multi-step tool use.
  *Endpoint gotcha:* the local model must be built with the provider's **`.chat()`**
  factory, not its default — `@ai-sdk/openai` now defaults to OpenAI's *Responses* API,
  which local runtimes don't implement (Ollama rejects it with
  `unknown input item type: "item_reference"`). Every OpenAI-compatible server speaks
  `/v1/chat/completions`. **Verified live 2026-07-20:** qwen3.5 (8B-class, Ollama, M3
  Pro/36GB) ran the full read→reason→edit tool loop through our own `aiModel()` path and
  correctly fixed a broken link in 38s at zero cost — with one malformed tool argument
  that it self-corrected, which is the expected quality profile.
- **"Vercel for everything until the BIG BILL"** — acceptable only because each managed
  dependency's escape hatch pre-exists, so the exit is an engineering task, not a
  re-architecture (see §2's custom-domain proxy plan for the pattern).
- **Metering-first.** Every AI surface lands with usage metering from day one (per-run
  usage rows + the §10.2 credit accounting), so cost consequences are visible before the
  bill arrives.

Decisions under this posture:

- **Agent chat transport: Vercel Chat SDK + `@chat-adapter/slack`** (2026-07-06,
  re-affirmed 2026-07-19) — over hand-rolled Slack webhooks and over Vercel Eve. OSS
  (`vercel/chat`), runs in our compute; its state backend wants Redis, which we run per
  the datastore rule. Since adoption the adapter gained native Slack agent-experience
  support (Agent badge, Messages-tab conversations, token-streamed replies with
  post-and-edit fallback), which strengthens the call.
- **Background/agent-run executor: Trigger.dev Cloud** (2026-07-19) — resolves the §2
  executor-choice note's "not yet"; architecture + isolation rules in the §10.2 decision
  note. Escape hatch: Trigger.dev is Apache-2.0, so it can run on our own infrastructure
  if needed; one verified dry run of that path is owed before GA of automations.
