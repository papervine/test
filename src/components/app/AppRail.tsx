"use client";

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
  type LucideIcon,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { canSeeFeature, type FeatureKey } from "@/lib/features";
import { parseSitePath, pickCurrentSite, siteHref } from "@/lib/dashboard-nav";
import { SiteSwitcher } from "./SiteSwitcher";

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
};

// Grouped rail IA, mirroring the incumbent's sidebar: a lead group, an "Automate" section
// (Workflows · Agent · Assistant — SPEC §10.2), then an "Admin" section header
// (MCP + Settings). Deferred surfaces (Editor) render disabled with a "Soon" pill;
// the Automate surfaces are scaffolded UI only — they navigate but nothing they show
// is wired up yet. Hrefs are built per-site from the URL (SPEC §10), so the items hold
// only the sub-path.
const NAV_SECTIONS: { heading?: string; items: RailItem[] }[] = [
  {
    items: [
      { sub: "", label: "Home", icon: Home },
      { label: "Editor", icon: FileEdit, soon: true },
      { sub: "analytics", label: "Analytics", icon: BarChart3 },
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
      },
      {
        sub: "automate/agent",
        label: "Agent",
        icon: Bot,
        feature: "automate.agent",
      },
      {
        sub: "automate/assistant",
        label: "Assistant",
        icon: MessageCircle,
        feature: "automate.assistant",
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
}: {
  orgSlug: string;
  sites: { slug: string; name: string }[];
  userName: string;
  role: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // The active site comes from the URL: /:org/:site/… — the site segment if
  // it's a real site (it's "connect" on the org-level page, which falls back to first).
  const current = pickCurrentSite(sites, parseSitePath(pathname).siteSlug);

  async function handleSignOut() {
    await signOut();
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

  return (
    <aside className="db-glass flex w-60 shrink-0 flex-col border-r border-white/[0.06] px-3 py-4">
      <SiteSwitcher
        orgSlug={orgSlug}
        sites={sites}
        activeSlug={current?.slug ?? null}
      />

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
              {section.items.map(({ sub, label, icon: Icon, soon }) => {
                if (soon || sub === undefined) {
                  return (
                    <span
                      key={label}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--muted)]/60"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
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
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-white/[0.06] text-[var(--fg)]"
                        : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--fg)]"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${active ? "text-[var(--blue)]" : ""}`}
                    />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      )}

      <div className="mt-auto flex items-center justify-between px-2 pt-4 text-sm">
        <span className="truncate text-[var(--muted)]">{userName}</span>
        <button
          onClick={handleSignOut}
          className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
