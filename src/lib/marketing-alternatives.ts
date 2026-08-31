/**
 * Content for the `/docs-platform-alternatives` comparison page (SPEC §2, §10.6).
 *
 * Data, not JSX, for three reasons: the table and the per-platform sections render from ONE
 * list so they can't drift apart; the FAQ renders the same list the JSON-LD `FAQPage` is built
 * from, so the rich result can't advertise an answer the page doesn't contain; and every claim
 * about a competitor is forced to carry a `source` (a unit test enforces it — see
 * `tests/unit/marketing-alternatives.test.ts`).
 *
 * WHY THIS PAGE NAMES COMPETITORS. The house style everywhere else — SPEC, docs/, comments,
 * commits — is the generic "hosted docs platforms". Discovery surfaces are the documented
 * exception (§10.6): the npm keywords, the public repo description, the CLI README's
 * compatibility section, the landing page's hero, and this page. "docs platform alternatives" is
 * what people type; a page that won't say it can't be found by the people looking for it.
 *
 * IT IS A SALES PAGE, and it should read like one. The first draft was a neutral market
 * survey that cheerfully routed readers to four competitors before mentioning us — accurate,
 * useless, and not what a storefront is for. Every section now argues a position: the format
 * is what decides the switch, we read the one you already have, and $29 buys what the
 * category holds for an enterprise call. Order, emphasis and framing are ours to choose.
 *
 * WHAT IS STILL NOT NEGOTIABLE, because it is what keeps the page an asset instead of a
 * liability:
 * - Every price and limit is quoted from the vendor's OWN pricing page, linked as `source`,
 *   and stamped with `PRICES_CHECKED`. Selling hard on true numbers is marketing; selling on
 *   a number that moved last quarter is how a comparison page becomes the thing a competitor
 *   screenshots. The facts do the arguing precisely because they're checkable.
 * - No logos, no trademarks-as-decoration, no implied endorsement. `DISCLAIMER` ships on the
 *   page and says so.
 * - Nothing pejorative, and no claim we can't point at. "SSO is on the enterprise tier" is a
 *   fact from a pricing page. "They don't care about small teams" is not — and it would be
 *   the weaker line anyway.
 * - Our own copy stays accurate about the licence: the CLI is Elastic License 2.0, which is
 *   source-available and NOT OSI open source. This is the page where a developer checks, and
 *   getting caught overclaiming here would cost more than the claim is worth.
 * - `caveat` on a competitor is a fact about their pricing or their model. `caveat` on OUR
 *   entry is one short line — we're newer, and that's the honest trade — not the balanced
 *   self-critique the first draft carried.
 */

export const PRICES_CHECKED = "2026-08-31";

export const DISCLAIMER =
  "Papervine is not affiliated with, endorsed by, or sponsored by any product named on this " +
  "page; all names and trademarks belong to their owners. Prices and limits are quoted from " +
  `each vendor's own pricing page as of ${PRICES_CHECKED} — check the linked page for what's ` +
  "current, and tell us if we've got something wrong.";

/**
 * A closed set rather than free text: the hosting column is the one readers scan for "can I
 * run this myself", and four words that mean nearly the same thing would make it useless.
 * "Hosted (self-host on Enterprise)" is its own category on purpose — it is not the same
 * answer as "hosted or self-host", and blurring the two is the mistake this column exists to
 * avoid.
 */
export type Hosting =
  | "Hosted"
  | "Hosted (self-host on Enterprise)"
  | "Hosted or self-host"
  | "Self-host";

export interface Alternative {
  key: string;
  name: string;
  /** The one-line pitch, in our words — what this option is really offering you. */
  bestFor: string;
  /** Entry price, table-short. */
  price: string;
  /** The top self-serve tier — the number that decides whether a growing team can stay. */
  topTier: string;
  hosting: Hosting;
  /** What the content is written in — the real switching cost, in or out. */
  format: string;
  /** Which tier carries SSO / role-based access. */
  ssoOn: string;
  /** Two to four sentences, written to be read by someone deciding today. */
  body: string;
  /** The trade you're making. A sourced fact for a competitor; one line for us. */
  caveat: string;
  /** The vendor's own page these numbers came from. */
  source: string;
  /** Set on the Papervine row so the page can mark it as ours rather than pretending. */
  us?: boolean;
}

export const ALTERNATIVES: Alternative[] = [
  {
    key: "papervine",
    name: "Papervine",
    us: true,
    bestFor: "The repo you already have, live in minutes, with SSO at $29 instead of a sales call",
    price: "Free",
    topTier: "$99/mo (Pro)",
    hosting: "Hosted or self-host",
    format: "docs.json + MDX",
    ssoOn: "$29/mo (Team)",
    body:
      "Point it at your existing repo and you\u2019re done — Papervine reads the same docs.json + " +
      "MDX, so there is nothing to convert, no export, and no re-authoring. Everything the rest " +
      "of this page sells as an upgrade is included with the repo: full-text search, an AI " +
      "assistant with citations, an embeddable widget for your own product, MCP servers so your " +
      "docs work inside Claude and Cursor, browser editing with an agent, and analytics that " +
      "separate human readers from crawling agents. SSO and role-based access are on the $29 " +
      "Team plan — the category holds both for an enterprise negotiation. Pro is $99/mo for " +
      "production docs teams, with optional hosted AI credit pools. Every account starts with " +
      "30 days of everything and 5,000 credits, no card. BYOK available from day one, and " +
      "`npx papervine dev` runs the same renderer on your laptop with no database and no signup.",
    caveat:
      "We\u2019re the newest name here, and we\u2019d rather you find that out from us: bring your " +
      "repo, run it locally in one command, and judge the render instead of the logo. The CLI " +
      "is source-available under the Elastic License 2.0 — read it, run it, self-host it; you " +
      "just can\u2019t resell it as a hosted service.",
    source: "/pricing",
  },
  {
    key: "incumbent",
    name: "Incumbent",
    bestFor: "Staying where you are — if $450/mo and an enterprise call for SSO both work for you",
    price: "Free (Starter)",
    topTier: "$450/mo (Pro, billed annually)",
    hosting: "Hosted (self-host on Enterprise)",
    format: "docs.json + MDX",
    ssoOn: "Enterprise",
    body:
      "The incumbent, and the reason this page exists. Starter is free with 5 editor seats and " +
      "most of the platform. The AI features people actually come for — agent, assistant, " +
      "automations, preview deployments — start at Pro: $450/mo billed annually ($540 monthly) " +
      "with 10,000 credits. Non-commercial open source projects can get Pro free through their " +
      "OSS program, which is genuinely generous and explicitly not available to companies.",
    caveat:
      "The jump from free to $450/mo is the whole reason this page gets searched for. SSO, " +
      "SCIM, role-based permissions, SLAs and advanced insights are Enterprise, i.e. a sales " +
      "call. Self-hosting is an Enterprise engagement shipping proprietary containers — their " +
      "own guide sizes a production deployment at roughly 45–60 vCPU, 160–220 GB of memory and " +
      "about 1 TB of SSD, over \"typically weeks\", with cloud-dependent integrations " +
      "unavailable and AI off by default.",
    source: "https://example.com/pricing",
  },
  {
    key: "gitbook",
    name: "GitBook",
    bestFor: "Editors who want a document, if you\u2019re willing to pay per site and per user",
    price: "Free (1 user)",
    topTier: "$249 per site/mo + $12/user (Ultimate)",
    hosting: "Hosted",
    format: "GitBook editor, optional Git Sync",
    ssoOn: "Enterprise (SAML)",
    body:
      "The strongest option if the people writing your docs want a document, not a repo. " +
      "Block-based editing, review flows, and Git Sync when you do want the content mirrored " +
      "into a repository. Premium is $65 per site/mo plus $12 per user/mo on annual billing; " +
      "Ultimate is $249 per site/mo plus the same per-user fee and adds authenticated access " +
      "and the assistant.",
    caveat:
      "Priced per site AND per user, so the bill grows on two axes at once — a second product's " +
      "docs is another $65 or $249 a month before anyone edits them. The free tier is one user " +
      "with the agent capped at 10 messages a week. Content lives in GitBook's model, so " +
      "leaving is an export-and-convert project rather than a DNS change.",
    source: "https://www.gitbook.com/pricing",
  },
  {
    key: "readme",
    name: "ReadMe",
    bestFor: "An API reference as the product — priced per project, then per admin",
    price: "Free (1 project)",
    topTier: "$250/mo (Pro, annual) + $20/admin",
    hosting: "Hosted",
    format: "OpenAPI + Markdown, bi-directional sync",
    ssoOn: "Enterprise",
    body:
      "Built around the API reference: an interactive explorer, per-endpoint usage metrics, and " +
      "personalized keys for logged-in developers. Starter is free for one project and one " +
      "published version. Pro is $250/mo billed annually with 5 admins included ($20 for each " +
      "one after), unlimited projects and versions, branching and reviews, and custom MDX " +
      "components.",
    caveat:
      "The free tier's single project and single version rule it out for anything versioned. " +
      "Ask AI is a $150/mo add-on on top of the plan. User roles and access control, audit logs " +
      "and SSO are Enterprise, annual-only.",
    source: "https://readme.com/pricing",
  },
  {
    key: "redocly",
    name: "Redocly",
    bestFor: "API governance at scale, if 100 pages and per-seat modules fit your shape",
    price: "$10/seat/mo (Pro)",
    topTier: "$24/seat/mo (Enterprise)",
    hosting: "Hosted or self-host",
    format: "OpenAPI-first + Markdown",
    ssoOn: "$24/seat/mo (Enterprise)",
    body:
      "The most serious option for treating your API descriptions as governed artifacts: " +
      "linting, a catalog, scorecards, and a docs frontend over them. Seat-priced rather than " +
      "site-priced — $10/seat/mo on Pro, $24/seat/mo on Enterprise, which is also where SSO, " +
      "RBAC, AI search, analytics and MCP servers arrive. Notably the cheapest route to SSO on " +
      "this page for a small team.",
    caveat:
      "Pro is capped at 1 project and 100 pages; Enterprise at 500. The product is modular " +
      "(Revel, Reef, Realm), and the modules stack per seat — a realistic docs-plus-catalog " +
      "setup is a multiple of the headline seat price, so price the combination you actually " +
      "need rather than the entry number.",
    source: "https://redocly.com/pricing",
  },
  {
    key: "scalar",
    name: "Scalar",
    bestFor: "A sharp OpenAPI reference — if your docs are mostly reference, not prose",
    price: "Free (1 editor seat)",
    topTier: "$72/mo (Pro)",
    hosting: "Hosted or self-host",
    format: "OpenAPI-first",
    ssoOn: "Enterprise",
    body:
      "An excellent API reference and a genuinely good API client, with a free tier that gives " +
      "one editor seat and unlimited viewers, and a $72/mo Pro tier with unlimited editors and " +
      "hosted MCP servers. The API client is MIT-licensed and offline-first, which is a real " +
      "commitment rather than a marketing line.",
    caveat:
      "It's an API-reference platform first. If most of your site is prose — guides, tutorials, " +
      "concept pages — you're using the narrower half of the tool, and the hosted docs product " +
      "isn't the open-source part.",
    source: "https://scalar.com/pricing",
  },
  {
    key: "docusaurus",
    name: "Docusaurus",
    bestFor: "Total control, if you have an engineer to spend on docs infrastructure",
    price: "Free (MIT)",
    topTier: "Free — you pay for hosting",
    hosting: "Self-host",
    format: "MDX + React",
    ssoOn: "You build it",
    body:
      "Meta's docs framework and the default answer to \"just self-host it\": MDX, React " +
      "components, real versioning, and the largest plugin ecosystem of any option here. If " +
      "your docs are a build artifact of your repo and you want no platform in the middle, this " +
      "is the well-trodden path.",
    caveat:
      "It's a framework, not a product — search (Algolia DocSearch or a local plugin), " +
      "analytics, authentication, AI answers, editing for non-developers and the deploy " +
      "pipeline are all yours to wire up and keep working. Free until you count the engineer " +
      "maintaining it.",
    source: "https://docusaurus.io/",
  },
  {
    key: "starlight",
    name: "Starlight (Astro)",
    bestFor: "The nicest defaults of the DIY options — and still DIY",
    price: "Free (MIT)",
    topTier: "Free — you pay for hosting",
    hosting: "Self-host",
    format: "Markdown / MDX + Astro",
    ssoOn: "You build it",
    body:
      "Astro's docs theme, and the option with the best defaults: one command gives you an " +
      "accessible, fast, searchable site with search built in rather than bolted on. Lighter to " +
      "customize than Docusaurus and quicker to first deploy.",
    caveat:
      "Same trade as any framework — no hosted editor, no AI answers, no reader authentication, " +
      "no analytics unless you add them. Versioning is less battle-tested than Docusaurus's.",
    source: "https://starlight.astro.build/",
  },
  {
    key: "fumadocs",
    name: "Fumadocs",
    bestFor: "Building your docs as an app, when you want to own every component",
    price: "Free (MIT)",
    topTier: "Free — you pay for hosting",
    hosting: "Self-host",
    format: "MDX + Next.js",
    ssoOn: "You build it",
    body:
      "A Next.js-native docs framework with OpenAPI generation and typed code samples in the " +
      "box. The natural pick when the docs live in the same repo as a Next app and you'd rather " +
      "own the components than configure a theme.",
    caveat:
      "The youngest option here, with the smallest ecosystem to fall back on. You are building " +
      "an application, not adopting a product — every non-rendering feature is a decision you " +
      "make and maintain.",
    source: "https://fumadocs.dev/",
  },
  {
    key: "mkdocs",
    name: "MkDocs + Material",
    bestFor: "Markdown and YAML, if you can live without components",
    price: "Free (MIT)",
    topTier: "Free — you pay for hosting",
    hosting: "Self-host",
    format: "Markdown + YAML config",
    ssoOn: "You build it",
    body:
      "Write Markdown, configure one YAML file, get a polished site with client-side search, " +
      "dark mode, content tabs and admonitions built in. The Material theme's design system is " +
      "excellent and its previously paid features are now free.",
    caveat:
      "Markdown, not MDX — no components in your content, so a docs.json-shaped repo does not " +
      "port over. Python tooling in a JavaScript shop is a small ongoing tax, and the same " +
      "framework caveat applies: AI, auth, editing and analytics aren't in scope.",
    source: "https://squidfunk.github.io/mkdocs-material/",
  },
];

/**
 * The four claims the page opens with. This used to be a routing table that sent readers to
 * GitBook, ReadMe and Docusaurus before we\u2019d made a single argument — a market survey, not a
 * storefront. Every line here is checkable against the table below it.
 */
export const PICKS = [
  {
    need: "Your content stays yours",
    answer: "Nothing to convert",
    why:
      "We read the same docs.json + MDX. Your repo renders unchanged, and if you ever leave, " +
      "leaving is a DNS record \u2014 not an export project.",
  },
  {
    need: "SSO without a sales call",
    answer: "$29/mo, self-serve",
    why:
      "Single sign-on and role-based access are on the Team plan. At the incumbent, ReadMe and " +
      "GitBook they\u2019re an Enterprise conversation.",
  },
  {
    need: "Production docs at $99",
    answer: "Not $450/mo",
    why:
      "Pro delivers everything production teams need without the category's typical enterprise " +
      "pricing. Optional hosted AI credits, not the headline feature.",
  },
  {
    need: "Run it yourself, today",
    answer: "One command",
    why:
      "`npx papervine dev` serves the real renderer with no database and no account. No " +
      "enterprise engagement, no 45-vCPU cluster, no procurement.",
  },
];

/** Reasons people actually search this, each one a fact from a linked page. */
export const REASONS = [
  {
    title: "The gap between free and $450",
    body:
      "the incumbent\u2019s Starter is free and Pro is $450/mo billed annually ($540 monthly), with " +
      "nothing in between. A two-person team that outgrows free gets a bill that reads like a " +
      "seed-stage line item for a docs site. Our Team plan exists because of exactly that " +
      "shape: $29/mo, with SSO, RBAC, and AI features already in it \u2014 filling the gap the " +
      "category created.",
    source: "https://example.com/pricing",
  },
  {
    title: "SSO shouldn't need a sales call",
    body:
      "Single sign-on is this category\u2019s classic enterprise hostage: Enterprise-only at " +
      "the incumbent and at ReadMe, SAML-on-Enterprise at GitBook. Two options on this page will " +
      "just sell it to you \u2014 Redocly at $24/seat/mo, and us at $29/mo flat, no seat math and " +
      "no procurement thread. Locking your docs down should be a checkbox, not a quarter.",
    source: "https://redocly.com/pricing",
  },
  {
    title: "\"Self-hosted\" means very different things",
    body:
      "Read the fine print before you count it as a feature. The incumbent\u2019s self-hosting is an " +
      "Enterprise engagement delivering proprietary containers: their own guide sizes " +
      "production at roughly 45\u201360 vCPU, 160\u2013220 GB of memory and about 1 TB of SSD, over " +
      "\"typically weeks\", with cloud-dependent integrations unavailable and AI disabled by " +
      "default. A framework like Docusaurus is the opposite extreme \u2014 free, yours, and " +
      "entirely your problem. Ours is one command on a laptop today (`npx papervine dev`, no " +
      "database, no account), and Postgres plus object storage when you want the whole control " +
      "plane.",
    source: "https://example.com/docs/deploy/self-host",
  },
  {
    title: "AI is metered now, everywhere",
    body:
      "Every hosted platform here meters AI separately from seats: the incumbent\u2019s Pro includes " +
      "10,000 credits, GitBook caps assistant answers, ReadMe charges $150/mo for Ask AI on top " +
      "of the plan. It\u2019s the axis that grows with your READERS rather than your team, which is " +
      "why it\u2019s the one that surprises people. We support BYOK from day one on all plans, " +
      "with optional hosted credit pools available on Team and Pro. We put a chart on the usage " +
      "page showing which feature spent them, and hard-cap by default so there is no surprise " +
      "invoice \u2014 overage is something you opt into.",
    source: "https://readme.com/pricing",
  },
];

/** The migration path, which is the actual question behind "what are the alternatives". */
export const MIGRATION_STEPS = [
  {
    title: "Run it on your own repo first",
    body:
      "`npx papervine dev` in your docs directory. No account, no database, no signup — the " +
      "same renderer the hosted product uses, reading your existing docs.json.",
  },
  {
    title: "Connect the repo as a new site",
    body:
      "You get a complete working copy at a Papervine address while your current site keeps " +
      "serving its own traffic. Nothing is irreversible until DNS moves.",
  },
  {
    title: "Compare your ten most-visited pages",
    body:
      "Side by side with the live site. This finds real problems faster than reading any " +
      "compatibility matrix, including this one.",
  },
  {
    title: "Add your domain, let the certificate issue, then flip DNS",
    body:
      "In that order, so the certificate is ready before traffic arrives. Leave the old site up " +
      "for a day or two — reverting is a DNS change back.",
  },
];

export interface Faq {
  q: string;
  a: string;
}

/**
 * The FAQ. Rendered on the page AND used to build the `FAQPage` JSON-LD from one source, so a
 * rich result can never quote an answer that isn't on the page (which is both a Google
 * structured-data violation and a bad surprise for the reader who clicks).
 */
export const FAQS: Faq[] = [
  {
    q: "Is there a free docs platform alternative?",
    a:
      "Yes, and there are two kinds. The frameworks \u2014 Docusaurus, Starlight, Fumadocs, MkDocs " +
      "\u2014 are free and MIT-licensed, and everything a docs platform does beyond rendering " +
      "(search, auth, analytics, AI, editing) is yours to build. Among hosted platforms, " +
      "Papervine\u2019s free tier renders your existing docs.json with search included, and every " +
      "new account gets 30 days of the paid features plus 5,000 AI credits without a card.",
  },
  {
    q: "Can I self-host the incumbent?",
    a:
      "Only on an Enterprise plan, and it isn't an open-source deployment: their guide describes " +
      "a scoped engagement with your account team delivering versioned proprietary containers, " +
      "production sizing of roughly 45–60 vCPU, 160–220 GB of memory and about 1 TB of SSD, " +
      "taking \"typically weeks\", with cloud-dependent integrations unavailable and AI features " +
      "disabled by default.",
  },
  {
    q: "Do I have to rewrite my MDX to switch?",
    a:
      "Not if you pick a platform that reads the format you already have. Papervine renders " +
      "docs.json + MDX directly \u2014 frontmatter, navigation, components, your OpenAPI spec \u2014 so " +
      "the repo goes up unchanged and the migration is a DNS record. Moving to a platform with " +
      "its own content model (GitBook) or an authoring format without components (MkDocs) is a " +
      "conversion project, and should be scoped as one before anyone promises a date.",
  },
  {
    q: "What is docs.json, and does it lock me in?",
    a:
      "It\u2019s the config file describing a docs site \u2014 navigation, theme, metadata \u2014 beside a " +
      "tree of MDX pages, all of it in your own Git repository. On its own it\u2019s the opposite of " +
      "lock-in, but only because more than one renderer reads it: the moment two platforms " +
      "speak your format, your switching cost is a DNS record in either direction. That\u2019s the " +
      "single best reason to choose on format rather than on a feature grid.",
  },
  {
    q: "What's the cheapest way to get SSO on a docs site?",
    a:
      `As of ${PRICES_CHECKED}, two options will sell it to you without a call: Redocly at $24 ` +
      "per seat/month, and Papervine\u2019s Team plan at $50/month flat \u2014 which also includes " +
      "role-based access, the AI assistant and 5,000 credits. At the incumbent, ReadMe and GitBook, " +
      "single sign-on is an Enterprise conversation.",
  },
  {
    q: "Is the incumbent free for open source projects?",
    a:
      "Yes — their OSS program gives Pro free to non-commercial open source projects: a " +
      "recognized license (MIT, Apache 2.0, GPL), no venture or revenue funding, and not owned " +
      "or primarily maintained by a for-profit company.",
  },
  {
    q: "Is Papervine open source?",
    a:
      "Source-available rather than OSI open source, and we\u2019d rather say so plainly than fudge " +
      "it: the CLI and renderer ship under the Elastic License 2.0. You can read the code, run " +
      "it, and self-host it \u2014 the one thing you can\u2019t do is resell it as a hosted service. " +
      "`npx papervine dev` serves a docs repo with no account and no database, which is more " +
      "than most of this category will let you do at any price.",
  },
];

/** JSON-LD for the FAQ block, built from FAQS so the two can't disagree. */
export function faqJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  });
}
