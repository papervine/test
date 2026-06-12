"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { switchSiteHref } from "@/lib/dashboard-nav";
import { siteMarkGradient } from "@/lib/site-mark";

type SiteOption = { slug: string; name: string };

// The top-left site switcher (SPEC §10): shows the active site, lists the org's sites to
// switch between (scoping the per-site pages — Analytics, Editor…), and offers "New site".
// Sites are URL-scoped (/:org/:site), so selecting one *navigates* — preserving the
// sub-page you're on — instead of writing a cookie.
export function SiteSwitcher({
  orgSlug,
  sites,
  activeSlug,
}: {
  orgSlug: string;
  sites: SiteOption[];
  activeSlug: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a plain dropdown, no portal needed at this size.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = sites.find((s) => s.slug === activeSlug) ?? sites[0] ?? null;

  function select(slug: string) {
    setOpen(false);
    if (slug === active?.slug) return;
    startTransition(() => {
      router.push(switchSiteHref(orgSlug, slug, pathname, sites));
    });
  }

  // No sites yet — the switcher is just the New-site affordance.
  if (!active) {
    return (
      <Link
        href={`/${orgSlug}/connect`}
        className="db-cta mb-3 flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-white"
      >
        <Plus className="h-4 w-4" />
        New site
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative mb-3" data-pending={pending ? "" : undefined}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch site"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <SiteMark name={active.name} colorKey={active.slug} />
        <span className="truncate text-sm font-medium">{active.name}</span>
        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>

      {open && (
        <div
          role="listbox"
          className="db-glass absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-white/[0.08] p-1 shadow-xl shadow-black/40"
        >
          {sites.map((s) => {
            const isActive = s.slug === active.slug;
            return (
              <button
                key={s.slug}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => select(s.slug)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.06]"
              >
                <SiteMark name={s.name} colorKey={s.slug} />
                <span className="truncate">{s.name}</span>
                {isActive && <Check className="ml-auto h-4 w-4 shrink-0 text-[var(--blue)]" />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-white/[0.06]" />

          <Link
            href={`/${orgSlug}/connect`}
            onClick={() => setOpen(false)}
            className="db-cta flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            New site
          </Link>
        </div>
      )}
    </div>
  );
}

// The small gradient square with the site's initial — mirrors the incumbent's switcher mark.
// The gradient is derived per-site from `colorKey` (the slug) so a list of sites reads as
// distinct colored chips instead of identical blue→violet squares (see lib/site-mark).
function SiteMark({ name, colorKey }: { name: string; colorKey: string }) {
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-bold text-white"
      style={{ background: siteMarkGradient(colorKey) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
