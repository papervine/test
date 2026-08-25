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
} from "lucide-react";
import { cookies, headers } from "next/headers";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";
import { appHostFor } from "@/lib/tenant-host";
import { marketingMetadata } from "@/lib/marketing-seo";
import { SIGNED_IN_FLAG } from "@/lib/signed-in-flag";

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
const TITLE = `Papervine — the intelligent docs platform | ${ALTERNATIVE_KEYWORD}`;
const DESCRIPTION =
  "A modern docs platform alternative: docs.json-native, so your existing docs repo migrates " +
  "unchanged. Documentation built for humans and AI — API playground, instant search, and an " +
  "AI assistant.";

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

// The hero announcement pill links at the page explaining what it announces.
const DOCS_READER_AUTH = `${DOCS}auth/reader-auth`;
// The migrate guide backs the "alternative" claim below — it is the page that proves it.
const DOCS_MIGRATE = `${DOCS}guides/migrate`;

// The "intelligence" story (top section).
const PILLARS = [
  {
    icon: Plug,
    title: "Built for people and agents",
    body: "llms.txt and MCP out of the box, so your product shows up in the AI workflows your users already live in.",
  },
  {
    icon: Bot,
    title: "Docs that keep themselves current",
    body: "Draft, edit, and update content with a context-aware agent — move faster, without the documentation debt.",
  },
  {
    icon: MessagesSquare,
    title: "Guided answers for every visitor",
    body: "Turn every docs visit into a conversation: intelligent assistance grounded in your content, with citations.",
  },
];

// Concrete capabilities (bento).
const FEATURES = [
  {
    icon: FileJson2,
    title: "docs.json-native",
    body: "The config schema you already know. Point Papervine at an existing repo and it renders unchanged — migration is a DNS switch.",
  },
  {
    icon: Boxes,
    title: "API playground",
    body: "Drop in an OpenAPI spec and get auto-generated, in-nav endpoint reference with request and response schemas.",
  },
  {
    icon: Search,
    title: "Instant search",
    body: "⌘K search across every page, heading, and code block — re-indexed on each sync, no extra service to run.",
  },
  {
    icon: MessageSquareCode,
    title: "Embeddable widget",
    body: "Drop the assistant into any external site with a script snippet — gated by an allowlist, not a login.",
  },
  {
    icon: Lock,
    title: "Public and private, one site",
    body: "Gate any page to a reader group with one line of frontmatter. Readers sign in through your own IdP — we never hold their credentials.",
  },
  {
    icon: PenLine,
    title: "Visual editor",
    body: "A three-panel workspace with an editing agent, live collaboration, and MDX round-tripping. Publish as a commit or a pull request.",
  },
  {
    icon: Globe,
    title: "Custom domains",
    body: "Serve docs on your own domain with automatic TLS — or take the subdomain we give you and skip DNS entirely.",
  },
  {
    icon: BarChart3,
    title: "Humans vs. agents",
    body: "See what people read and search for — then flip one toggle to see the same site through the eyes of the agents crawling it.",
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

  return (
    <PlatformShell variant="home">
      {/* Header */}
      <header className="db-glass sticky top-0 z-30 border-b border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-24 text-center sm:pt-32">
        <a
          href={DOCS_READER_AUTH}
          className="db-rise db-ring mono inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-[var(--muted)]"
          style={{ animationDelay: "0ms" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--blue)] shadow-[0_0_8px_2px_rgba(91,140,255,0.7)]" />
          New · public docs and internal docs, one site
        </a>

        <h1
          className="db-rise mt-7 text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
          style={{ animationDelay: "80ms" }}
        >
          Documentation
          <br />
          that <span className="db-grad">grows</span> itself.
        </h1>

        <p
          className="db-rise mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[var(--muted)]"
          style={{ animationDelay: "160ms" }}
        >
          Write, publish, and maintain world-class docs — built for both your
          readers and the AI agents they rely on.
        </p>

        <div
          className="db-rise mt-9 flex items-center justify-center gap-3"
          style={{ animationDelay: "240ms" }}
        >
          <Link
            href="/signup"
            className="db-cta group inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white"
          >
            Start free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div
          className="db-rise mono mx-auto mt-6 flex w-fit items-center gap-2 text-xs text-[var(--muted)]"
          style={{ animationDelay: "320ms" }}
        >
          <FileJson2 className="h-3.5 w-3.5" />
          drop in your <span className="text-[var(--fg)]">docs.json</span> — it
          just works
        </div>

        {/* Sits under the docs.json line because it is the same claim, said the way people
            search for it. Not keyword stuffing: reading the same config IS the migration story,
            and the link goes to the page that proves it. */}
        <p
          className="db-rise mx-auto mt-5 max-w-lg text-sm leading-relaxed text-[var(--muted)]"
          style={{ animationDelay: "360ms" }}
        >
          Looking for a{" "}
          <span className="font-medium text-[var(--fg)]">docs platform alternative</span>? Papervine
          reads the same <span className="mono text-[var(--fg)]">docs.json</span>, so your
          existing docs repo renders unchanged —{" "}
          <a
            href={DOCS_MIGRATE}
            className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--fg)]"
          >
            migrate in minutes
          </a>
          .
        </p>
      </section>

      {/* Product mock */}
      <section className="mx-auto max-w-5xl px-6">
        <div
          className="db-rise relative rounded-2xl p-[1px]"
          style={{
            animationDelay: "380ms",
            background:
              "linear-gradient(160deg, rgba(140,140,255,0.5), rgba(255,255,255,0.04) 40%)",
          }}
        >
          <div className="overflow-hidden rounded-2xl bg-[#0a0a12]">
            <div className="flex items-center gap-2 border-b border-[rgba(var(--ink-rgb),0.06)] px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="mono ml-3 text-xs text-[var(--muted)]">
                docs.example.com
              </span>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-6 p-6">
              <div className="hidden flex-col gap-2.5 sm:flex">
                <div className="h-2 w-20 rounded bg-[rgba(var(--ink-rgb),0.1)]" />
                {[28, 22, 18].map((w, i) => (
                  <div
                    key={i}
                    className="h-2 rounded bg-[rgba(var(--ink-rgb),0.06)]"
                    style={{ width: `${w * 4}px` }}
                  />
                ))}
                <div className="mt-3 h-2 w-16 rounded bg-[rgba(var(--ink-rgb),0.1)]" />
                {[24, 20].map((w, i) => (
                  <div
                    key={i}
                    className="h-2 rounded bg-[rgba(var(--ink-rgb),0.06)]"
                    style={{ width: `${w * 4}px` }}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <div className="h-3 w-24 rounded bg-gradient-to-r from-[var(--blue)] to-[var(--violet)]" />
                <div className="h-6 w-2/3 rounded bg-[rgba(var(--ink-rgb),0.15)]" />
                <div className="h-2.5 w-full rounded bg-[rgba(var(--ink-rgb),0.07)]" />
                <div className="h-2.5 w-11/12 rounded bg-[rgba(var(--ink-rgb),0.07)]" />
                <div className="h-2.5 w-4/5 rounded bg-[rgba(var(--ink-rgb),0.07)]" />
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="h-20 rounded-lg border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)]" />
                  <div className="h-20 rounded-lg border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Intelligence pillars */}
      <section className="mx-auto max-w-5xl px-6 pt-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for the AI era
          </h2>
          <p className="mt-4 text-[var(--muted)]">
            Intelligence woven into how your docs are written, served, and
            understood — not bolted on after.
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
      <section className="mx-auto max-w-5xl px-6 py-28">
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
      <section className="mx-auto max-w-5xl px-6 pb-28">
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
              Make your docs a competitive advantage
            </h2>
            <p className="relative max-w-md text-[var(--muted)]">
              Point Papervine at a repo and ship documentation your users — and
              their agents — actually use. Future-proof it today.
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
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--muted)] sm:flex-row">
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
