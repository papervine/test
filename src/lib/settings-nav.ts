import {
  Globe,
  Lock,
  Puzzle,
  Settings2,
  Search,
  MessageSquareCode,
  GitBranch,
  KeyRound,
  Users,
  Receipt,
  LineChart,
  Mail,
  Blocks,
  UserCog,
  FileOutput,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { siteHref } from "@/lib/dashboard-nav";

export type SettingsNavItem = {
  slug: string;
  label: string;
  icon: LucideIcon;
  // TEMPORARY: hide from everyone but the platform operator (PLATFORM_ADMIN_EMAILS).
  // These are scaffolded/unwired — pull the flag once each one is real.
  operatorOnly?: boolean;
};
export type SettingsNavSection = { heading: string; items: SettingsNavItem[] };

// Canonical IA for the Settings subnav (mirrors hosted docs platforms' settings surfaces). This is
// the single source of truth: the subnav, the route validation, and the index redirect
// all read from it. Content for each surface is scaffolded later — for now every slug
// resolves to a placeholder page (see settings/[section]/page.tsx).
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    heading: "Site settings",
    items: [
      { slug: "domain", label: "Domain setup", icon: Globe },
      { slug: "authentication", label: "Authentication", icon: Lock },
      { slug: "add-ons", label: "Add-ons", icon: Puzzle, operatorOnly: true },
      { slug: "general", label: "General", icon: Settings2 },
      { slug: "search", label: "Search", icon: Search, operatorOnly: true },
      { slug: "widget", label: "Widget", icon: MessageSquareCode },
    ],
  },
  {
    heading: "Deployment",
    items: [{ slug: "git", label: "Git settings", icon: GitBranch }],
  },
  {
    heading: "Security & access",
    items: [{ slug: "api-keys", label: "API keys", icon: KeyRound, operatorOnly: true }],
  },
  {
    heading: "Workspace",
    items: [
      { slug: "members", label: "Members", icon: Users },
      { slug: "billing", label: "Billing", icon: Receipt },
      { slug: "usage", label: "Usage", icon: LineChart },
      { slug: "notifications", label: "Notifications", icon: Mail, operatorOnly: true },
      { slug: "agent-integrations", label: "Agent integrations", icon: Blocks, operatorOnly: true },
      { slug: "profile", label: "My profile", icon: UserCog, operatorOnly: true },
    ],
  },
  {
    heading: "Advanced",
    items: [
      { slug: "exports", label: "Exports", icon: FileOutput },
      { slug: "danger", label: "Danger zone", icon: AlertTriangle },
    ],
  },
];

// Settings lives under the URL-scoped site (SPEC §10): the public bare path
// /:org/:site/settings/:slug. Delegates to siteHref so the one place that knows the path
// shape stays dashboard-nav.
export function settingsHref(
  orgSlug: string,
  siteSlug: string,
  slug: string,
): string {
  return siteHref(orgSlug, siteSlug, `settings/${slug}`);
}

// Flat, ordered slug list — validates [section] routes and seeds the index redirect.
export const SETTINGS_SLUGS = SETTINGS_NAV.flatMap((s) =>
  s.items.map((i) => i.slug),
);

// "Domain setup" is the landing surface — bare …/settings redirects here.
export const FIRST_SETTINGS_SLUG = SETTINGS_SLUGS[0];

export function settingsLabel(slug: string): string | undefined {
  for (const section of SETTINGS_NAV)
    for (const item of section.items)
      if (item.slug === slug) return item.label;
  return undefined;
}
