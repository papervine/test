import {
  Globe,
  Lock,
  Puzzle,
  Settings2,
  Search,
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

export type SettingsNavItem = { slug: string; label: string; icon: LucideIcon };
export type SettingsNavSection = { heading: string; items: SettingsNavItem[] };

// Canonical IA for the Settings subnav (mirrors the incumbent's settings surfaces). This is
// the single source of truth: the subnav, the route validation, and the index redirect
// all read from it. Content for each surface is scaffolded later — for now every slug
// resolves to a placeholder page (see settings/[section]/page.tsx).
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    heading: "Site settings",
    items: [
      { slug: "domain", label: "Domain setup", icon: Globe },
      { slug: "authentication", label: "Authentication", icon: Lock },
      { slug: "add-ons", label: "Add-ons", icon: Puzzle },
      { slug: "general", label: "General", icon: Settings2 },
      { slug: "search", label: "Search", icon: Search },
    ],
  },
  {
    heading: "Deployment",
    items: [{ slug: "git", label: "Git settings", icon: GitBranch }],
  },
  {
    heading: "Security & access",
    items: [{ slug: "api-keys", label: "API keys", icon: KeyRound }],
  },
  {
    heading: "Workspace",
    items: [
      { slug: "members", label: "Members", icon: Users },
      { slug: "billing", label: "Billing", icon: Receipt },
      { slug: "usage", label: "Usage", icon: LineChart },
      { slug: "notifications", label: "Notifications", icon: Mail },
      { slug: "agent-integrations", label: "Agent integrations", icon: Blocks },
      { slug: "profile", label: "My profile", icon: UserCog },
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

export const SETTINGS_BASE = "/dashboard/settings";

export function settingsHref(slug: string): string {
  return `${SETTINGS_BASE}/${slug}`;
}

// Flat, ordered slug list — validates [section] routes and seeds the index redirect.
export const SETTINGS_SLUGS = SETTINGS_NAV.flatMap((s) =>
  s.items.map((i) => i.slug),
);

// "Domain setup" is the landing surface — /dashboard/settings redirects here.
export const FIRST_SETTINGS_SLUG = SETTINGS_SLUGS[0];

export function settingsLabel(slug: string): string | undefined {
  for (const section of SETTINGS_NAV)
    for (const item of section.items)
      if (item.slug === slug) return item.label;
  return undefined;
}
