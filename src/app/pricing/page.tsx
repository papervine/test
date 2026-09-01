import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Plus, Check, ArrowRight, Sparkles } from "lucide-react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";
import { appHostFor } from "@/lib/tenant-host";
import { marketingMetadata } from "@/lib/marketing-seo";
import { SIGNED_IN_FLAG } from "@/lib/signed-in-flag";
import {
  HOSTED_TIERS,
  SELFHOST_TIER,
  CONTACT_HREF,
  type PlanKey,
  type PlanCta,
  type BrandMark,
} from "@/lib/billing/plan-content";
import { PlanMatrix } from "@/components/billing/PlanMatrix";

// Pricing for the SaaS apex (SPEC §2, §10 Billing). Uses the landing page chrome +
// `.db` design language. Five columns: Self-host ($0 OSS), Free ($0 hosted),
// Team ($65 with SSO/RBAC/AI search), Pro ($250 with widget/insights/workflows), Enterprise
// (SCIM/SLA/migration). 30-day trial on every account. BYOK from day one on all tiers;
// hosted AI credits are optional pools. Numbers mirror src/lib/billing/catalog.json —
// change them THERE (catalog is the source of truth; this page is marketing copy over it).
// Shared marketing metadata: canonical host, `og:`/`twitter:` tags and our X handle (see
// marketing-seo.ts). It also fixes the title, which the root layout's `%s · Papervine` template
// was turning into "Pricing — Papervine · Papervine". The card image is the sibling
// `opengraph-image.tsx`; unlike this description it carries no prices, so a reprice can't
// strand a stale image on timelines that already scraped it.
export const metadata: Metadata = marketingMetadata({
  title: "Pricing — Papervine",
  description:
    "Self-host for free (OSS). Free hosted for individuals and small teams. Team $65/mo with SSO, RBAC & AI search. Pro $250/mo with widget, insights & workflows. Enterprise for SCIM, SLA, and migration. 30-day trial. BYOK from day one.",
  path: "/pricing",
});

const GITHUB = "https://github.com/papervine/papervine";
const CONTACT = CONTACT_HREF;

// All plan copy — tier cards, feature bullets, comparison matrix, positioning — comes
// from the catalog (src/lib/billing/catalog.json → plan-content.ts), shared with the
// in-app Settings→Billing surface. This page adds only the marketing chrome.

// Third-party wordmarks for the Self-host card's two buttons (display.cta.brand in the
// catalog). Inline SVG rather than lucide, which carries no brand logos — and rather than a
// remote badge image, which would put a request to someone else's CDN on the pricing page.
const BRAND_PATHS: Record<BrandMark, string> = {
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 " +
    "0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 " +
    "17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 " +
    "1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 " +
    "1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 " +
    "3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 " +
    "3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 " +
    "1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  vercel: "M24 22.525H0l12-21.05 12 21.05z",
};

// A card CTA rendered as an anchor. `/signup` and `mailto:` stay in the tab; an http(s)
// href (GitHub, Vercel) opens in a new one so the pricing page isn't lost.
function CtaLink({
  cta,
  className,
  arrow = false,
}: {
  cta: PlanCta;
  className: string;
  arrow?: boolean;
}) {
  const content = (
    <>
      {cta.brand && (
        <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-current">
          <path d={BRAND_PATHS[cta.brand]} />
        </svg>
      )}
      {cta.label}
      {arrow && <ArrowRight className="h-4 w-4" />}
    </>
  );
  if (cta.href.startsWith("/"))
    return (
      <Link href={cta.href} className={className}>
        {content}
      </Link>
    );
  // http(s) leaves the site (GitHub, Vercel) so it gets a new tab; mailto: must not.
  const newTab = /^https?:/i.test(cta.href);
  return (
    <a
      href={cta.href}
      {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}
      className={className}
    >
      {content}
    </a>
  );
}

export default async function PricingPage() {
  // Same session-aware apex chrome as the landing page (see home/page.tsx for the
  // pv_signed_in / app-host rationale).
  const signedIn = Boolean((await cookies()).get(SIGNED_IN_FLAG));
  const host = (await headers()).get("host") ?? "papervine.io";
  const appBase = `${host.includes("localhost") ? "http" : "https"}://${appHostFor(host)}`;

  return (
    <PlatformShell variant="waves">
      {/* Header */}
      <header className="db-glass sticky top-0 z-30 border-b border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center">
            <Brand size="md" priority />
          </Link>
          <nav className="flex items-center gap-1 whitespace-nowrap text-sm">
            {/* Secondary links crowd the logo + primary CTA off a narrow phone screen —
                keep just the one thing that matters there; they return at sm:. */}
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
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-24 text-center sm:pt-28">
        <h1
          className="db-rise text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
          style={{ animationDelay: "0ms" }}
        >
          Pricing
        </h1>
        <p
          className="db-rise mx-auto mt-6 max-w-lg text-lg leading-relaxed text-[var(--muted)]"
          style={{ animationDelay: "80ms" }}
        >
          Create and publish beautiful product docs. Start for free, upgrade anytime.
        </p>
        <p
          className="db-rise mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.04)] px-4 py-2 text-sm text-[var(--fg)]"
          style={{ animationDelay: "140ms" }}
        >
          <Sparkles className="h-4 w-4 text-[var(--blue)]" />
          Every new account starts with a 30-day free trial of Pro — 10,000 AI credits, no
          card required.
        </p>
      </section>

      {/* Self-host band. Not one of the four hosted tiers — OSS, no account, its own two
          CTAs — so it gets a full-width row above the grid instead of a fifth column that
          would invite a $0-vs-$65 comparison on the wrong axis. */}
      {SELFHOST_TIER && (
        <section className="mx-auto max-w-7xl px-6 pb-5">
          <div
            className="db-rise rounded-3xl p-[1px]"
            style={{ animationDelay: "120ms", background: "var(--line)" }}
          >
            <div
              className="flex flex-col gap-6 rounded-3xl p-8 lg:flex-row lg:items-center lg:gap-10"
              style={{
                background: "linear-gradient(var(--card), var(--card)), var(--bg)",
              }}
            >
              <div className="lg:w-56 lg:shrink-0">
                <div className="flex items-center gap-2.5">
                  <SELFHOST_TIER.icon className="h-5 w-5 text-[var(--fg)]" />
                  <span className="text-lg font-semibold">{SELFHOST_TIER.name}</span>
                  {SELFHOST_TIER.badge && (
                    <span className="rounded-full border border-[rgba(var(--ink-rgb),0.12)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {SELFHOST_TIER.badge}
                    </span>
                  )}
                </div>
                <div className="mt-3 text-4xl font-semibold tracking-tight">
                  {SELFHOST_TIER.price}
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">{SELFHOST_TIER.blurb}</p>
              </div>

              <ul className="flex flex-1 flex-wrap gap-x-7 gap-y-3 text-sm">
                {SELFHOST_TIER.features.map((label) => (
                  <li key={label} className="flex items-center gap-2.5">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-[rgba(var(--ink-rgb),0.06)]">
                      <Check className="h-3.5 w-3.5 text-[var(--muted)]" />
                    </span>
                    {label}
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-2.5 sm:flex-row lg:shrink-0">
                <CtaLink
                  cta={SELFHOST_TIER.cta}
                  className="db-ring flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-[var(--fg)]"
                />
                {SELFHOST_TIER.secondaryCta && (
                  <CtaLink
                    cta={SELFHOST_TIER.secondaryCta}
                    className="flex items-center justify-center gap-2 rounded-full border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.04)] px-5 py-3 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tier cards — the four hosted plans */}
      <section className="mx-auto max-w-7xl px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {HOSTED_TIERS.map((tier, i) => {
            const Icon = tier.icon;
            const card = (
              <div
                className="flex h-full flex-col rounded-3xl p-8"
                // Opaque, theme-aware card face: the tint layer (--card) over the solid
                // page bg. Must stay opaque to mask the gradient frame behind it (the
                // frame is just p-[1px] of gradient showing at the edge). A hardcoded
                // dark hex here made the cards illegible in the light platform theme.
                style={{
                  background:
                    "linear-gradient(var(--card), var(--card)), var(--bg)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-5 w-5 text-[var(--fg)]" />
                    <span className="text-lg font-semibold">{tier.name}</span>
                  </div>
                  {tier.badge && (
                    <span className="db-cta rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
                      {tier.badge}
                    </span>
                  )}
                </div>

                <div className="mt-7">
                  <div className="text-4xl font-semibold tracking-tight">
                    {tier.price}
                    {tier.priceNote && (
                      <span className="ml-1 text-sm font-normal text-[var(--muted)]">
                        {tier.priceNote}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">{tier.blurb}</p>

                <div className="my-7 h-px bg-[rgba(var(--ink-rgb),0.06)]" />

                <ul className="flex flex-col gap-4 text-sm">
                  {tier.lead && (
                    <li className="flex items-center gap-3 font-medium">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--blue)]/15">
                        <Plus className="h-3.5 w-3.5 text-[var(--blue)]" />
                      </span>
                      {tier.lead}
                    </li>
                  )}
                  {tier.features.map((label) => (
                    <li key={label} className="flex items-center gap-3">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-[rgba(var(--ink-rgb),0.06)]">
                        <Check className="h-3.5 w-3.5 text-[var(--muted)]" />
                      </span>
                      {label}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex flex-col gap-2.5 pt-10">
                  <CtaLink
                    cta={tier.cta}
                    arrow={tier.highlight}
                    className={`flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium ${
                      tier.highlight ? "db-cta text-white" : "db-ring text-[var(--fg)]"
                    }`}
                  />
                  {tier.secondaryCta && (
                    <CtaLink
                      cta={tier.secondaryCta}
                      className="flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.04)] px-5 py-3 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
                    />
                  )}
                </div>
              </div>
            );

            // Pro gets the blue→violet gradient frame; the others a quiet ring.
            return tier.highlight ? (
              <div
                key={tier.name}
                className="db-rise rounded-3xl p-[1px]"
                style={{
                  animationDelay: `${160 + i * 80}ms`,
                  background:
                    "linear-gradient(150deg, rgba(140,140,255,0.55), rgba(255,255,255,0.05) 45%)",
                }}
              >
                {card}
              </div>
            ) : (
              <div
                key={tier.name}
                className="db-rise rounded-3xl p-[1px]"
                style={{
                  animationDelay: `${160 + i * 80}ms`,
                  background: "var(--line)",
                }}
              >
                {card}
              </div>
            );
          })}
        </div>
      </section>

      {/* Comparison matrix (shared with the in-app Billing settings surface). The
          per-tier CTAs are the marketing signup/contact links. */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <PlanMatrix
          renderCta={(key: PlanKey) => {
            if (key === "selfhost")
              return (
                <a
                  href={SELFHOST_TIER?.cta.href ?? "https://github.com/papervine/papervine"}
                  target="_blank"
                  rel="noreferrer"
                  className="db-ring rounded-full px-4 py-1.5 text-xs font-medium text-[var(--fg)]"
                >
                  GitHub
                </a>
              );
            if (key === "enterprise")
              return (
                <a
                  href={CONTACT}
                  className="db-ring rounded-full px-4 py-1.5 text-xs font-medium text-[var(--fg)]"
                >
                  Contact us
                </a>
              );
            const label = key === "free" ? "Get started" : "Start trial";
            return (
              <Link
                href="/signup"
                className={
                  key === "pro"
                    ? "db-cta rounded-full px-4 py-1.5 text-xs font-medium text-white"
                    : "db-ring rounded-full px-4 py-1.5 text-xs font-medium text-[var(--fg)]"
                }
              >
                {label}
              </Link>
            );
          }}
        />
      </section>

      {/* Footer */}
      <footer className="border-t border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--muted)] sm:flex-row">
          <span className="flex items-center gap-1.5">
            <Brand size="sm" />
          </span>
          <div className="flex flex-wrap justify-center gap-5">
            <Link href="/pricing" className="transition-colors hover:text-[var(--fg)]">
              Pricing
            </Link>
            {/* The comparison page is reached from here and from the landing page — an
                unlinked page is one search engines have no reason to crawl or trust. */}
            <Link
              href="/docs-platform-alternatives"
              className="transition-colors hover:text-[var(--fg)]"
            >
              Compare
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
