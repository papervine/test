import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Rocket, Zap, Briefcase, Plus, Check, ArrowRight } from "lucide-react";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Brand } from "@/components/Brand";
import { appHostFor } from "@/lib/tenant-host";
import { SIGNED_IN_FLAG } from "@/lib/signed-in-flag";
import { ProPrice } from "./ProPrice";

// Pricing for the SaaS apex (SPEC §2). Uses the landing page chrome + `.db` design
// language, but positions Papervine against incumbent docs tools rather than cloning
// their package order: three tiers, a lower Pro anchor, Pro-level SSO/RBAC, and a
// full comparison matrix. SCIM and high-touch services stay Enterprise.
export const metadata: Metadata = {
  title: "Pricing — Papervine",
  description:
    "Simple docs pricing. Start free, move to Pro for agent docs, SSO, and RBAC, or choose Enterprise for SCIM, SLAs, and migration support.",
};

const GITHUB = "https://github.com/phishy/papervine";
const CONTACT = "mailto:support@papervine.io?subject=Papervine%20Enterprise";

// The 90-day SSO & RBAC launch promo, shown as a tag on the Pro card and as matrix
// cell notes. One constant so the copy can't drift between the two spots.
const PROMO_TAG = "Free for 90 days";

// A tier-card feature: plain string, or one carrying a promo tag pill.
type Feature = string | { label: string; tag: string };

// The top-of-page tier cards. `highlight` gives Pro the gradient frame.
const TIERS = [
  {
    icon: Rocket,
    name: "Starter",
    price: "$0",
    blurb: "For individuals and small teams",
    badge: null as string | null,
    highlight: false,
    cta: { label: "Get started", href: "/signup" },
    lead: null as string | null,
    features: [
      "Git-backed docs",
      "Search and analytics",
      "Visual + MDX editor",
      "Custom domains",
      "Authentication",
      "API playground",
      "MCP server",
    ] as Feature[],
  },
  {
    icon: Zap,
    name: "Pro",
    price: null as string | null, // rendered by <ProPrice/> (Monthly/Annual toggle)
    blurb: "For startups and growing teams",
    badge: "Popular",
    highlight: true,
    cta: { label: "Try for free", href: "/signup" },
    lead: "Everything in Starter",
    features: [
      { label: "SSO & RBAC", tag: PROMO_TAG },
      "AI assistant and writer",
      "External knowledge sources",
      "Preview deployments",
      "Workflow automations",
      "Admin APIs",
    ] as Feature[],
  },
  {
    icon: Briefcase,
    name: "Enterprise",
    price: "Contact us",
    blurb: "For scaling and global teams",
    badge: null as string | null,
    highlight: false,
    cta: { label: "Contact us", href: CONTACT },
    lead: "Everything in Pro",
    features: [
      "SCIM provisioning",
      "Security and legal review",
      "Advanced insights",
      "Performance SLA",
      "Migration services",
      "Dedicated support",
    ] as Feature[],
  },
];

// Pro's anchor pricing: annual is the default view, monthly the escape hatch. The
// annual price deliberately undercuts the $450/mo enterprise-lite anchor common in
// the docs-platform category while keeping room for infrastructure-heavy AI usage.
const PRO_PRICE = { monthly: 499, annual: 399 };

const POSITIONING = [
  {
    title: "Security before procurement",
    body: "SSO and role-based access belong in the plan growing teams can actually buy, not behind an enterprise negotiation.",
  },
  {
    title: "One product, not add-on sprawl",
    body: "Docs, API reference, reader auth, MCP, editor, and assistant workflows are packaged together instead of split across surprise modules.",
  },
  {
    title: "Open-source leverage",
    body: "Hosted Papervine is the managed path, but the renderer and control plane are built in the open so teams keep an exit path.",
  },
];

// Full comparison matrix. A cell is `true` (included), `false` (not included), a
// string (a qualifier shown inline), or `{ note }` (included, with a footnote —
// used for the 90-day SSO/RBAC promo). Grouped like the tier cards.
type Cell = boolean | string | { note: string };
const MATRIX: {
  group: string;
  rows: { label: string; starter: Cell; pro: Cell; enterprise: Cell }[];
}[] = [
  {
    group: "Features",
    rows: [
      { label: "Git sync", starter: true, pro: true, enterprise: true },
      { label: "Search", starter: true, pro: true, enterprise: true },
      { label: "Visual + MDX editor", starter: true, pro: true, enterprise: true },
      { label: "API playground", starter: true, pro: true, enterprise: true },
      { label: "Analytics", starter: true, pro: true, enterprise: true },
      { label: "User feedback", starter: true, pro: true, enterprise: true },
      { label: "Integrations", starter: true, pro: true, enterprise: true },
      { label: "Webhooks", starter: true, pro: true, enterprise: true },
      { label: "Websockets", starter: true, pro: true, enterprise: true },
      { label: "Developer API", starter: true, pro: true, enterprise: true },
      { label: "Admin APIs", starter: false, pro: true, enterprise: true },
      { label: "Agent analytics", starter: true, pro: true, enterprise: true },
      { label: "Advanced insights", starter: false, pro: false, enterprise: true },
      { label: "Multi-repo", starter: false, pro: false, enterprise: true },
      { label: "Enterprise file types", starter: false, pro: false, enterprise: true },
    ],
  },
  {
    group: "Agents",
    rows: [
      { label: "MCP server", starter: true, pro: true, enterprise: true },
      {
        label: "Credits",
        starter: "10,000 / month",
        pro: "Custom volume",
        enterprise: "Custom volume",
      },
      { label: "Assistant", starter: false, pro: true, enterprise: true },
      { label: "Writing agent", starter: false, pro: true, enterprise: true },
      { label: "External sources", starter: false, pro: true, enterprise: true },
      { label: "Workflows", starter: false, pro: true, enterprise: true },
      { label: "Support integrations", starter: false, pro: true, enterprise: true },
      { label: "Agent skills", starter: false, pro: true, enterprise: true },
    ],
  },
  {
    group: "Customization",
    rows: [
      { label: "Built-in components", starter: true, pro: true, enterprise: true },
      { label: "Custom components", starter: true, pro: true, enterprise: true },
      { label: "Custom CSS and JS", starter: true, pro: true, enterprise: true },
      { label: "White labeling", starter: true, pro: true, enterprise: true },
    ],
  },
  {
    group: "Publishing",
    rows: [
      { label: "Custom domain", starter: true, pro: true, enterprise: true },
      { label: "Preview deployments", starter: false, pro: true, enterprise: true },
      { label: "SEO optimizations", starter: true, pro: true, enterprise: true },
      { label: "Agent-readable output", starter: true, pro: true, enterprise: true },
      { label: "Generative answer optimization", starter: true, pro: true, enterprise: true },
      { label: "Grammar and spelling checks", starter: true, pro: true, enterprise: true },
    ],
  },
  {
    group: "Security",
    rows: [
      { label: "Authentication", starter: true, pro: true, enterprise: true },
      { label: "PDF export", starter: true, pro: true, enterprise: true },
      {
        label: "Role-based permissions",
        starter: false,
        pro: { note: PROMO_TAG },
        enterprise: true,
      },
      {
        label: "Dashboard SSO",
        starter: false,
        pro: { note: PROMO_TAG },
        enterprise: true,
      },
      { label: "SCIM", starter: false, pro: false, enterprise: true },
      { label: "Security review", starter: false, pro: false, enterprise: true },
      { label: "Legal review", starter: false, pro: false, enterprise: true },
      { label: "Custom SLAs", starter: false, pro: false, enterprise: true },
    ],
  },
  {
    group: "Services",
    rows: [
      { label: "Migration services", starter: false, pro: false, enterprise: true },
      { label: "Slack support", starter: false, pro: false, enterprise: true },
      { label: "Dedicated customer success", starter: false, pro: false, enterprise: true },
      { label: "24/7 incident monitoring", starter: false, pro: false, enterprise: true },
    ],
  },
];

// A matrix cell: ✓ for included, a quiet em dash for not, the qualifier text, or
// ✓ over a small footnote (the promo case).
function MatrixCell({ value }: { value: Cell }) {
  if (value === true)
    return (
      <span className="inline-flex">
        <Check className="h-4 w-4 text-[var(--blue)]" />
      </span>
    );
  if (value === false) return <span className="text-[var(--line)]">—</span>;
  if (typeof value === "string")
    return <span className="text-xs text-[var(--muted)]">{value}</span>;
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <Check className="h-4 w-4 text-[var(--blue)]" />
      <span className="text-[11px] leading-tight text-[var(--muted)]">{value.note}</span>
    </span>
  );
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
            <Brand size="md" priority />
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
          Start free. Upgrade when docs become a team workflow.
          <br />
          Pro includes SSO &amp; RBAC, free for your first 90 days.
        </p>
      </section>

      {/* Tier cards */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((tier, i) => {
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
                  {tier.price !== null ? (
                    <div className="text-4xl font-semibold tracking-tight">
                      {tier.price}
                    </div>
                  ) : (
                    <ProPrice monthly={PRO_PRICE.monthly} annual={PRO_PRICE.annual} />
                  )}
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
                  {tier.features.map((f) => {
                    const label = typeof f === "string" ? f : f.label;
                    const tag = typeof f === "string" ? null : f.tag;
                    return (
                      <li key={label} className="flex items-center gap-3">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-[rgba(var(--ink-rgb),0.06)]">
                          <Check className="h-3.5 w-3.5 text-[var(--muted)]" />
                        </span>
                        {label}
                        {tag && (
                          <span className="rounded-full bg-[var(--blue)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--blue)]">
                            {tag}
                          </span>
                        )}
                      </li>
                    );
                  })}
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

      {/* Comparison matrix */}
      <section className="mx-auto max-w-5xl px-6 py-28">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            {/* Sticky-ish tier header echoing the cards, so the columns stay legible. */}
            <thead>
              <tr>
                <th className="w-2/5" />
                <th className="px-3 pb-6 text-center align-bottom">
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[var(--fg)]">
                      <Rocket className="h-4 w-4" />
                      Starter
                    </span>
                    <Link
                      href="/signup"
                      className="db-ring rounded-full px-4 py-1.5 text-xs font-medium text-[var(--fg)]"
                    >
                      Get started
                    </Link>
                  </div>
                </th>
                <th className="px-3 pb-6 text-center align-bottom">
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[var(--fg)]">
                      <Zap className="h-4 w-4" />
                      Pro
                    </span>
                    <Link
                      href="/signup"
                      className="db-cta rounded-full px-4 py-1.5 text-xs font-medium text-white"
                    >
                      Try for free
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
                      colSpan={4}
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
                        <MatrixCell value={row.pro} />
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
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[rgba(var(--ink-rgb),0.06)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--muted)] sm:flex-row">
          <span className="flex items-center gap-1.5">
            <Brand size="sm" />
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
