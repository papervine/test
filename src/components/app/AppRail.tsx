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
import { SiteSwitcher } from "./SiteSwitcher";

type RailItem = {
  href?: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
};

// Grouped rail IA, mirroring the incumbent's sidebar: a lead group, an "Automate" section
// (Workflows · Agent · Assistant — SPEC §10.2), then an "Admin" section header
// (MCP + Settings). Deferred surfaces (Editor) render disabled with a "Soon" pill;
// the Automate surfaces are scaffolded UI only — they navigate but nothing they show
// is wired up yet.
const NAV_SECTIONS: { heading?: string; items: RailItem[] }[] = [
  {
    items: [
      { href: "/dashboard", label: "Home", icon: Home },
      { label: "Editor", icon: FileEdit, soon: true },
      { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    heading: "Automate",
    items: [
      {
        href: "/dashboard/automate/workflows",
        label: "Workflows",
        icon: Workflow,
      },
      {
        href: "/dashboard/automate/agent",
        label: "Agent",
        icon: Bot,
      },
      {
        href: "/dashboard/automate/assistant",
        label: "Assistant",
        icon: MessageCircle,
      },
    ],
  },
  {
    heading: "Admin",
    items: [
      { href: "/dashboard/mcp", label: "MCP", icon: Plug },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppRail({
  sites,
  activeSlug,
  userName,
}: {
  sites: { slug: string; name: string }[];
  activeSlug: string | null;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <aside className="db-glass flex w-60 shrink-0 flex-col border-r border-white/[0.06] px-3 py-4">
      <SiteSwitcher sites={sites} activeSlug={activeSlug} />

      <nav className="flex flex-col gap-4">
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.heading ?? i} className="flex flex-col gap-1">
            {section.heading && (
              <h3 className="px-2 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]/60">
                {section.heading}
              </h3>
            )}
            {section.items.map(({ href, label, icon: Icon, soon }) => {
              if (soon || !href) {
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
              // "/dashboard" is exact-only (else it'd match every sub-route); the rest also
              // light up on their sub-routes (e.g. Settings on /dashboard/settings/domain).
              const active =
                href === "/dashboard"
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
