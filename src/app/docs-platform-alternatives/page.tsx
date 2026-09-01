import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { ArrowRight, Check, ExternalLink, Sparkles } from "lucide-react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";
import { appHostFor } from "@/lib/tenant-host";
import { marketingMetadata } from "@/lib/marketing-seo";
import { SIGNED_IN_FLAG } from "@/lib/signed-in-flag";
import {
  ALTERNATIVES,
  DISCLAIMER,
  FAQS,
  MIGRATION_STEPS,
  PICKS,
  PRICES_CHECKED,
  REASONS,
  faqJsonLd,
  type Alternative,
} from "@/lib/marketing-alternatives";

// The comparison page for the search everybody in this category runs: "the incumbent
// alternatives" (SPEC §2, §10.6 — this is a discovery surface, one of the few places the
// house style's generic "hosted docs platforms" is deliberately dropped). All copy, prices,
// sources and the FAQ live in src/lib/marketing-alternatives.ts; that file's header carries
// the rules this page is written under (every number quoted from the vendor's own pricing page,
// linked and dated; no logos; nothing pejorative; and our own licence described accurately).
// This file is layout.
//
// It is a SALES page and reads like one — the first draft was a neutral survey that routed
// readers to four competitors before making an argument, which is a nice thing to publish and
// a bad thing to put on a storefront. What keeps it credible while it argues: every price is
// quoted from the vendor's own pricing page and linked, and the disclaimer is on the page.
// Facts checkable, framing ours.
//
// The section no competitor's version of this page can write is "Moving without rewriting
// anything": because we read the same docs.json, leaving us is a DNS change too — and nobody
// selling their own content model has any incentive to talk about the exit.

const GITHUB = "https://github.com/papervine/papervine";
const DOCS_MIGRATE = "https://docs.papervine.io/guides/migrate";

export const metadata: Metadata = marketingMetadata({
  // Leads with the exact phrase, and stays inside the ~60-char budget so it survives
  // truncation in a search result.
  title: "Docs Platform Alternatives — 10 Docs Platforms Compared",
  description:
    "10 docs platform alternatives compared on real prices from their own pricing pages. See which " +
    "ones read your existing docs.json, where SSO costs $65 instead of an enterprise call, and " +
    "how to migrate without rewriting a page.",
  path: "/docs-platform-alternatives",
  keywords: [
    "docs platform alternatives",
    "docs platform alternative",
    "docs platform competitors",
    "docs platform comparison",
    "docs platform pricing",
    "open source docs platform alternative",
    "self-hosted documentation platform",
    "docs.json",
    "documentation platform comparison",
    "GitBook alternative",
    "ReadMe alternative",
    "Docusaurus alternative",
  ],
});

/**
 * Renders `backtick`-quoted spans in the copy as inline code. The content module is plain
 * data (shared with the JSON-LD, which must stay text), so the markup lives here — one
 * split rather than a markdown dependency for a page with four code spans on it.
 */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="mono rounded bg-[rgba(var(--ink-rgb),0.07)] px-1.5 py-0.5 text-[0.9em]"
          >
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  const external = href.startsWith("http");
  const className =
    "inline-flex items-center gap-1 text-sm text-[var(--muted)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--fg)]";
  // rel="nofollow" on competitor links: this page links out a lot by design, and those links
  // are citations for a price, not endorsements we're passing authority to.
  return external ? (
    <a href={href} target="_blank" rel="noreferrer nofollow" className={className}>
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

function PlatformSection({ alt }: { alt: Alternative }) {
  return (
    <section
      id={`alt-${alt.key}`}
      className="scroll-mt-24 rounded-3xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.02)] p-7"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-xl font-semibold">{alt.name}</h3>
        {alt.us && (
          <span className="rounded-full border border-[rgba(var(--ink-rgb),0.12)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
            that&rsquo;s us
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--blue)]">{alt.bestFor}</p>

      <p className="mt-4 leading-relaxed text-[var(--fg)]/90">
        <Prose text={alt.body} />
      </p>

      <p className="mt-4 leading-relaxed text-[var(--muted)]">
        <span className="font-medium text-[var(--fg)]">
          {alt.us ? "One thing to know: " : "The trade: "}
        </span>
        <Prose text={alt.caveat} />
      </p>

      <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-[rgba(var(--ink-rgb),0.06)] pt-5 text-sm sm:grid-cols-3">
        {[
          ["Starts at", alt.price],
          ["Top self-serve tier", alt.topTier],
          ["SSO / RBAC on", alt.ssoOn],
          ["Hosting", alt.hosting],
          ["Content format", alt.format],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[var(--muted)]">{label}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[var(--muted)]">Source</dt>
          <dd className="mt-0.5">
            <SourceLink
              href={alt.source}
              label={alt.us ? "Our pricing" : "Their pricing page"}
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default async function DocsPlatformAlternativesPage() {
  // Same session-aware apex chrome as the landing and pricing pages (see home/page.tsx for
  // the pv_signed_in / app-host rationale).
  const signedIn = Boolean((await cookies()).get(SIGNED_IN_FLAG));
  const host = (await headers()).get("host") ?? "papervine.io";
  const appBase = `${host.includes("localhost") ? "http" : "https"}://${appHostFor(host)}`;

  return (
    // `lite`, not the marketing `full`: this page is a wide table plus ten dense cards, and
    // the grid + grain the landing pages wear sit *behind* all of it. That's the documented
    // reason the variant exists (PlatformShell) — atmosphere is for sparse pages.
    <PlatformShell variant="lite">
      {/* FAQPage structured data, built from the same FAQS the page renders below. */}
      <script
        type="application/ld+json"
        // Next escapes nothing here by design; the payload is our own static content and
        // JSON.stringify has already escaped the quotes.
        dangerouslySetInnerHTML={{ __html: faqJsonLd() }}
      />

      <header className="db-glass sticky top-0 z-30 border-b border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center">
            <Brand size="md" priority />
          </Link>
          <nav className="flex items-center gap-1 whitespace-nowrap text-sm">
            <Link
              href="/pricing"
              className="hidden rounded-lg px-3 py-1.5 text-[var(--fg)] transition-colors sm:inline-block"
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
      <section className="mx-auto max-w-3xl px-6 pb-14 pt-20 text-center sm:pt-24">
        <h1
          className="db-rise text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl"
          style={{ animationDelay: "0ms" }}
        >
          Docs platform <span className="db-grad">alternatives</span>
        </h1>
        <p
          className="db-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--muted)]"
          style={{ animationDelay: "80ms" }}
        >
          Ten of them, with prices quoted from their own pricing pages. Most ask you to trade
          something for the upgrade — your format, your budget, or your weekends.{" "}
          <span className="text-[var(--fg)]">
            One of them reads the repo you already have.
          </span>
        </p>
        <p
          className="db-rise mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.04)] px-4 py-2 text-sm text-[var(--fg)]"
          style={{ animationDelay: "140ms" }}
        >
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--blue)]" />
          {/* One plain line: an inline <code> in here forced the pill to wrap mid-phrase. */}
          Your docs.json renders here unchanged. Try it in one command.
        </p>
      </section>

      {/* Pick by need */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Why people move here specifically
        </h2>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Four claims, each one checkable against the table below it.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PICKS.map((p) => (
            <div
              key={p.need}
              className="rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] p-5"
            >
              <p className="text-sm text-[var(--muted)]">{p.need}</p>
              <p className="mt-1.5 text-lg font-semibold">{p.answer}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                <Prose text={p.why} />
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* The table */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          The 10 alternatives, side by side
        </h2>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Prices as of {PRICES_CHECKED}. &ldquo;Top self-serve tier&rdquo; is the most you can
          pay without a sales call — where a growing team lands before Enterprise.
        </p>
        {/* Wide table scrolls inside its own container; the page must never scroll sideways. */}
        <div className="mt-6 overflow-x-auto rounded-2xl border border-[rgba(var(--ink-rgb),0.08)]">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="bg-[rgba(var(--ink-rgb),0.04)] text-left">
                {[
                  "Platform",
                  "Starts at",
                  "Top self-serve tier",
                  "SSO / RBAC on",
                  "Hosting",
                  "Content format",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium text-[var(--muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALTERNATIVES.map((alt) => (
                <tr
                  key={alt.key}
                  className="border-t border-[rgba(var(--ink-rgb),0.06)] align-top"
                >
                  <td className="px-4 py-3 font-medium">
                    <a
                      href={`#alt-${alt.key}`}
                      className="underline decoration-dotted underline-offset-4"
                    >
                      {alt.name}
                    </a>
                    {alt.us && (
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                        (ours)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{alt.price}</td>
                  <td className="px-4 py-3 tabular-nums">{alt.topTier}</td>
                  <td className="px-4 py-3 tabular-nums">{alt.ssoOn}</td>
                  <td className="px-4 py-3">{alt.hosting}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{alt.format}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-platform detail */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          The ten, and what each one costs you
        </h2>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Ours first, because we think it wins for most teams reading this. If your writers
          will genuinely never open a pull request, GitBook is the better tool and we&rsquo;d
          rather you knew that from us.
        </p>
        <div className="mt-6 flex flex-col gap-5">
          {ALTERNATIVES.map((alt) => (
            <PlatformSection key={alt.key} alt={alt} />
          ))}
        </div>
      </section>

      {/* Why people look */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Four things this category gets wrong
        </h2>
        <p className="mt-2 max-w-2xl text-[var(--muted)]">
          Not opinions — four facts about how docs platforms are priced, each one checkable on
          the page it links to.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {REASONS.map((r) => (
            <div
              key={r.title}
              className="rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] p-6"
            >
              <h3 className="font-semibold">{r.title}</h3>
              <p className="mt-2 leading-relaxed text-[var(--muted)]">
                <Prose text={r.body} />
              </p>
              <p className="mt-3">
                <SourceLink href={r.source} label="Source" />
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* The migration section nobody else writes */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-3xl border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.03)] p-8">
          <h2 className="text-2xl font-semibold tracking-tight">
            Moving without rewriting anything
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-[var(--muted)]">
            Every list like this one is written by somebody who wants you to move in. Here is
            the part they leave out: if the next platform reads the same{" "}
            <code className="mono rounded bg-[rgba(var(--ink-rgb),0.07)] px-1.5 py-0.5 text-[0.9em]">
              docs.json
            </code>{" "}
            your repo already has, then moving is a DNS change — and so is moving back out
            again if you don&rsquo;t like it. That symmetry is the whole point, and it is the
            reason to care about the format rather than the feature grid.
          </p>
          <ol className="mt-6 flex flex-col gap-4">
            {MIGRATION_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(var(--ink-rgb),0.14)] text-xs tabular-nums text-[var(--muted)]">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="mt-1 leading-relaxed text-[var(--muted)]">
                    <Prose text={s.body} />
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={DOCS_MIGRATE}
              className="db-cta inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium text-white"
            >
              Read the migration guide
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href={GITHUB}
              className="inline-flex items-center gap-2 rounded-lg border border-[rgba(var(--ink-rgb),0.12)] px-5 py-2.5 font-medium transition-colors hover:bg-[rgba(var(--ink-rgb),0.04)]"
            >
              See the source
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <h2 className="text-2xl font-semibold tracking-tight">Questions people ask</h2>
        <div className="mt-6 flex flex-col divide-y divide-[rgba(var(--ink-rgb),0.06)]">
          {FAQS.map((f) => (
            <div key={f.q} className="py-5">
              <h3 className="font-semibold">{f.q}</h3>
              <p className="mt-2 leading-relaxed text-[var(--muted)]">
                <Prose text={f.a} />
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 pb-16 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Try it against <span className="db-grad">your own repo</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-[var(--muted)]">
          Nothing to convert and nothing to decide: point it at the docs you already have and
          see what renders. Locally in one command, or hosted with 30 days of everything and
          10,000 AI credits — no card.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/signup"
            className="db-cta inline-flex items-center gap-2 rounded-lg px-6 py-3 font-medium text-white"
          >
            Start free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-lg border border-[rgba(var(--ink-rgb),0.12)] px-6 py-3 font-medium transition-colors hover:bg-[rgba(var(--ink-rgb),0.04)]"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--muted)]">
          <Check className="h-4 w-4 text-[var(--blue)]" />
          Your existing docs.json renders unchanged
        </p>
      </section>

      {/* Disclaimer — required on this page, not boilerplate. */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <p className="rounded-2xl border border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)] p-5 text-xs leading-relaxed text-[var(--muted)]">
          {DISCLAIMER}
        </p>
      </section>

      <footer className="border-t border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--muted)] sm:flex-row">
          <span className="flex items-center gap-1.5">
            <Brand size="sm" />
          </span>
          <div className="flex flex-wrap justify-center gap-5">
            <Link href="/pricing" className="transition-colors hover:text-[var(--fg)]">
              Pricing
            </Link>
            <a href={DOCS_MIGRATE} className="transition-colors hover:text-[var(--fg)]">
              Migrate
            </a>
            <a href={GITHUB} className="transition-colors hover:text-[var(--fg)]">
              GitHub
            </a>
            <Link href="/privacy" className="transition-colors hover:text-[var(--fg)]">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-[var(--fg)]">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </PlatformShell>
  );
}
