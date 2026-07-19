import {
  Code2,
  Globe,
  Link2,
  MessageSquare,
  MessageSquareText,
  ScrollText,
  Search,
  Settings2,
  Sparkles,
  SpellCheck,
  type LucideIcon,
} from "lucide-react";

// Catalog-key → icon, client-safe (server components can't pass component functions
// across the boundary, so cards look icons up here by key).
const ICONS: Record<string, LucideIcon> = {
  "update-from-code-changes": Code2,
  "draft-changelog": ScrollText,
  "fill-gaps-from-assistant-conversations": MessageSquare,
  "improve-docs-from-user-feedback": MessageSquareText,
  "translate-content": Globe,
  "fix-broken-links": Link2,
  "fix-seo-issues": Search,
  "fix-grammar-typos": SpellCheck,
  "enforce-style-guide": Sparkles,
};

export function automationIcon(catalogKey: string): LucideIcon {
  return ICONS[catalogKey] ?? Settings2;
}
