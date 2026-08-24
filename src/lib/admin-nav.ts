import {
  Building2,
  CreditCard,
  Globe,
  LayoutDashboard,
  Rocket,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  // "" is the index (Overview); everything else is a path segment under /admin.
  slug: string;
  label: string;
  icon: LucideIcon;
};
export type AdminNavSection = { heading: string; items: AdminNavItem[] };

// IA for the Operator console (SPEC §10.10). Everything used to live on one page: four stat
// cards followed by an unbounded stack of org cards, each inlining its members and sites. That
// reads fine with three customers and becomes unusable with thirty — and every query fetched
// EVERY row to build it. This is the list → detail split an admin console normally has, and it
// is the single source of truth for the subnav, the active-tab match, and route validation.
export const ADMIN_NAV: AdminNavSection[] = [
  {
    heading: "Platform",
    items: [
      { slug: "", label: "Overview", icon: LayoutDashboard },
      { slug: "orgs", label: "Organizations", icon: Building2 },
      { slug: "sites", label: "Sites", icon: Globe },
      { slug: "deploys", label: "Deploys", icon: Rocket },
    ],
  },
  {
    heading: "Commercial",
    items: [{ slug: "billing", label: "Billing", icon: CreditCard }],
  },
];

/** `/admin`, `/admin/orgs`, … — the index keeps the bare path rather than a trailing slash. */
export function adminHref(slug: string): string {
  return slug ? `/admin/${slug}` : "/admin";
}

/** Every slug the console answers on, for route validation. */
export const ADMIN_SLUGS: string[] = ADMIN_NAV.flatMap((s) => s.items.map((i) => i.slug));

/**
 * Which nav item a pathname belongs to. Detail routes (`/admin/orgs/{id}`) have to light up
 * their parent tab, so this is longest-prefix rather than equality — otherwise drilling into an
 * org would leave the whole nav looking unselected.
 */
export function activeAdminSlug(pathname: string): string | null {
  const rest = pathname.replace(/^\/admin\/?/, "").replace(/\/+$/, "");
  if (!pathname.startsWith("/admin")) return null;
  if (rest === "") return "";
  const head = rest.split("/")[0];
  return ADMIN_SLUGS.includes(head) ? head : null;
}
