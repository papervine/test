"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { switchSiteHref } from "@/lib/dashboard-nav";
import { siteMarkGradient } from "@/lib/site-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SiteOption = { slug: string; name: string };

// The top-left site switcher (SPEC §10): shows the active site, lists the org's sites to
// switch between (scoping the per-site pages — Analytics, Editor…), and offers "New site".
// Sites are URL-scoped (/:org/:site), so selecting one *navigates* — preserving the
// sub-page you're on — instead of writing a cookie. Built on the shadcn DropdownMenu
// (Radix) so keyboard nav / outside-click / Escape / portal positioning come for free.
export function SiteSwitcher({
  orgSlug,
  sites,
  activeSlug,
  onNavigate,
}: {
  orgSlug: string;
  sites: SiteOption[];
  activeSlug: string | null;
  // Called after a navigation choice (switch site / New site) so a host that renders the
  // switcher inside the mobile nav drawer can close it.
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const active = sites.find((s) => s.slug === activeSlug) ?? sites[0] ?? null;

  function select(slug: string) {
    if (slug === active?.slug) return;
    onNavigate?.();
    startTransition(() => {
      router.push(switchSiteHref(orgSlug, slug, pathname, sites));
    });
  }

  // No sites yet — the switcher is just the New-site affordance.
  if (!active) {
    return (
      <Link
        href={`/${orgSlug}/connect`}
        onClick={() => onNavigate?.()}
        className="db-cta mb-3 flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-white"
      >
        <Plus className="h-4 w-4" />
        New site
      </Link>
    );
  }

  return (
    <div className="mb-3" data-pending={pending ? "" : undefined}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch site"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-[rgba(var(--ink-rgb),0.04)] focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <SiteMark name={active.name} colorKey={active.slug} />
          <span className="truncate text-sm font-medium">{active.name}</span>
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-[var(--muted)]" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)]"
        >
          {sites.map((s) => {
            const isActive = s.slug === active.slug;
            return (
              <DropdownMenuItem
                key={s.slug}
                onSelect={() => select(s.slug)}
                aria-selected={isActive}
              >
                <SiteMark name={s.name} colorKey={s.slug} />
                <span className="truncate">{s.name}</span>
                {isActive && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-[var(--blue)]" />
                )}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild className="p-0 focus:bg-transparent">
            <Link
              href={`/${orgSlug}/connect`}
              onClick={() => onNavigate?.()}
              className="db-cta flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              New site
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// The small gradient square with the site's initial — mirrors the incumbent's switcher mark.
// The gradient is derived per-site from `colorKey` (the slug) so a list of sites reads as
// distinct colored chips instead of identical blue→violet squares (see lib/site-mark).
export function SiteMark({ name, colorKey }: { name: string; colorKey: string }) {
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-bold text-white"
      style={{ background: siteMarkGradient(colorKey) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
