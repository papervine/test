"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ADMIN_NAV, activeAdminSlug, adminHref } from "@/lib/admin-nav";

// Subnav for the Operator console (SPEC §10.10). Deliberately the same two-mode shape as
// SettingsNav — a horizontal pill strip on mobile, a grouped sidebar on desktop — so the console
// reads as part of the product rather than a separate admin skin.
//
// The active item comes from `activeAdminSlug`, which is longest-prefix rather than equality:
// a detail route (/admin/orgs/{id}) has to keep Organizations lit.
export function AdminNav() {
  const pathname = usePathname();
  const active = activeAdminSlug(pathname);
  const flat = ADMIN_NAV.flatMap((s) => s.items);

  return (
    <>
      {/* Mobile: flattened pills, no headings. */}
      <nav className="db-glass sticky top-14 z-20 flex gap-2 overflow-x-auto border-b border-[rgba(var(--ink-rgb),0.06)] px-4 py-2.5 lg:hidden">
        {flat.map(({ slug, label, icon: Icon }) => (
          <Link
            key={slug || "index"}
            href={adminHref(slug)}
            prefetch={true}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active === slug
                ? "border-transparent bg-[rgba(var(--ink-rgb),0.08)] text-[var(--fg)]"
                : "border-[rgba(var(--ink-rgb),0.07)] text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${active === slug ? "text-[var(--blue)]" : ""}`} />
            {label}
          </Link>
        ))}
      </nav>

      {/* Desktop: grouped sidebar. */}
      <nav className="db-glass hidden w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-[rgba(var(--ink-rgb),0.06)] px-3 py-6 lg:flex">
        <Link
          href="/"
          className="mx-2 mb-1 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        {ADMIN_NAV.map((section) => (
          <div key={section.heading} className="flex flex-col gap-0.5">
            <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]/60">
              {section.heading}
            </h3>
            {section.items.map(({ slug, label, icon: Icon }) => (
              <Link
                key={slug || "index"}
                href={adminHref(slug)}
                prefetch={true}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                  active === slug
                    ? "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:bg-[rgba(var(--ink-rgb),0.04)] hover:text-[var(--fg)]"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${active === slug ? "text-[var(--blue)]" : ""}`}
                />
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
