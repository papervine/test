"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  BarChart3,
  Settings,
  FileEdit,
  Plug,
  Workflow,
  Bot,
  MessageCircle,
  Menu,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { canSeeFeature, type FeatureKey } from "@/lib/features";
import { parseSitePath, pickCurrentSite, siteHref } from "@/lib/dashboard-nav";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/platform/ThemeToggle";
import { SiteSwitcher, SiteMark } from "./SiteSwitcher";

type RailItem = {
  // Path under the active site (/:org/:site/<sub>); "" is the site home. Absent on
  // disabled "soon" items, which render inert.
  sub?: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  // When set, the item only renders for roles that can see this feature
  // (src/lib/features.ts). Absent → visible to everyone.
  feature?: FeatureKey;
  // Heavy routes (expensive per-request RSC render) opt OUT of the full prefetch below, so we
  // don't fire that work for every rail item on every dashboard page. They keep Next's default
  // (lighter) prefetch and fetch on navigation. Analytics runs time-series aggregation queries.
  heavy?: boolean;
  // Plan-gated AI surfaces (SPEC §10 Billing): during the org's 30-day trial these
  // carry a "Trialing" pill so it's clear the access comes from the trial, not the plan.
  trialBadge?: boolean;
};

// Grouped rail IA, mirroring hosted docs platforms' sidebar: a lead group, an "Automate" section
// (Workflows · Agent · Assistant — SPEC §10.2), then an "Admin" section header
// (MCP + Settings). Deferred surfaces (Editor) render disabled with a "Soon" pill;
// the Automate surfaces are scaffolded UI only — they navigate but nothing they show
// is wired up yet. Hrefs are built per-site from the URL (SPEC §10), so the items hold
// only the sub-path.
const NAV_SECTIONS: { heading?: string; items: RailItem[] }[] = [
  {
    items: [
      { sub: "", label: "Home", icon: Home },
      { sub: "editor", label: "Editor", icon: FileEdit, feature: "editor.workspace" },
      { sub: "analytics", label: "Analytics", icon: BarChart3, heavy: true },
    ],
  },
  {
    heading: "Automate",
    items: [
      {
        sub: "automate/workflows",
        label: "Workflows",
        icon: Workflow,
        feature: "automate.workflows",
        trialBadge: true,
      },
      {
        sub: "automate/agent",
        label: "Agent",
        icon: Bot,
        feature: "automate.agent",
        trialBadge: true,
      },
      {
        sub: "automate/assistant",
        label: "Assistant",
        icon: MessageCircle,
        feature: "automate.assistant",
        trialBadge: true,
      },
    ],
  },
  {
    heading: "Admin",
    items: [
      { sub: "mcp", label: "MCP", icon: Plug },
      { sub: "settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppRail({
  orgSlug,
  sites,
  userName,
  role,
  trialing = false,
  platformAdmin = false,
}: {
  orgSlug: string;
  sites: { slug: string; name: string }[];
  userName: string;
  role: string | null;
  // The org is inside its live 30-day trial — trial-gated items get a "Trialing" pill.
  // Cosmetic: the real gate is authorizeAi on the API routes.
  trialing?: boolean;
  // Platform-operator allowlist (SPEC §10.10) — shows the /admin link. Cosmetic only:
  // the real gate is requirePlatformAdmin on the page.
  platformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Mobile-only: the rail collapses behind a hamburger into a slide-in Sheet drawer.
  const [navOpen, setNavOpen] = useState(false);

  // The active site comes from the URL: /:org/:site/… — the site segment if
  // it's a real site (it's "connect" on the org-level page, which falls back to first).
  const current = pickCurrentSite(sites, parseSitePath(pathname).siteSlug);

  async function handleSignOut() {
    await signOut();
    // The marketing "signed in" hint is httpOnly, so it's cleared server-side: this nav to
    // /login is an app-host request, and the middleware clears the flag when it sees no
    // session cookie (more robust than a client clear, which can't touch httpOnly).
    router.push("/login");
  }

  // Drop feature-gated items the viewer can't see, then drop any section left empty
  // (so an admin-only section's heading vanishes too for non-admins).
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.feature || canSeeFeature(item.feature, role),
    ),
  })).filter((section) => section.items.length > 0);

  // The rail's contents — shared verbatim by the desktop sidebar and the mobile drawer.
  // `onNavigate` (mobile only) closes the drawer when the user picks a destination; the
  // nav items get larger touch targets on mobile (py-2.5) that collapse to py-1.5 on lg+.
  const railBody = (onNavigate?: () => void) => (
    <>
      <SiteSwitcher
        orgSlug={orgSlug}
        sites={sites}
        activeSlug={current?.slug ?? null}
        onNavigate={onNavigate}
      />

      {/* Scrollable middle (site switcher pinned above, profile pinned below): the nav
          scrolls internally so the profile/sign-out stay visible without scrolling even
          when the nav is tall. -mx-3/px-3 keeps the scrollbar at the rail's edge. */}
      <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3">
      {/* The nav is per-site; with no site yet the switcher's New-site affordance is the
          only thing to show. */}
      {current && (
        <nav className="flex flex-col gap-4">
          {sections.map((section, i) => (
            <div key={section.heading ?? i} className="flex flex-col gap-1">
              {section.heading && (
                <h3 className="px-2 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]/60">
                  {section.heading}
                </h3>
              )}
              {section.items.map(({ sub, label, icon: Icon, soon, heavy, trialBadge }) => {
                if (soon || sub === undefined) {
                  return (
                    <span
                      key={label}
                      className="flex items-center gap-2 rounded-md px-2 py-2.5 text-sm text-[var(--muted)]/60 lg:py-1.5"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      <span className="ml-auto rounded bg-[rgba(var(--ink-rgb),0.06)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                        Soon
                      </span>
                    </span>
                  );
                }
                const href = siteHref(orgSlug, current.slug, sub);
                // Home (sub "") is exact-only (else it'd match every sub-route); the rest
                // also light up on their sub-routes (e.g. Settings on …/settings/domain).
                const active =
                  sub === ""
                    ? pathname === href
                    : pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    // Full prefetch on the light rail items so their RSC is in the Router Cache
                    // before the click; paired with experimental.staleTimes.dynamic it makes nav
                    // an instant 0-network client render (SPEC §10.x). Heavy routes (Analytics)
                    // keep Next's default partial prefetch — see the `heavy` flag above.
                    prefetch={heavy ? undefined : true}
                    className={`flex items-center gap-2 rounded-md px-2 py-2.5 text-sm transition-colors lg:py-1.5 ${
                      active
                        ? "bg-[rgba(var(--ink-rgb),0.06)] text-[var(--fg)]"
                        : "text-[var(--muted)] hover:bg-[rgba(var(--ink-rgb),0.04)] hover:text-[var(--fg)]"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${active ? "text-[var(--blue)]" : ""}`}
                    />
                    {label}
                    {trialing && trialBadge && (
                      <span
                        className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500"
                        title="Included in your 30-day trial — pick a plan to keep it"
                      >
                        Trialing
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      )}

      {/* Billing + Usage live under Settings → Workspace (SPEC §10 Billing) — the
          settings IA is where the org's plan and credits belong, so there's no
          standalone rail item. */}

      {platformAdmin && (
        <Link
          href="/admin"
          onClick={onNavigate}
          className="mt-4 flex items-center gap-2 rounded-md px-2 py-2.5 text-sm text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.04)] hover:text-[var(--fg)] lg:py-1.5"
        >
          <ShieldCheck className="h-4 w-4" />
          Platform Admin
        </Link>
      )}
      </div>

      {/* Pinned to the bottom of the (viewport-height) rail — always visible, no scroll. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[rgba(var(--ink-rgb),0.06)] px-2 pt-4 text-sm">
        <span className="truncate text-[var(--muted)]">{userName}</span>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <button
            onClick={() => {
              onNavigate?.();
              handleSignOut();
            }}
            className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: a fixed-width sidebar (lg+). Hidden on mobile, where the drawer takes over. */}
      <aside className="db-glass sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[rgba(var(--ink-rgb),0.06)] px-3 py-4 lg:flex">
        {railBody()}
      </aside>

      {/* Mobile: a sticky top bar with a hamburger that opens the rail in a slide-in drawer. */}
      <header className="db-glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[rgba(var(--ink-rgb),0.06)] px-4 lg:hidden">
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-1.5 text-[var(--fg)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)]"
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" showClose={false} className="gap-0 px-3 py-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {railBody(() => setNavOpen(false))}
          </SheetContent>
        </Sheet>
        {current && (
          <div className="flex min-w-0 items-center gap-2">
            <SiteMark name={current.name} colorKey={current.slug} />
            <span className="truncate text-sm font-medium">{current.name}</span>
          </div>
        )}
      </header>
    </>
  );
}
