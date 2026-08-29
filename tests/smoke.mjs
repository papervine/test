#!/usr/bin/env node
/**
 * End-to-end regression smoke test.
 *
 * Boots the real renderer against tests/fixtures (a docs repo that exercises every
 * M1 fix) and crawls each page, asserting it renders without a 500. This is the
 * automated version of the manual `papervine dev` crawl we use to validate against
 * representative docs repos — it guards the GAP-REPORT fixes from regressing.
 *
 * No test framework: pure Node + fetch. Run with `npm test`.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { protectNextEnv, requireNoDevServer } from "./dev-lock.mjs";

const PKG_ROOT = process.cwd();
const PORT = Number(process.env.SMOKE_PORT ?? 4178);
// 127.0.0.1, not localhost: on some CI runners localhost resolves to IPv6 ::1
// first while `next dev` listens on IPv4, so requests never connect.
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURES = path.resolve(PKG_ROOT, "tests/fixtures");
const DIST_DIR = process.env.NEXT_DIST_DIR ?? ".next-smoke";
const nextBin = path.join(PKG_ROOT, "node_modules", ".bin", "next");

// slug, then content assertions. Every page must return HTTP 200 (i.e. never 500).
const CHECKS = [
  {
    slug: "",
    desc: "home renders (favicon links + object favicon + languages nav + lenient config)",
    // theme tokens wired: no `theme` in fixtures → default "mint", token vars injected.
    // favicon: fixtures set `{ light, dark }` → a <link rel="icon"> per scheme (apex, so the
    // path is root-absolute, assetBase empty). appearance is unset → the theme toggle shows.
    include: [
      "Fixtures Home", "Components &amp; Code", "Guide (md)", 'data-theme="mint"', "--db-radius",
      'rel="icon"', 'href="/favicon.ico"', "prefers-color-scheme: dark",
      'aria-label="Toggle theme"',
      // Social card (SPEC §5): with no authored image, a page advertises the generated one as
      // a large-image Twitter card, ABSOLUTE (metadataBase from the request Host — X drops a
      // relative image URL). The index is the site itself, so og:type is website.
      'name="twitter:card" content="summary_large_image"',
      `content="${BASE}/api/og"`,
      'property="og:type" content="website"',
      // docs.json `seo.metatags` applies site-wide.
      '@SITEWIDE_HANDLE',
    ],
    exclude: [
      "Hidden Page", // hidden:true → not in sidebar
      // The index page is served at `/`; a nav link to `/index` is a route that does not exist.
      // Next prefetches it, never records it as satisfied, and asks again — 5,257 requests to
      // `/index?_rsc` in 20 seconds from a single page load, measured through a counting proxy
      // because the prebuilt server logs nothing and dev does not prefetch at all.
      'href="/index"',
    ],
  },
  { slug: "guide", desc: ".md files are served", include: ["PLAIN_MD_MARKER"] },
  {
    slug: "components",
    // The per-page actions control (SPEC §9.1). Two things can silently go missing: the
    // control itself, and the `.md` href it copies from — which is built from the page slug
    // and the site's base path, so it's exactly the kind of thing that renders as `/.md` or
    // `/undefined.md` without anything failing. Also asserts the print stylesheet shipped:
    // without it "Download PDF" prints the sidebar and navbar onto the paper.
    desc: "the page-actions control renders with a correct .md href + print CSS",
    include: [
      "Copy page",
      "More page actions",
      // The href reaches the client component as an RSC prop, so it appears escaped in the
      // flight payload rather than as an HTML attribute. Asserted with the prop name attached
      // so this can't pass on some unrelated mention of the path.
      String.raw`\"mdHref\":\"/components.md\"`,
      "pv-no-print",
      "pv-article-row",
      "@media print",
    ],
  },
  {
    slug: "llms-noindex",
    // `noindex` withholds a page from indexes — search, SEO, and (SPEC §9.1) the AI-discovery
    // feed — but it does NOT unpublish it. The llms.txt exclusion is asserted where the feed is
    // fetched; this pins the other half, that the page itself still renders and still says
    // noindex. Regressing either direction is silent: an over-eager filter 404s a live page.
    desc: "a noindex page still renders, with robots noindex",
    include: ["LLMS_NOINDEX_MARKER", 'name="robots"', "noindex"],
  },
  {
    slug: "components",
    desc: "shiki highlighting + code group + code titles + copy button",
    // Code titles were dead code for months: remarkCodeTitles rewrote a fence's `meta` to
    // title="…" and the serializer's Shiki integration drops `meta` entirely, so nothing ever
    // reached the DOM — which is why CodeGroup labelled every tab with the *language*. Nothing
    // failed, because nothing asserted. These assertions are that gap closed: both title forms
    // (bare ```js JavaScript and explicit title="example.ts"), and the copy button on every
    // fence including the untitled one.
    include: [
      "shiki",
      "console",
      'data-code-title="JavaScript"', // bare meta after the language
      'data-code-title="example.ts"', // explicit title="…"
      // A CodeGroup renders only its ACTIVE block, so the second fence's title exists solely as
      // the tab label — which is the thing that was broken (it used to read "python").
      ">Python</button>",
      "UNTITLED_FENCE_MARKER",
      'aria-label="Copy"',
    ],
    // An untitled fence must not sprout a title bar naming its language — the failure mode that
    // made three `bash` blocks in one group all read "shellscript".
    exclude: ['data-code-title="ts"', 'data-code-title="typescript"'],
  },
  {
    slug: "cards",
    desc: "standalone + grouped cards render",
    include: ["CARD_ONE_MARKER", "CARD_TWO_MARKER", "CARD_A_MARKER", "card-link"],
  },
  {
    slug: "author-code",
    desc: "author logic is NOT evaluated on the server (SPEC 10.6 execution model)",
    // The page renders (200, notice-free) and its prose is server-rendered, but the author's own
    // code must not run here. `{"SERVER" + "_EVALUATED"}` is the load-bearing assertion: the
    // concatenated RESULT appears nowhere in the source or the compiled module, so finding
    // "SERVER_EVALUATED" in this HTML would mean the server evaluated an author expression --
    // which is exactly how `{process.env.DATABASE_URL}` once rendered a live connection string.
    include: ["AUTHOR_PAGE_MARKER"],
    exclude: ["SERVER_EVALUATED", "SPREAD_EVALUATED", "<b>AUTHOR_COMPONENT_OUTPUT</b>"],
  },
  {
    slug: "author-violation",
    desc: "a page breaking the component contract degrades instead of rendering or executing",
    // An import outside /snippets/ is refused before evaluation on either side, and the reader
    // gets the same notice any unsupported feature produces -- never a 500.
    include: ["couldn", "only /snippets/"],
  },
  {
    slug: "unknowns",
    desc: "unknown + member-expr components degrade to children",
    include: ["UNKNOWN_CHILD_MARKER", "MEMBER_EXPR_MARKER"],
    exclude: ["Expected component"],
  },
  {
    slug: "images",
    desc: "markdown AND literal <img> images get manifest dimensions + next/image; external stays plain",
    // hero.png is 120x60 (markdown image) and wide.png is 200x100 (a LITERAL <img> in a <Frame>):
    // both get dims applied + routed through the optimizer. The 200x100 assertion is the regression
    // guard for literal <img> — it compiles to _jsx("img") and would bypass the components map
    // (so no dims, no /_next/image) without remarkLiteralImg. The external example.com image must
    // NOT be optimized.
    include: [
      "IMAGES_PAGE_MARKER",
      'width="120"', 'height="60"', // markdown ![]() image
      'width="200"', 'height="100"', // literal <img> in <Frame> — the regression guard
      "/_next/image",
      "https://example.com/remote.png",
    ],
  },
  {
    slug: "media",
    desc: "raw <video>/<iframe> reach the page as real elements (there is no video component to match)",
    // Video has no component in the docs.json-compatible schema — the documented form is raw HTML,
    // so the guard is that MDX passes these through as intrinsic elements rather than swallowing
    // them into the unknown-component fallback. The boolean attributes are asserted because those
    // are what make an autoplay video work, and `<source>` because the src-less form must render
    // for readers even though the editor declines to preview it. The `aspect-video` CLASS being
    // present is a separate matter — see the CSS check below; it is purged unless safelisted.
    include: [
      "MEDIA_PAGE_MARKER",
      "<video",
      "<iframe",
      "<source",
      "controls",
      "playsInline",
      "MEDIA_EMBED_MARKER",
      "aspect-video",
      // GFM task lists render as real checkbox inputs, and the checked one is checked. The
      // editor used to drop these on round-trip; this is the reader half of that story.
      "TASK_LIST_MARKER",
      'type="checkbox"',
      "checked",
      // The class remark-gfm hangs on a task item — the hook the CSS below styles against, so the
      // marker is hidden and the checkbox sits in its place. If this ever stops being emitted,
      // every checklist silently goes back to "bullet, then checkbox, then text".
      "task-list-item",
    ],
  },
  { slug: "badfrontmatter", desc: "malformed frontmatter doesn't crash", include: ["BAD_FRONTMATTER_MARKER"] },
  {
    slug: "with-snippet",
    desc: "unresolved snippet import degrades gracefully (200, not 500)",
    include: ["couldn", "rendered"], // the "couldn’t be fully rendered yet" notice
  },
  { slug: "hidden", desc: "hidden page reachable by URL", include: ["HIDDEN_PAGE_MARKER"] },
  {
    slug: "list-users",
    desc: "OpenAPI: GET endpoint page (params + response schema + tag-grouped nav)",
    // "Users" is the operations' OpenAPI tag → the sidebar groups them under it (not a flat
    // list). Capitalized so it matches the group header, not the "List users" page titles.
    include: ["GET", "/users", "limit", "Max users to return", ">Users<"],
  },
  {
    slug: "create-user",
    desc: "OpenAPI: POST endpoint page (request body schema)",
    include: ["POST", "email", "Display name"],
  },
  {
    slug: "get-user",
    desc: "OpenAPI: path parameter rendered",
    include: ["The user ID"],
  },
  {
    // The read-only samples must carry the auth the spec declares (this operation overrides the
    // root `security` with an apiKey), or the page shows an unauthenticated snippet beside a
    // playground that sends a credential. The URL is quoted because these get pasted into a shell.
    slug: "get-user",
    desc: "OpenAPI: code samples carry the operation's own security scheme, URL shell-quoted",
    include: ["X-Api-Key: &#x3C;key>", "'https://api.example.com/v1/users/{id}'"],
  },
  {
    slug: "list-users",
    desc: "OpenAPI: code samples show the root security scheme (Basic), credential elided",
    include: ["Authorization: Basic &#x3C;credentials>"],
  },
  {
    // Two things at once: the spec's `example` reaches the sample at all (3.0's `example` arrives
    // as 3.1's `examples: [x]` after `upgrade()`, and reading only `example` dropped it), and the
    // apostrophe in it is shell-escaped — unquoted it would end the string and hang the pasted
    // command. Shiki splits `O'\''Brien` across spans, so assert the pieces that survive it.
    slug: "create-user",
    desc: "OpenAPI: a spec example reaches the cURL body, with its apostrophe shell-escaped",
    include: [`"name": "O'`, `>\\'<`],
  },
  {
    slug: "mermaid",
    desc: "```mermaid renders as a <Mermaid> diagram, not a highlighted code block",
    // The client <Mermaid> SSRs an aria-label="Diagram" container (positive proof the fence was
    // transformed — a code block would instead emit Shiki markup). We can't assert the chart text
    // is absent: it's a client-component prop, so Next serializes it into the RSC flight payload
    // in the HTML. Instead, since this page has no other fenced code, the ABSENCE of "shiki" markup
    // is the clean signal the fence didn't fall through to the highlighter.
    include: ["MERMAID_PAGE_MARKER", 'aria-label="Diagram"'],
    exclude: ["shiki"],
  },
  {
    slug: "components-extended",
    desc: "every registered component resolves to a real component, not the children fallback",
    // An unregistered name degrades to its children, so a marker appearing proves nothing on
    // its own — the text would show either way. What distinguishes "implemented" from
    // "degraded" is the *markup* each component emits, so every assertion below pairs a
    // content marker with structure only the real component produces.
    include: [
      // Callouts: the shell is a bordered flex row with an icon.
      "DANGER_MARKER",
      "CUSTOM_CALLOUT_MARKER",
      // Banner, both ways in: the `docs.json` field renders site-wide above the navbar, and
      // the same component is usable as an inline tag.
      "CONFIG_BANNER_MARKER",
      'aria-label="Dismiss"',
      "INLINE_BANNER_MARKER",
      // Badge renders an inline-flex span; the pill variant sets rounded-full.
      "BADGE_MARKER",
      "BADGE_PILL_MARKER",
      "rounded-full",
      // Icon: a known Lucide name emits an <svg class="lucide…">; an unknown one must
      // render nothing without taking the surrounding line with it.
      "lucide",
      "ICON_FALLBACK_MARKER",
      "ICON_SRC_MARKER",
      // Tooltip: role="tooltip" only exists if the component ran.
      "TOOLTIP_MARKER",
      'role="tooltip"',
      "TOOLTIP_TIP_MARKER",
      // Tile: an href'd tile is an <a>; both variants carry title + description.
      "TILE_TITLE_MARKER",
      "TILE_DESC_MARKER",
      "TILE_NOLINK_MARKER",
      // Tree + the FileTree alias, including the member-expression children. These are the
      // ones most likely to silently fall back, since `Tree.Folder` is a member expression.
      "TREE_FOLDER_MARKER",
      "TREE_FILE_MARKER",
      "TREE_ROOT_FILE_MARKER",
      "FILETREE_ALIAS_MARKER",
      // The Markdown-list input form. `<summary>` only exists if the list became real
      // Tree.Folder elements — a plain <li> fallback would still show the text, so the
      // disclosure markup is what distinguishes converted from degraded.
      "LIST_FOLDER_MARKER",
      "LIST_NESTED_FILE_MARKER",
      "LIST_IMPLICIT_FOLDER_MARKER",
      "LIST_DEEP_FILE_MARKER",
      "LIST_ROOT_FILE_MARKER",
      "<summary",
      // Color: swatches are rendered as styled spans, so the value reaches a background.
      "COLOR_NAME_MARKER",
      "COLOR_ROW_MARKER",
      // Update: the label becomes an anchor id so a release is linkable.
      'id="2026-08-23"',
      "UPDATE_DESC_MARKER",
      "UPDATE_TAG_MARKER",
      "UPDATE_BODY_MARKER",
      // Visibility: humans render, an unknown audience renders rather than vanishing.
      "VISIBILITY_HUMAN_MARKER",
      "VISIBILITY_UNKNOWN_MARKER",
      // Prompt + View + Panel/examples.
      "PROMPT_DESC_MARKER",
      "PROMPT_BODY_MARKER",
      "VIEW_JS_MARKER",
      "VIEW_PY_MARKER",
      "PANEL_MARKER",
      "REQUEST_EXAMPLE_MARKER",
      "RESPONSE_EXAMPLE_MARKER",
      // GitHub.Repo renders its slug and links out server-side.
      "papervine/papervine",
    ],
    exclude: [
      // The agent-only block must be absent from the tree entirely, not merely hidden:
      // content hidden with CSS is still read by scrapers and screen readers, which is the
      // opposite of what `for="agents"` asks for.
      "VISIBILITY_AGENT_MARKER",
    ],
  },
  {
    slug: "social",
    desc: "authored og:image / twitter:card beat the generated card; unknown metatags pass through",
    include: [
      // Frontmatter `og:image` wins over the auto-generated card, and `twitter:image` inherits it.
      "SOCIAL_OVERRIDE.png",
      // An explicit `twitter:card` beats the summary_large_image default.
      'name="twitter:card" content="summary"',
      // A namespaced key we don't model is emitted verbatim — the compatibility half of seo.metatags.
      "SOCIAL_PASSTHROUGH_MARKER",
      // Site-wide tags still apply on a page that overrides its own.
      "@SITEWIDE_HANDLE",
      // An inner page is an article, and advertises its canonical URL.
      'property="og:type" content="article"',
      'rel="canonical"',
    ],
    exclude: [
      // The whole point of the override: no generated card is referenced on this page.
      "/api/og",
      // `twitter:card: summary` must not leave the default alongside it.
      "summary_large_image",
    ],
  },
];

// The generated social card itself (SPEC §5) — `/api/og/{slug}` renders a real PNG through
// next/og. Asserted as an image rather than a status alone: satori fails by *throwing* on an
// unsupported style, and a 200 with an error body would sail past a status check.
const OG_CHECKS = [
  { path: "/api/og", desc: "the index card renders" },
  { path: "/api/og/components", desc: "an inner page's card renders" },
  {
    path: "/api/og/no/such/page",
    desc: "an unknown slug still renders the site-level card (never a broken unfurl)",
  },
];

// Full-text search (SPEC.md §6) via /api/search. Backed by search-fixture.mdx
// (indexed) and search-noindex.mdx (excluded), which use nonsense terms so the
// assertions can't collide with other fixture content. We assert on which hrefs
// come back — not on ranking order or snippet text, which would be brittle.
const SEARCH_CHECKS = [
  { q: "zebra", desc: "title match returns the page", expect: "/search-fixture" },
  { q: "wombat", desc: "body term resolves to the section anchor", expect: "/search-fixture#quokka-section" },
  { q: "womb", desc: "prefix match works", expect: "/search-fixture#quokka-section" },
  { q: "platypus", desc: "noindex pages are excluded from the index", expectEmpty: true },
];

// Control plane (SPEC §10, Layer-1 auth). Deliberately DB-free so it runs in CI with no
// Postgres: the app-host edge gate redirects before any DB query, and the auth pages are
// client-rendered. The control plane is URL-scoped and lives on the `app.` host at bare
// /:org/:site (rewritten onto the invisible /app mount). We exercise the gate by sending
// `Host: app.localhost`, which proves both the edge gate AND that bare /:org/:site never
// 500s/leaks docs to a signed-out visitor. Guards the (docs)/(auth) route split and the
// app-host routing from regressing.
const CONTROL_PLANE_CHECKS = [
  {
    host: "app.localhost",
    path: "/",
    desc: "unauthenticated app host / redirects to /login (edge gate)",
    redirectTo: "/login",
  },
  {
    // Sentry's tunnel is a ROOT route, and the app host rewrites everything else onto /app —
    // so it became /app/monitoring, hit the auth gate, and bounced to /login. Every browser
    // error report from the dashboard was silently dropped (and the same shape broke tenant
    // subdomains and custom domains: /sites/{slug}/monitoring). A status assertion here would
    // depend on whether a DSN is configured; what must always hold is that it is never dragged
    // through the /app mount.
    host: "app.localhost",
    path: "/monitoring",
    desc: "the Sentry tunnel is not rewritten onto /app (dropped error reports)",
    rejectRedirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs",
    desc: "unauthenticated app host /:org/:site redirects to /login",
    redirectTo: "/login",
  },
  {
    // Stale-session self-heal: a lingering-but-invalid session cookie must NOT loop
    // /login → / → /login (ERR_TOO_MANY_REDIRECTS). The server redirects to /login?stale=1
    // and middleware clears the cookie + renders login. Middleware-only (no DB), so smoke covers it.
    host: "app.localhost",
    path: "/login?stale=1",
    cookie: "better-auth.session_token=stale-smoke",
    expectStatus: 200,
    clearsCookie: "better-auth.session_token",
    desc: "stale session cookie on /login?stale=1 renders login + clears the cookie (no redirect loop)",
  },
  {
    host: "app.localhost",
    path: "/acme/connect",
    // The start-method chooser (SPEC §10.11). The page itself needs a session AND Postgres
    // (requireOrg), so the redirect is the only thing assertable in this DB-free gate — the
    // chooser's own behavior is covered by tests/e2e/new-site.spec.ts.
    desc: "unauthenticated app host /:org/connect (start-method chooser) redirects to /login (SPEC §10.11)",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs/analytics",
    desc: "unauthenticated app host analytics redirects to /login",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs/automate/automations",
    desc: "unauthenticated app host automate redirects to /login (SPEC §10.2)",
    redirectTo: "/login",
  },
  {
    host: "app.localhost",
    path: "/acme/docs/automate/agent",
    desc: "unauthenticated app host agent settings redirects to /login (SPEC §10.2)",
    redirectTo: "/login",
  },
  {
    // The live Activity feed's polling endpoint (SPEC §10.3) is a bare /:org/:site path, so
    // the edge gate must catch it like any dashboard page — an unauthenticated poll redirects
    // to /login, never leaks a tenant's deployment feed.
    host: "app.localhost",
    path: "/acme/docs/activity",
    desc: "unauthenticated app host activity feed redirects to /login (SPEC §10.3)",
    redirectTo: "/login",
  },
  {
    // The web editor (SPEC §9.2/§10) is a bare /:org/:site/editor path — the edge gate must
    // catch it like any dashboard page so an unauthenticated request never reaches the
    // authoring backend (draft buffer / git write path).
    host: "app.localhost",
    path: "/acme/docs/editor",
    desc: "unauthenticated app host editor redirects to /login (SPEC §9.2/§10)",
    redirectTo: "/login",
  },
  {
    // The editor's live preview (SPEC §9.2) renders the draft through the real renderer at
    // /preview/:org/:site. It's a bare app-host path like any dashboard page, so the edge gate
    // must catch it — an unauthenticated request must never render a tenant's draft content.
    host: "app.localhost",
    path: "/preview/acme/docs",
    desc: "unauthenticated app host editor preview redirects to /login (SPEC §9.2)",
    redirectTo: "/login",
  },
  {
    // The platform superadmin overview (SPEC §10.10) is a bare app-host path like any
    // dashboard page — the edge gate must bounce it signed-out. (The allowlist 404 for
    // signed-in non-admins needs a session + DB, so it's verified in-browser, not here.)
    host: "app.localhost",
    path: "/admin",
    desc: "unauthenticated app host /admin redirects to /login (SPEC §10.10)",
    redirectTo: "/login",
  },
  {
    path: "/login",
    desc: "login page renders in the platform theme (shell + gradient CTA)",
    // `db-glow` proves PlatformShell wraps it; `db-cta` proves the shared Button is used.
    // Guards the platform theme from regressing back to the old emerald/system look.
    include: ["Sign in to Papervine", "db-glow", "db-cta"],
  },
  {
    path: "/signup",
    desc: "signup page renders in the platform theme (shell + gradient CTA)",
    include: ["Create your Papervine account", "db-glow", "db-cta"],
  },
  {
    // Password reset (SPEC §10.1). Both pages are DB-free client forms, so the no-DB smoke
    // gate covers them. /forgot-password renders one of two states depending on whether a
    // transactional email provider is configured — assert only the chrome + the "back to
    // sign in" escape hatch, which both states share, so the check doesn't depend on whether
    // the operator running smoke happens to have RESEND_API_KEY in .env.local.
    path: "/forgot-password",
    desc: "forgot-password page renders in the platform theme with a way back to sign in",
    include: ["db-glow", 'href="/login"'],
  },
  {
    // Reached from an emailed link. Must render even with email unconfigured — a link minted
    // while a provider WAS configured has to keep working.
    path: "/reset-password",
    desc: "reset-password page renders (no token → the expired-link state, never a 500)",
    include: ["db-glow", "expired"],
  },
  {
    path: "/home",
    desc: "logged-out marketing apex shows Log in / Sign up + the growing-vine backdrop, not Dashboard (session-aware nav, SPEC §2)",
    // `db-vine` + `pv-sprouts` prove the landing uses the "home" PlatformShell variant (the
    // animated VineField + ambient SproutField) rather than the static `.db-grid` other
    // "full" surfaces use.
    include: [
      'href="/login"',
      'href="/signup"',
      "db-vine",
      "pv-sprouts",
      // Distinctive beginner copy so we don't silently regress to jargon-only
      // ("docs.json", MCP, llms.txt). The headline is split across a <br>/span, so
      // assert a contiguous phrase from the hero chip instead.
      "Connect a GitHub repo and your docs are live",
      // The apex declared `summary_large_image` with NO image for a long time — the one
      // combination that unfurls as nothing at all. `opengraph-image.tsx` supplies it, and
      // Next mirrors it onto twitter:image; assert the image, not just the card type.
      'name="twitter:image"',
      "opengraph-image",
      // Our handle, which is what makes X attribute the card instead of rendering it
      // anonymously. Deliberately absent from tenant docs — see marketing-seo.ts.
      'name="twitter:site" content="@papervine_io"',
      // Public CLI repo — header + footer (SPEC §2 marketing apex).
      'href="https://github.com/papervine/papervine"',
      // The "Try it" live demo section (SPEC §2). Both halves are server-rendered shells —
      // the editor's poster frame and the question chips — so their absence is visible here
      // even though the interactive parts only exist after a click (that's home-demo.spec.ts).
      "Try it",
      "Edit this page",
      "How do I migrate an existing docs.json site?",
      // With no DB there is no site to frame, so the demo shows its placeholder rather than
      // an iframe pointed at nothing.
      "A live docs site appears here.",
    ],
    // Guards the session-aware swap: a signed-out visitor must never see the
    // Dashboard link (which only renders when getSession() resolves). And the landing
    // must not fall back to the static grid backdrop.
    //
    // The widget assertions are the DB-free contract for the demo: this gate runs with no
    // Postgres, so resolveHomeDemo() must return null and the Ask chips must degrade to plain
    // links into the docs. A loader tag here would mean the page tried to embed a widget it
    // has no site for — and, worse, that a missing DB had reached the render path at all.
    exclude: [
      'href="/dashboard"',
      "db-grid",
      "/api/widget/embed.js",
      "data-widget-id",
    ],
  },
  {
    path: "/pricing",
    desc: "marketing pricing page renders all four tiers, the $50/$300 anchors, the trial banner, and the matrix",
    // db-glow proves PlatformShell wraps it; the tier names + matrix groups prove the
    // table content rendered (not just the chrome). "$50"/"$300" are the Team/Pro
    // anchors (SPEC §10 Billing; mirrors billing/catalog.json), "billed annually" the
    // annual notes, and the 30-day trial banner replaces the old 90-day SSO promo.
    include: [
      // The apex's second-most-shared URL had no og:/twitter: tags at all, so it unfurled
      // bare. Same shared helper as the landing page, so the handle rides along.
      'name="twitter:site" content="@papervine_io"',
      "opengraph-image",
      "Pricing on",
      "db-glow",
      "Free",
      "Team",
      "Pro",
      "Enterprise",
      "$50",
      "$300",
      "billed annually",
      "30 days of everything",
      "5,000 AI credits",
      "25,000 / month",
      "Dashboard SSO",
      "Security before procurement",
      'href="/signup"',
    ],
    // The 90-day promo is dead; its copy must not resurface.
    exclude: ["Free for 90 days"],
  },
];

function log(msg) {
  process.stdout.write(msg + "\n");
}

// Raw GET that honors a custom Host header — undici's fetch silently drops `Host` (a
// forbidden header), so we can't use it to address the `app.` control-plane host. Manual
// redirect (no follow), so we can assert the gate's 30x → /login.
function rawGet(pathname, hostHeader, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (hostHeader) headers.host = hostHeader;
    if (cookie) headers.cookie = cookie;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: pathname,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            location: res.headers.location ?? "",
            setCookie: res.headers["set-cookie"] ?? [],
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function waitForReady(timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(15_000) });
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not become ready in time");
}

async function run() {
  // Next allows one dev server per directory, and this one needs PAPERVINE_CONTENT pointed
  // at the fixtures — so a running `npm run dev` has to be stopped, not reused.
  requireNoDevServer(PKG_ROOT, "the smoke gate", DIST_DIR);
  // See protectNextEnv: `next dev` repoints next-env.d.ts at DIST_DIR, which would make a
  // later typecheck validate routes against this run's frozen snapshot.
  const restoreNextEnv = protectNextEnv(PKG_ROOT);
  log(`▶ booting renderer against ${FIXTURES} on :${PORT}`);
  const server = spawn(nextBin, ["dev", "-H", "0.0.0.0", "-p", String(PORT)], {
    cwd: PKG_ROOT,
    // Its own build output, so this can run alongside `npm run dev` (see next.config.mjs).
    env: { ...process.env, PAPERVINE_CONTENT: FIXTURES, NEXT_DIST_DIR: DIST_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  const failures = [];
  try {
    await waitForReady();
    for (const check of CHECKS) {
      const before = failures.length;
      const url = `${BASE}/${check.slug}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        if (res.status !== 200) {
          failures.push(`[${check.slug || "/"}] expected 200, got ${res.status} — ${check.desc}`);
        } else {
          for (const needle of check.include ?? []) {
            if (!body.includes(needle)) failures.push(`[${check.slug || "/"}] missing "${needle}" — ${check.desc}`);
          }
          for (const needle of check.exclude ?? []) {
            if (body.includes(needle)) failures.push(`[${check.slug || "/"}] should NOT contain "${needle}" — ${check.desc}`);
          }
        }
      } catch (e) {
        failures.push(`[${check.slug || "/"}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} /${check.slug}  (${check.desc})`);
    }

    for (const check of OG_CHECKS) {
      const before = failures.length;
      const tag = `og ${check.path}`;
      try {
        const res = await fetch(`${BASE}${check.path}`, { signal: AbortSignal.timeout(30_000) });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (res.status !== 200) {
          failures.push(`[${tag}] expected 200, got ${res.status} — ${check.desc}`);
        } else if (!(res.headers.get("content-type") ?? "").startsWith("image/png")) {
          failures.push(`[${tag}] expected image/png, got "${res.headers.get("content-type")}" — ${check.desc}`);
        } else if (bytes.length < 1000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
          // The PNG magic + a floor on the size: ImageResponse streams, so a satori throw
          // mid-render yields a 200 with a truncated (or empty) body and the right header.
          failures.push(`[${tag}] body is not a plausible PNG (${bytes.length} bytes) — ${check.desc}`);
        }
      } catch (e) {
        failures.push(`[${tag}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} ${tag}  (${check.desc})`);
    }

    // Tenant MDX is fetched at request time, so Tailwind's content scanner never sees it and a
    // class used ONLY in someone's docs page gets purged. That is invisible in the page HTML —
    // the class attribute is right there — so it can only be caught by reading the stylesheet
    // the page actually links. `aspect-video` is the one that mattered: the documented markup
    // for a video carries it, nothing in our own source does, and without it every migrated
    // repo's video rendered with no aspect ratio. Kept alive by tailwind.config's safelist.
    {
      const before = failures.length;
      const tag = "docs CSS";
      try {
        const res = await fetch(`${BASE}/media`, { signal: AbortSignal.timeout(30_000) });
        const html = await res.text();
        const href = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
        if (!href) {
          failures.push(`[${tag}] no stylesheet linked from /media`);
        } else {
          const css = await (
            await fetch(new URL(href, BASE), { signal: AbortSignal.timeout(30_000) })
          ).text();
          for (const cls of ["aspect-video", "object-cover", "h-96"]) {
            if (!css.includes(cls)) {
              failures.push(`[${tag}] ".${cls}" purged — tenant MDX using it renders unstyled`);
            }
          }
          // A GFM task list is the one list whose marker has to go: remark-gfm renders a real
          // checkbox INSIDE the item, so with the bullet still there each line reads "bullet,
          // checkbox, text". The rule lives in globals.css rather than in a component, which is
          // exactly the kind of thing that gets deleted in a cleanup and noticed by nobody.
          if (!css.includes("task-list-item")) {
            failures.push(`[${tag}] task-list styling gone — checklists render bullet + checkbox`);
          }
        }
      } catch (e) {
        failures.push(`[${tag}] request failed: ${e.message}`);
      }
      log(
        `  ${failures.length === before ? "✓" : "✗"} ${tag}  (media classes used only in tenant MDX survive purging)`,
      );
    }

    for (const check of SEARCH_CHECKS) {
      const before = failures.length;
      const tag = `search "${check.q}"`;
      try {
        const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(check.q)}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status !== 200) {
          failures.push(`[${tag}] expected 200, got ${res.status} — ${check.desc}`);
        } else {
          const data = await res.json();
          const hrefs = (data.results ?? []).map((r) => r.href);
          if (check.expect && !hrefs.includes(check.expect)) {
            failures.push(`[${tag}] expected href "${check.expect}", got [${hrefs.join(", ")}] — ${check.desc}`);
          }
          if (check.expectEmpty && hrefs.length) {
            failures.push(`[${tag}] expected no results, got [${hrefs.join(", ")}] — ${check.desc}`);
          }
        }
      } catch (e) {
        failures.push(`[${tag}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} ${tag}  (${check.desc})`);
    }

    // Assistant route is wired (SPEC §8): 503 without ANTHROPIC_API_KEY, streams with one.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/api/assistant`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (![200, 503].includes(res.status)) {
          failures.push(`[assistant] expected 200 or 503, got ${res.status}`);
        }
      } catch (e) {
        failures.push(`[assistant] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} assistant route (200 w/ key, 503 without)`);
    }

    // Embeddable assistant widget (SPEC §8.7). The chat route resolves its tenant by
    // widgetId (getSiteByWidgetId), not Host — must no-op gracefully with no DB reachable,
    // same contract as getSiteByHost, so this DB-free gate 404s/403s instead of 500ing.
    {
      const before = failures.length;
      try {
        const embedRes = await fetch(`${BASE}/api/widget/embed.js`);
        if (embedRes.status !== 200) {
          failures.push(`[widget] embed.js expected 200, got ${embedRes.status}`);
        }
        const chatRes = await fetch(`${BASE}/api/widget/widget_doesnotexist/chat`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://example.com" },
          body: JSON.stringify({ messages: [] }),
        });
        if (chatRes.status !== 404) {
          failures.push(`[widget] unknown widgetId POST expected 404, got ${chatRes.status}`);
        }
        const optionsRes = await fetch(`${BASE}/api/widget/widget_doesnotexist/chat`, {
          method: "OPTIONS",
          headers: { origin: "https://example.com" },
        });
        if (optionsRes.status !== 403) {
          failures.push(`[widget] unknown widgetId OPTIONS expected 403, got ${optionsRes.status}`);
        }
      } catch (e) {
        failures.push(`[widget] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} widget routes (embed.js 200 no-DB; unknown widgetId 404/403 not 500)`);
    }

    // Generated MCP server (SPEC §8.5). Streamable HTTP at /mcp. We assert the
    // tools are listed and a tools/call returns real docs — body substrings only,
    // so SSE-vs-JSON framing and tool ordering don't make this brittle. Fixtures
    // include an OpenAPI spec, so search_api must also be present.
    // Regression (PAPERVINE-3): this runs DB-free, so the connection-init tenant
    // lookup (getSiteByHost) must no-op rather than reject on ECONNREFUSED :5432.
    const mcpPost = (body) =>
      fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
        // 120s: the FIRST request cold-compiles the /mcp route (+ MCP SDK) under
        // `next dev`, which blows a 30s budget on CI runners — the long-standing
        // "[mcp] request failed: aborted due to timeout" red. Healthy responses are
        // sub-second; this only tolerates compile latency, a real hang still fails.
        signal: AbortSignal.timeout(120_000),
      });
    {
      const before = failures.length;
      try {
        const listRes = await mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
        const listBody = await listRes.text();
        if (listRes.status !== 200) failures.push(`[mcp] tools/list expected 200, got ${listRes.status}`);
        for (const tool of ["search_docs", "read_page", "list_pages", "search_api"]) {
          if (!listBody.includes(`"${tool}"`)) failures.push(`[mcp] tools/list missing tool "${tool}"`);
        }
        const callRes = await mcpPost({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search_docs", arguments: { query: "zebra" } },
        });
        const callBody = await callRes.text();
        if (!callBody.includes("/search-fixture")) {
          failures.push(`[mcp] search_docs("zebra") should return /search-fixture`);
        }
      } catch (e) {
        failures.push(`[mcp] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} mcp server (/mcp tools/list + tools/call)`);
    }

    // llms.txt index (SPEC §9.1). Generated from the in-scope content source — here the
    // fixtures repo (DB-free, so the agent-analytics logging just no-ops). The format's rules
    // are unit-tested (`tests/unit/llms-format.test.ts`); what only a real request can prove is
    // that the generator is wired to real content and that the filters hold end to end.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/llms.txt`, { signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        const ct = res.headers.get("content-type") ?? "";
        if (res.status !== 200) failures.push(`[llms.txt] expected 200, got ${res.status}`);
        if (!ct.includes("text/plain")) failures.push(`[llms.txt] expected text/plain, got "${ct}"`);
        for (const needle of [
          "# Fixtures",
          "LLMS_SUMMARY_MARKER", // docs.json `description` → the blockquote
          "LLMS_INSTRUCTIONS_MARKER", // docs.json `markdown.instructions`, verbatim
          "## Start", // sections mirror the nav groups, not one flat list
          "## Edge cases",
          "/components.md", // links point at the .md twin, not the HTML page
          "/index.md", // …including the index, whose route is `/`
          "## API specifications",
          "openapi.json",
          "## Additional pages", // seo.indexing: "all" — pages outside the navigation
        ]) {
          if (!body.includes(needle)) failures.push(`[llms.txt] missing "${needle}"`);
        }
        // `noindex: true` is the page-level opt-out; it must hold on BOTH paths into the feed —
        // the nav walk (llms-noindex is a listed page) and the indexing:"all" sweep
        // (search-noindex is not listed). A page that opts out of search opts out of this too.
        for (const forbidden of ["LLMS_NOINDEX_MARKER", "llms-noindex", "search-noindex"]) {
          if (body.includes(forbidden)) {
            failures.push(`[llms.txt] noindex page leaked: "${forbidden}"`);
          }
        }
        // The index must advertise itself the same way pages do.
        if (res.headers.get("x-llms-txt") !== "/llms.txt") {
          failures.push(`[llms.txt] missing x-llms-txt discovery header`);
        }
      } catch (e) {
        failures.push(`[llms.txt] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} llms.txt index (sections, .md links, noindex held)`);
    }

    // llms-full.txt inlines every page body after the same index. The risk it guards is the
    // walk silently degrading to the index alone (a `loadPage` that stops resolving).
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/llms-full.txt`, { signal: AbortSignal.timeout(60_000) });
        const body = await res.text();
        if (res.status !== 200) failures.push(`[llms-full.txt] expected 200, got ${res.status}`);
        for (const needle of [
          "# Fixtures",
          "Source: http", // each inlined page cites where it came from
          "This is the **fixtures home**", // …and the body really is inlined
        ]) {
          if (!body.includes(needle)) failures.push(`[llms-full.txt] missing "${needle}"`);
        }
        if (body.includes("LLMS_NOINDEX_MARKER")) {
          failures.push(`[llms-full.txt] noindex page body leaked`);
        }
        if (body.length <= 4000) {
          failures.push(`[llms-full.txt] suspiciously short (${body.length}B) — bodies not inlined?`);
        }
      } catch (e) {
        failures.push(`[llms-full.txt] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} llms-full.txt (index + inlined page bodies)`);
    }

    // The `.well-known` aliases. These are ROOT paths, and every non-apex host class rewrites
    // its whole path space — so the way this breaks is a 404 on tenant hosts only, which no
    // apex-based check would see. Asserting them here at least pins the routes' existence.
    {
      const before = failures.length;
      for (const path of ["/.well-known/llms.txt", "/.well-known/llms-full.txt"]) {
        try {
          const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60_000) });
          if (res.status !== 200) failures.push(`[${path}] expected 200, got ${res.status}`);
          else if (!(await res.text()).startsWith("# Fixtures")) {
            failures.push(`[${path}] did not serve the index`);
          }
        } catch (e) {
          failures.push(`[${path}] request failed: ${e.message}`);
        }
      }
      log(`  ${failures.length === before ? "✓" : "✗"} .well-known/llms{,-full}.txt aliases`);
    }

    // A page's `.md` twin — what every link in llms.txt points at, so a broken rewrite makes
    // the whole index dead links. The mapping lives in middleware (the route tree can't match
    // an extension), which is exactly why this needs a real request to verify.
    {
      const before = failures.length;
      const cases = [
        ["/index.md", "Fixtures Home"], // the index page's two spellings
        ["/components.md", "components"],
        ["/guide.md", "Plain Markdown Guide"], // a `.md` SOURCE file's `.md` twin
      ];
      for (const [path, needle] of cases) {
        try {
          const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) });
          const body = await res.text();
          const ct = res.headers.get("content-type") ?? "";
          if (res.status !== 200) failures.push(`[${path}] expected 200, got ${res.status}`);
          if (!ct.includes("text/markdown")) {
            failures.push(`[${path}] expected text/markdown, got "${ct}"`);
          }
          // Markdown, not a rendered page: the React shell would bring a <!DOCTYPE with it.
          if (/<!DOCTYPE/i.test(body)) failures.push(`[${path}] served HTML, not Markdown`);
          if (!body.toLowerCase().includes(needle.toLowerCase())) {
            failures.push(`[${path}] missing "${needle}"`);
          }
        } catch (e) {
          failures.push(`[${path}] request failed: ${e.message}`);
        }
      }
      try {
        const res = await fetch(`${BASE}/no-such-page.md`, { signal: AbortSignal.timeout(30_000) });
        if (res.status !== 404) failures.push(`[/no-such-page.md] expected 404, got ${res.status}`);
      } catch (e) {
        failures.push(`[/no-such-page.md] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} page .md twins (text/markdown + 404 on miss)`);
    }

    // Docs pages advertise the index. Without this the headers are only on the surfaces a
    // client would already have had to find, which is the one place they're no help.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/components`, { signal: AbortSignal.timeout(30_000) });
        if (res.headers.get("x-llms-txt") !== "/llms.txt") {
          failures.push(`[discovery] page response missing x-llms-txt`);
        }
        if (!(res.headers.get("link") ?? "").includes("/llms.txt")) {
          failures.push(`[discovery] page response missing Link: </llms.txt>`);
        }
      } catch (e) {
        failures.push(`[discovery] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} llms.txt discovery headers on a docs page`);
    }

    // GitHub push webhook signature gate (SPEC §3 auto-sync). DB-free: an unsigned /
    // wrongly-signed delivery must be rejected with 401 BEFORE the route parses the body
    // or touches the DB — so this runs without Postgres. The happy path (valid signature
    // → matching site syncs) needs the DB and is covered in the e2e suite.
    {
      const before = failures.length;
      try {
        const res = await fetch(`${BASE}/api/github/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-hub-signature-256": "sha256=deadbeef", // not a valid HMAC of the body
          },
          body: JSON.stringify({ ref: "refs/heads/main" }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status !== 401) {
          failures.push(`[gh-webhook] expected 401 for a bad signature, got ${res.status}`);
        }
      } catch (e) {
        failures.push(`[gh-webhook] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} github webhook rejects an unsigned delivery (401)`);
    }

    for (const check of CONTROL_PLANE_CHECKS) {
      const before = failures.length;
      const tag = `control-plane ${check.host ? `${check.host}` : ""}${check.path}`;
      try {
        // rawGet (not fetch) so a check can address the `app.` host via a real Host header.
        const res = await rawGet(check.path, check.host, check.cookie);
        if (check.expectStatus) {
          if (res.status !== check.expectStatus) {
            failures.push(`[${tag}] expected ${check.expectStatus}, got ${res.status} → "${res.location}" — ${check.desc}`);
          } else if (check.clearsCookie) {
            const cleared = res.setCookie.some(
              (c) => c.startsWith(`${check.clearsCookie}=`) && /max-age=0|expires=/i.test(c),
            );
            if (!cleared) failures.push(`[${tag}] expected Set-Cookie clearing ${check.clearsCookie} — ${check.desc}`);
          }
        } else if (check.rejectRedirectTo) {
          // For a path whose EXISTENCE depends on the environment (the Sentry tunnel route only
          // exists when a DSN is configured), asserting a status would be flaky. What holds
          // unconditionally is that the middleware didn't route it through the /app mount —
          // which would hit the auth gate and bounce to /login.
          if (
            [301, 302, 303, 307, 308].includes(res.status) &&
            res.location.includes(check.rejectRedirectTo)
          ) {
            failures.push(`[${tag}] must NOT redirect to ${check.rejectRedirectTo}, got ${res.status} → "${res.location}" — ${check.desc}`);
          }
        } else if (check.redirectTo) {
          if (![301, 302, 303, 307, 308].includes(res.status) || !res.location.includes(check.redirectTo)) {
            failures.push(`[${tag}] expected redirect to ${check.redirectTo}, got ${res.status} → "${res.location}" — ${check.desc}`);
          }
        } else {
          if (res.status !== 200) {
            failures.push(`[${tag}] expected 200, got ${res.status} — ${check.desc}`);
          } else {
            for (const needle of check.include ?? []) {
              if (!res.body.includes(needle)) failures.push(`[${tag}] missing "${needle}" — ${check.desc}`);
            }
            for (const needle of check.exclude ?? []) {
              if (res.body.includes(needle)) failures.push(`[${tag}] should NOT contain "${needle}" — ${check.desc}`);
            }
          }
        }
      } catch (e) {
        failures.push(`[${tag}] request failed: ${e.message}`);
      }
      log(`  ${failures.length === before ? "✓" : "✗"} ${tag}  (${check.desc})`);
    }
  } catch (e) {
    failures.push(`fatal: ${e.message}\n--- server log tail ---\n${serverLog.slice(-1500)}`);
  } finally {
    server.kill("SIGTERM");
    restoreNextEnv();
  }

  if (failures.length) {
    log(`\n✗ ${failures.length} failure(s):`);
    for (const f of failures) log("  - " + f);
    process.exit(1);
  }
  log(
    `\n✓ all ${CHECKS.length} pages + ${OG_CHECKS.length} social cards + ${SEARCH_CHECKS.length} search + ${CONTROL_PLANE_CHECKS.length} control-plane checks passed`,
  );
  process.exit(0);
}

run();
