"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_NAV, settingsHref } from "@/lib/settings-nav";

// The Settings subnav — a second sidebar beside the AppRail (SPEC §9 control plane).
// Grouped sections mirror the incumbent's settings IA; the nav config lives in
// @/lib/settings-nav so routes and the rail stay in sync.
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="db-glass flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/[0.06] px-3 py-6">
      {SETTINGS_NAV.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]/60">
            {section.heading}
          </h3>
          {section.items.map(({ slug, label, icon: Icon }) => {
            const href = settingsHref(slug);
            const active = pathname === href;
            return (
              <Link
                key={slug}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/[0.06] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--fg)]"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-[var(--blue)]" : ""}`}
                />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
