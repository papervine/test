"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, BarChart3, Settings, FileEdit } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { SiteSwitcher } from "./SiteSwitcher";

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

// Deferred incumbent surfaces (SPEC §15 non-goals / later) — shown disabled so the
// IA matches the product target without pretending these work yet.
const SOON = [{ label: "Editor", icon: FileEdit }];

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

      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
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
        {SOON.map(({ label, icon: Icon }) => (
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
