"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { parseSitePath } from "@/lib/dashboard-nav";
import { SETTINGS_NAV, settingsHref } from "@/lib/settings-nav";

// The Settings subnav — a second sidebar beside the AppRail (SPEC §9 control plane).
// Grouped sections mirror hosted docs platforms' settings IA; the nav config lives in
// @/lib/settings-nav so routes and the rail stay in sync.
//
// Responsive: a vertical grouped sidebar on desktop (lg+), and a horizontally-scrollable
// strip of pills on mobile (the grouping headings are dropped — a single swipeable row is
// the legible shape on a phone, where a 16-item vertical list would push content offscreen).
export function SettingsNav() {
  const pathname = usePathname();
  // The settings routes are URL-scoped (/:org/:site/settings/…), so the org +
  // site come straight off the path — the subnav is the same for every site.
  // Always set here — the subnav only renders under a settings route (/:org/:site/settings).
  const { orgSlug = "", siteSlug = "" } = parseSitePath(pathname);

  return (
    <>
      {/* Mobile: horizontal scroll strip of pills (flattened, no headings). */}
      <nav className="db-glass sticky top-14 z-20 flex gap-2 overflow-x-auto border-b border-[rgba(var(--ink-rgb),0.06)] px-4 py-2.5 lg:hidden">
        {SETTINGS_NAV.flatMap((section) => section.items).map(
          ({ slug, label, icon: Icon }) => {
            const href = settingsHref(orgSlug, siteSlug, slug);
            const active = pathname === href;
            return (
              <Link
                key={slug}
                href={href}
                // Full prefetch (not Next's default partial, which skips a dynamic route's RSC
                // data) so the tab's payload is in the Router Cache before the click; paired
                // with experimental.staleTimes.dynamic (next.config) it's reused on navigation,
                // making sibling-tab switches an instant 0-network client render (SPEC perf).
                prefetch={true}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-transparent bg-[rgba(var(--ink-rgb),0.08)] text-[var(--fg)]"
                    : "border-[rgba(var(--ink-rgb),0.07)] text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active ? "text-[var(--blue)]" : ""}`}
                />
                {label}
              </Link>
            );
          },
        )}
      </nav>

      {/* Desktop: vertical grouped sidebar. */}
      <nav className="db-glass hidden w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-[rgba(var(--ink-rgb),0.06)] px-3 py-6 lg:flex">
        {SETTINGS_NAV.map((section) => (
          <div key={section.heading} className="flex flex-col gap-0.5">
            <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]/60">
              {section.heading}
            </h3>
            {section.items.map(({ slug, label, icon: Icon }) => {
              const href = settingsHref(orgSlug, siteSlug, slug);
              const active = pathname === href;
              return (
                <Link
                  key={slug}
                  href={href}
                  prefetch={true} // see the mobile strip above — full prefetch + staleTimes reuse
                  className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-[rgba(var(--ink-rgb),0.06)] text-[var(--fg)]"
                      : "text-[var(--muted)] hover:bg-[rgba(var(--ink-rgb),0.04)] hover:text-[var(--fg)]"
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
    </>
  );
}
