import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  FileJson2,
  Search,
  Boxes,
  MessageSquareCode,
  Plug,
  Bot,
  MessagesSquare,
  Lock,
  PenLine,
  Globe,
  BarChart3,
  Github,
} from "lucide-react";
import { cookies, headers } from "next/headers";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";
import { HeroVideo } from "@/components/HeroVideo";
import { TryItSection } from "@/components/home/TryItSection";
import { SparklesText } from "@/components/home/SparklesText";
import { resolveDocsFrame, resolveHomeDemo } from "@/lib/home-demo";
import { appHostFor } from "@/lib/tenant-host";
import { marketingMetadata } from "@/lib/marketing-seo";
import { SIGNED_IN_FLAG } from "@/lib/signed-in-flag";
import { formatStars, githubStars } from "@/lib/github-stars";

// Marketing landing for the SaaS apex (SPEC §2). Reached via the middleware rewrite
// of `/` when not in single-repo preview mode (no PAPERVINE_CONTENT).
// Naming a competitor is confined to THIS file on purpose. The house style everywhere else —
// SPEC, docs/, code comments, commits — is the generic "hosted docs platforms", and that stands
// (see AGENTS.md). Marketing is the exception: "docs platform alternative" is what people actually
// search, and the claim behind it is real rather than positioning — Papervine reads the same
// `docs.json`, so an existing repo migrates unchanged.
const ALTERNATIVE_KEYWORD = "docs platform alternative";

// Kept near 60 characters so the keyword survives search-result truncation, and set as
// `absolute` below: the root layout's `%s · Papervine` template would otherwise append a second
// "Papervine" and push this well past that budget.
const TITLE = `Papervine — publish beautiful docs | ${ALTERNATIVE_KEYWORD}`;
// Leads with the hero's own positioning so the unfurled card reads as the page it links to,
// then keeps the competitor sentence — that clause is the discovery surface (§10.6), not
// decoration, and it stays whatever the headline above it happens to say.
const DESCRIPTION =
  "AI-powered self-updating knowledge platform. Open source or hosted. " +
  "An alternative to the incumbent, ReadMe, and GitBook.";

// Canonical host, `og:`/`twitter:` tags and our X handle come from the shared marketing helper
// — see marketing-seo.ts for why they can't live in the root layout (it renders for tenant docs
// too, and would attribute a customer's card to us). The card image itself is the sibling
// `opengraph-image.tsx`, which Next merges in.
export const metadata: Metadata = marketingMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/",
  keywords: [
    ALTERNATIVE_KEYWORD,
    "docs platform alternatives",
    "ReadMe alternative",
    "GitBook alternative",
    "docs.json",
    "documentation platform",
    "docs as code",
    "MDX documentation",
    "AI documentation assistant",
    "API documentation",
  ],
});

// Our own docs, dogfooded through Papervine as an ordinary site whose custom domain is a
// host on our own domain (SPEC §2 — operator-claimable, gated by PLATFORM_ADMIN_EMAILS).
// An absolute <a>, not <Link>: a different host is a hard navigation, never a soft RSC nav
// (the tenant-host rewrite gotcha in CLAUDE.md).
const DOCS = "https://docs.papervine.io/";
// Public CLI repo (the one people clone / star). Absolute <a>, not <Link> (hard nav off the apex).
const GITHUB = "https://github.com/papervine/papervine";

// The migrate guide backs the "alternative" claim below — it is the page that proves it.
const DOCS_MIGRATE = `${DOCS}guides/migrate`;

// Deploy-your-own. The same clone URL as apps/cli/README.md and the self-hosting guide —
// `root-directory` is what aims Vercel at the CLI app instead of the monorepo root, and
// without it the clone builds the control plane and fails for want of a database.
const DEPLOY_TO_VERCEL =
  "https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpapervine%2Fpapervine" +
  "&root-directory=apps%2Fcli&project-name=papervine-docs&repository-name=papervine-docs";

// What you get (top section). Same capabilities as before, said without the insider terms
// (MCP, llms.txt, "docs as code") that a first-time visitor wouldn't parse.
const PILLARS = [
  {
    icon: Plug,
    title: "A real docs website",
    body: "Search, your own domain, and API reference — a documentation site, not a pile of files.",
  },
  {
    icon: Bot,
    title: "Easier to keep current",
    body: "An editing assistant and a visual editor help you update pages without starting from scratch every time.",
  },
  {
    icon: MessagesSquare,
    title: "Answers, not just pages",
    body: "Visitors can ask questions and get answers from your docs, with citations back to the page.",
  },
];

// Concrete capabilities (bento). docs.json / OpenAPI stay when that's the actual artifact —
// explained in the same sentence so a novice isn't left guessing.
const FEATURES = [
  {
    icon: FileJson2,
    title: "Bring the docs you already have",
    body: "If you already have a docs.json — the config file many docs sites use — point Papervine at that repo and it renders unchanged.",
  },
  {
    icon: Boxes,
    title: "API docs you can try",
    body: "Drop in an OpenAPI spec (the file that describes your API) and get endpoint docs with request and response examples, right in the nav.",
  },
  {
    icon: Search,
    title: "Search the whole site",
    body: "⌘K search across every page, heading, and code block — re-indexed whenever your docs update, no extra service to run.",
  },
  {
    icon: MessageSquareCode,
    title: "Put the assistant on your website",
    body: "Add the docs assistant to any site you run with a script snippet — gated by an allowlist, not a login.",
  },
  {
    icon: Lock,
    title: "Some pages public, some private",
    body: "Mark any page as private with one line at the top of the file. Readers sign in through your own identity provider — we never hold their passwords.",
  },
  {
    icon: PenLine,
    title: "Edit in the browser",
    body: "A three-panel workspace with an editing assistant, live collaboration, and a visual editor. Publish as a commit or a pull request.",
  },
  {
    icon: Globe,
    title: "Your docs, your domain",
    body: "Serve docs on your own domain with automatic HTTPS — or take the subdomain we give you and skip DNS entirely.",
  },
  {
    icon: BarChart3,
    title: "See what people actually read",
    body: "See which pages people open and what they search for — then flip one toggle to see the same site the way automated crawlers see it.",
  },
];

export default async function LandingPage() {
  // Apex nav is session-aware: a signed-in visitor gets a single Dashboard link instead
  // of Log in / Sign up. The real session cookie is host-only on the app host (SPEC §10),
  // so the apex can't read it — we read the benign `pv_signed_in` hint instead, and the
  // Dashboard link points at the app host (where the gate resolves it to the dashboard).
  // Log in / Sign up stay relative; the apex→app middleware redirect routes them over.
  const signedIn = Boolean((await cookies()).get(SIGNED_IN_FLAG));
  const host = (await headers()).get("host") ?? "papervine.io";
  const appBase = `${host.includes("localhost") ? "http" : "https"}://${appHostFor(host)}`;
  // The site backing the "Ask" demo, or null to fall back to link chips (no DB, single-repo
  // preview, or the widget isn't enabled/allowlisted for this origin yet). Never throws —
  // the home page has to render DB-free (the smoke gate probes it without Postgres).
  const demo = await resolveHomeDemo(host);
  // The rendered docs site the demo frames (the forkable starter, which carries an OpenAPI
  // spec and therefore a working API console). Null → the frame shows its static placeholder.
  const frame = await resolveDocsFrame(host);
  // Decoration on the GitHub button. Null when api.github.com is slow, rate-limited or
  // unreachable, and the button simply renders without a number (see githubStars).
  const stars = await githubStars();

  return (
    <PlatformShell variant="home">
      {/* Header */}
      <header className="db-glass sticky top-0 z-30 border-b border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center">
            <Brand size="md" priority />
          </Link>
          <nav className="flex items-center gap-1 whitespace-nowrap text-sm">
            {/* Secondary links crowd the logo + primary CTA off a narrow phone screen —
                keep just the one thing that matters there; they return at sm:. */}
            <a
              href={DOCS}
              className="hidden rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:inline-block"
            >
              Docs
            </a>
            <Link
              href="/pricing"
              className="hidden rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:inline-block"
            >
              Pricing
            </Link>
            <a
              href={GITHUB}
              className="hidden rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:inline-block"
            >
              GitHub
            </a>
            {signedIn ? (
              <a
                href={`${appBase}/`}
                className="db-cta ml-1 rounded-lg px-4 py-1.5 font-medium text-white"
              >
                Dashboard
              </a>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)] sm:inline-block"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="db-cta ml-1 rounded-lg px-4 py-1.5 font-medium text-white"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero. Left-aligned, with the tour reduced to a small pill on the right — the live demo
          below is the hero's real product shot now, and two big frames stacked read as a
          showreel rather than a product. */}
      <section className="mx-auto max-w-7xl px-6 pb-10 pt-20 sm:pt-24">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-2xl">
            {/* No eyebrow above the headline. The slot has carried a "New · …" announcement and
                then a tagline; both were saying less than the headline directly under them, and
                the hero reads better starting on the claim itself. */}
            <h1
              className="db-rise text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
              style={{ animationDelay: "0ms" }}
            >
              <SparklesText>
                Publish <span className="db-grad">beautiful</span> docs.
              </SparklesText>
            </h1>

            <p
              className="db-rise mt-6 max-w-xl text-lg leading-relaxed text-[var(--muted)]"
              style={{ animationDelay: "160ms" }}
            >
              AI-powered self-updating knowledge platform. Open source or
              hosted.
            </p>

            <div
              className="db-rise mt-9 flex flex-wrap items-center gap-x-5 gap-y-3"
              style={{ animationDelay: "240ms" }}
            >
              <Link
                href="/signup"
                className="db-cta inline-flex items-center rounded-xl px-5 py-3 text-sm font-medium text-white"
              >
                Free Trial
              </Link>

              {/* Deploy-your-own, beside the trial CTA on purpose: the two ways in are hosted or
                  self-hosted, and the page claims both a sentence later. Same clone URL the CLI
                  README and the self-hosting guide use — `root-directory` is what points Vercel
                  at the CLI app rather than the monorepo. */}
              <a
                href={DEPLOY_TO_VERCEL}
                className="db-ring inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.05)]"
              >
                {/* Vercel's mark is a plain triangle; inlined rather than loading their button
                    image so the hero pulls nothing from a third-party origin. */}
                <svg viewBox="0 0 76 65" className="h-3.5 w-3.5" aria-hidden fill="currentColor">
                  <path d="M38 0 76 65H0Z" />
                </svg>
                Deploy
              </a>

              <a
                href={GITHUB}
                className="db-ring inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.05)]"
              >
                <Github className="h-4 w-4" />
                Star
                {/* Absent when GitHub can't be reached — see githubStars(). The separator is
                    part of the conditional so it never renders as a dangling divider. */}
                {stars !== null && (
                  <span className="mono flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <span className="text-[rgba(var(--ink-rgb),0.25)]">|</span>
                    {formatStars(stars)}
                  </span>
                )}
              </a>
            </div>

            {/* The same claim, said the way people search for it. Not keyword stuffing: reading
                the same config IS the migration story, and the link proves it. */}
            <p
              className="db-rise mt-4 max-w-lg text-sm leading-relaxed text-[var(--muted)]"
              style={{ animationDelay: "360ms" }}
            >
              Looking for a{" "}
              <span className="font-medium text-[var(--fg)]">docs platform alternative</span>? If you
              already have docs, they work here without a rewrite — Papervine reads the same{" "}
              <span className="mono text-[var(--fg)]">docs.json</span>.{" "}
              <a
                href={DOCS_MIGRATE}
                className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--fg)]"
              >
                migrate in minutes
              </a>
              .
            </p>
          </div>

          <div className="db-rise lg:justify-self-end" style={{ animationDelay: "380ms" }}>
            <HeroVideo />
          </div>
        </div>
      </section>

      {/* Try it — the product itself, immediately under the hero. It IS the product shot. */}
      <TryItSection demo={demo} docsUrl={DOCS} frameUrl={frame?.url ?? null} />

      {/* What you get */}
      <section className="mx-auto max-w-6xl px-6 pt-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            What you get
          </h2>
          <p className="mt-4 text-[var(--muted)]">
            A documentation website, tools to keep it current, and an assistant
            that answers from your pages.
          </p>
        </div>
        <div className="mt-14 grid gap-10 sm:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[var(--blue)]/25 to-[var(--violet)]/25 text-[var(--blue)] ring-1 ring-[rgba(var(--ink-rgb),0.1)]">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Concrete features — bento */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <h2 className="text-center text-sm font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
          Everything a docs site needs
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="db-feature rounded-2xl p-6">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[var(--blue)]/20 to-[var(--violet)]/20 text-[var(--blue)] ring-1 ring-[rgba(var(--ink-rgb),0.1)]">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-6 pb-28">
        <div
          className="relative overflow-hidden rounded-3xl p-[1px]"
          style={{
            background: "linear-gradient(120deg, var(--blue), var(--violet))",
          }}
        >
          <div className="relative flex flex-col items-center gap-5 rounded-3xl bg-[#080810] px-6 py-16 text-center">
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(60% 120% at 50% 0%, rgba(120,120,255,0.25), transparent 70%)",
              }}
            />
            <h2 className="relative text-3xl font-semibold tracking-tight sm:text-4xl">
              Put your docs online today
            </h2>
            <p className="relative max-w-md text-[var(--muted)]">
              Connect a repo or start from scratch. Search, your domain, and an
              assistant are included.
            </p>
            <Link
              href="/signup"
              className="db-cta relative inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium text-white"
            >
              Get started — free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--muted)] sm:flex-row">
          <span className="flex items-center gap-1.5">
            <Brand size="sm" />
          </span>
          <div className="flex gap-5">
            <a href={DOCS} className="transition-colors hover:text-[var(--fg)]">
              Docs
            </a>
            <Link
              href="/pricing"
              className="transition-colors hover:text-[var(--fg)]"
            >
              Pricing
            </Link>
            <a href={GITHUB} className="transition-colors hover:text-[var(--fg)]">
              GitHub
            </a>
            {signedIn ? (
              <a
                href={`${appBase}/`}
                className="transition-colors hover:text-[var(--fg)]"
              >
                Dashboard
              </a>
            ) : (
              <>
                <Link
                  href="/login"
                  className="transition-colors hover:text-[var(--fg)]"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="transition-colors hover:text-[var(--fg)]"
                >
                  Sign up
                </Link>
              </>
            )}
            <Link
              href="/privacy"
              className="transition-colors hover:text-[var(--fg)]"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="transition-colors hover:text-[var(--fg)]"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </PlatformShell>
  );
}
