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
  PLAN_TIERS,
  POSITIONING,
  CONTACT_HREF,
  type PlanKey,
} from "@/lib/billing/plan-content";
import { PlanMatrix } from "@/components/billing/PlanMatrix";

// Pricing for the SaaS apex (SPEC §2, §10 Billing). Uses the landing page chrome +
// `.db` design language, and positions against the docs-platform category's shape
// (free tier, then a ~$450+ jump, SSO held for enterprise) by filling the gap: a $29
// Team plan that already carries SSO/RBAC, a $99 Pro for production docs teams, and
// a 30-day everything trial on every account. BYOK is available from day one on all plans;
// hosted AI credits are optional add-ons, not the primary differentiator. Numbers mirror
// src/lib/billing/catalog.json — change them THERE (catalog is the source of truth;
// this page is marketing copy over it).
// Shared marketing metadata: canonical host, `og:`/`twitter:` tags and our X handle (see
// marketing-seo.ts). It also fixes the title, which the root layout's `%s · Papervine` template
// was turning into "Pricing — Papervine · Papervine". The card image is the sibling
// `opengraph-image.tsx`; unlike this description it carries no prices, so a reprice can't
// strand a stale image on timelines that already scraped it.
export const metadata: Metadata = marketingMetadata({
  title: "Pricing — Papervine",
  description:
    "Every new account starts with 30 days of everything + 5,000 AI credits. BYOK available from day one. Free for small docs sites; Team at $29/mo with SSO & RBAC; Pro at $99/mo for production docs; Enterprise for SCIM, SLAs, and migration.",
  path: "/pricing",
});

const GITHUB = "https://github.com/phishy/papervine";
const CONTACT = CONTACT_HREF;

// All plan copy — tier cards, feature bullets, comparison matrix, positioning — comes
// from the catalog (src/lib/billing/catalog.json → plan-content.ts), shared with the
// in-app Settings→Billing surface. This page adds only the marketing chrome.

export default async function PricingPage() {
  // Same session-aware apex chrome as the landing page (see home/page.tsx for the
  // pv_signed_in / app-host rationale).
  const signedIn = Boolean((await cookies()).get(SIGNED_IN_FLAG));
  const host = (await headers()).get("host") ?? "papervine.io";
  const appBase = `${host.includes("localhost") ? "http" : "https"}://${appHostFor(host)}`;

  return (
    <PlatformShell variant="full">
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
          Pricing on <span className="db-grad">your terms</span>
        </h1>
        <p
          className="db-rise mx-auto mt-6 max-w-lg text-lg leading-relaxed text-[var(--muted)]"
          style={{ animationDelay: "80ms" }}
        >
          Every feature, from day one. SSO from $29, not from a sales call.
        </p>
        <p
          className="db-rise mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(var(--ink-rgb),0.1)] bg-[rgba(var(--ink-rgb),0.04)] px-4 py-2 text-sm text-[var(--fg)]"
          style={{ animationDelay: "140ms" }}
        >
          <Sparkles className="h-4 w-4 text-[var(--blue)]" />
          Every new account starts with 30 days of everything + 5,000 AI credits — no card
          required. BYOK available from day one.
        </p>
      </section>

      {/* Tier cards */}
      <section className="mx-auto max-w-7xl px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_TIERS.map((tier, i) => {
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

                <div className="mt-auto pt-10">
                  {tier.highlight ? (
                    <Link
                      href={tier.cta.href}
                      className="db-cta flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-white"
                    >
                      {tier.cta.label}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <a
                      href={tier.cta.href}
                      className="db-ring flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-medium text-[var(--fg)]"
                    >
                      {tier.cta.label}
                    </a>
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

      {/* Positioning */}
      <section className="mx-auto max-w-6xl px-6 pt-16">
        <div className="grid gap-4 md:grid-cols-3">
          {POSITIONING.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] p-5"
            >
              <h2 className="text-sm font-semibold text-[var(--fg)]">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison matrix (shared with the in-app Billing settings surface). The
          per-tier CTAs are the marketing signup/contact links. */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <PlanMatrix
          renderCta={(key: PlanKey) => {
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
