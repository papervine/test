import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Rocket, Briefcase, Plus, Check, ArrowRight } from "lucide-react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Wordmark } from "@/components/Wordmark";
import { appHostFor } from "@/lib/tenant-host";
import { SIGNED_IN_FLAG } from "@/lib/signed-in-flag";

// Pricing for the SaaS apex (SPEC §2). Mirrors the landing page's chrome + `.db`
// design language: two tiers (a free Starter and a Contact-us Enterprise) over a
// full feature-comparison matrix. The brand stays blue→violet (platform.css is the
// single source of truth for the palette — we don't introduce a one-off accent here).
export const metadata: Metadata = {
  title: "Pricing — Papervine",
  description:
    "Pricing on your terms. Get started for free with a 14-day trial — no credit card required. Free for individuals and small teams; Enterprise for scaling and global teams.",
};

const GITHUB = "https://github.com/phishy/papervine";
const CONTACT = "mailto:support@papervine.io?subject=Papervine%20Enterprise";

// The two top-of-page tier cards. `highlight` gives Starter the gradient frame.
const TIERS = [
  {
    icon: Rocket,
    name: "Starter",
    price: "$0",
    blurb: "For individuals and small teams",
    badge: "Popular",
    highlight: true,
    cta: { label: "Get started", href: "/signup" },
    lead: null as string | null,
    features: [
      "Full platform",
      "Custom domain",
      "Web editor",
      "Authentication",
      "Assistant",
      "Writing agent",
      "Workflows",
      "MCP server",
    ],
  },
  {
    icon: Briefcase,
    name: "Enterprise",
    price: "Contact us",
    blurb: "For scaling and global teams",
    badge: null as string | null,
    highlight: false,
    cta: { label: "Contact us", href: CONTACT },
    lead: "Everything in Starter",
    features: [
      "Role-based permissions",
      "Performance SLA",
      "SSO",
      "Agent analytics",
      "Advanced insights",
      "Enterprise security & legal",
      "Migration & support",
    ],
  },
];

// Full comparison matrix. A cell is `true` (included), `false` (not included), or a
// string (a qualifier shown inline). Grouped exactly like the screenshot.
type Cell = boolean | string;
const MATRIX: { group: string; rows: { label: string; starter: Cell; enterprise: Cell }[] }[] = [
  {
    group: "Features",
    rows: [
      { label: "Web editor", starter: true, enterprise: true },
      { label: "API playground", starter: true, enterprise: true },
      { label: "Git sync", starter: true, enterprise: true },
      { label: "Search", starter: true, enterprise: true },
      { label: "Integrations", starter: true, enterprise: true },
      { label: "Webhooks", starter: true, enterprise: true },
      { label: "Websockets", starter: true, enterprise: true },
      { label: "Developer API", starter: true, enterprise: true },
      { label: "Analytics", starter: true, enterprise: true },
      { label: "User feedback", starter: true, enterprise: true },
      { label: "Agent analytics", starter: false, enterprise: true },
      { label: "Advanced insights", starter: false, enterprise: true },
      { label: "Agent feedback", starter: false, enterprise: true },
      { label: "Enterprise file types", starter: false, enterprise: true },
    ],
  },
  {
    group: "Agents",
    rows: [
      { label: "MCP server", starter: true, enterprise: true },
      { label: "Credits", starter: "5,000 to trial", enterprise: "5,000 included" },
      { label: "Assistant", starter: true, enterprise: true },
      { label: "Writing agent", starter: true, enterprise: true },
      { label: "Support integrations", starter: true, enterprise: true },
      { label: "Agent skills", starter: true, enterprise: true },
      { label: "Workflows", starter: true, enterprise: true },
      { label: "External sources", starter: false, enterprise: true },
    ],
  },
  {
    group: "Customization",
    rows: [
      { label: "Built-in components", starter: true, enterprise: true },
      { label: "Custom components", starter: true, enterprise: true },
      { label: "Custom CSS and JS", starter: true, enterprise: true },
      { label: "White labeling", starter: false, enterprise: true },
    ],
  },
  {
    group: "Publishing",
    rows: [
      { label: "Custom domain", starter: true, enterprise: true },
      { label: "SEO optimizations", starter: true, enterprise: true },
      { label: "GEO optimizations", starter: true, enterprise: true },
      { label: "Agent optimizations", starter: true, enterprise: true },
      { label: "Preview deployments", starter: true, enterprise: true },
      { label: "Grammar and spelling checks", starter: true, enterprise: true },
    ],
  },
  {
    group: "Security",
    rows: [
      { label: "Authentication", starter: true, enterprise: true },
      { label: "PDF export", starter: false, enterprise: true },
      { label: "Role-based permissions", starter: false, enterprise: true },
      { label: "Dashboard SSO", starter: false, enterprise: true },
      { label: "Security review", starter: false, enterprise: true },
      { label: "Legal review", starter: false, enterprise: true },
      { label: "Custom SLAs", starter: false, enterprise: true },
    ],
  },
  {
    group: "Services",
    rows: [
      { label: "Migration services", starter: false, enterprise: true },
      { label: "Slack support", starter: false, enterprise: true },
      { label: "Dedicated customer success", starter: false, enterprise: true },
      { label: "24/7 incident monitoring", starter: false, enterprise: true },
    ],
  },
];

// A matrix cell: ✓ for included, a quiet em dash for not, or the qualifier text.
function MatrixCell({ value }: { value: Cell }) {
  if (value === true)
    return (
      <span className="inline-flex">
        <Check className="h-4 w-4 text-[var(--blue)]" />
      </span>
    );
  if (value === false) return <span className="text-[var(--line)]">—</span>;
  return <span className="text-xs text-[var(--muted)]">{value}</span>;
}

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
            <Wordmark className="text-lg" />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/pricing"
              className="rounded-lg px-3 py-1.5 text-[var(--fg)] transition-colors"
            >
              Pricing
            </Link>
            <a
              href={GITHUB}
              className="rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
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
                  className="rounded-lg px-3 py-1.5 text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
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
          className="db-rise mx-auto mt-6 max-w-md text-lg leading-relaxed text-[var(--muted)]"
          style={{ animationDelay: "80ms" }}
        >
          Get started for free with a 14-day trial.
          <br />
          No credit card required.
        </p>
      </section>

      {/* Tier cards */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {TIERS.map((tier, i) => {
            const Icon = tier.icon;
            const card = (
              <div className="flex h-full flex-col rounded-3xl bg-[#0b0b13] p-8">
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

                <div className="mt-7 text-4xl font-semibold tracking-tight">
                  {tier.price}
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
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-[rgba(var(--ink-rgb),0.06)]">
                        <Check className="h-3.5 w-3.5 text-[var(--muted)]" />
                      </span>
                      {f}
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

            // Starter gets the blue→violet gradient frame; Enterprise a quiet ring.
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

      {/* Comparison matrix */}
      <section className="mx-auto max-w-4xl px-6 py-28">
        <table className="w-full border-collapse text-sm">
          {/* Sticky-ish tier header echoing the cards, so the columns stay legible. */}
          <thead>
            <tr>
              <th className="w-1/2" />
              <th className="px-3 pb-6 text-center align-bottom">
                <div className="flex flex-col items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[var(--fg)]">
                    <Rocket className="h-4 w-4" />
                    Starter
                  </span>
                  <Link
                    href="/signup"
                    className="db-cta rounded-full px-4 py-1.5 text-xs font-medium text-white"
                  >
                    Get started
                  </Link>
                </div>
              </th>
              <th className="px-3 pb-6 text-center align-bottom">
                <div className="flex flex-col items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[var(--fg)]">
                    <Briefcase className="h-4 w-4" />
                    Enterprise
                  </span>
                  <a
                    href={CONTACT}
                    className="db-ring rounded-full px-4 py-1.5 text-xs font-medium text-[var(--fg)]"
                  >
                    Contact us
                  </a>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map(({ group, rows }) => (
              <Fragment key={group}>
                <tr>
                  <td
                    colSpan={3}
                    className="pb-3 pt-10 text-sm font-semibold text-[var(--fg)]"
                  >
                    {group}
                  </td>
                </tr>
                {rows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-t border-[rgba(var(--ink-rgb),0.06)]"
                  >
                    <td className="py-3 pr-3 text-[var(--muted)]">
                      {row.label}
                    </td>
                    <td className="py-3 text-center">
                      <MatrixCell value={row.starter} />
                    </td>
                    <td className="py-3 text-center">
                      <MatrixCell value={row.enterprise} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {/* Footer */}
      <footer className="border-t border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--muted)] sm:flex-row">
          <span className="flex items-center gap-1.5">
            <Wordmark className="text-sm" />
            <span>— open source</span>
          </span>
          <div className="flex gap-5">
            <Link href="/pricing" className="transition-colors hover:text-[var(--fg)]">
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
