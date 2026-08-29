import { icons } from "lucide-react";

// The icon vocabulary a `<Card icon="…">` (or any other `icon` attr) is written in.
//
// `LucideIcon` resolves an icon name by title-casing it — "circle-check" → CircleCheck — so the
// names authors write are the KEBAB forms of Lucide's exports. This module is that list, derived
// from the library itself rather than copied: a hand-kept list drifts the moment lucide-react is
// upgraded, and a name that no longer exists renders nothing at all (LucideIcon returns null for
// an unknown name, by design — an unknown icon must never break a page).
//
// No extra bundle weight: the same `icons` object is already imported by `LucideIcon`, which the
// editor renders on every page.

/** `CircleCheck` → `circle-check`; the form written into MDX and read back by `LucideIcon`. */
export function toKebabIcon(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Every icon name, kebab-cased and sorted — roughly 1,500 of them. */
export const ICON_NAMES: string[] = Object.keys(icons).map(toKebabIcon).sort();

/**
 * Icon names matching `query`, capped at `limit`.
 *
 * Capped because the grid renders a real component per result: painting the whole library at once
 * is thousands of SVGs on one popover, and nobody scrolls 1,500 icons anyway — they type. A
 * prefix match sorts ahead of a substring one so "check" leads with `check`, not `book-check`.
 */
export function filterIcons(query: string, limit = 120): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return ICON_NAMES.slice(0, limit);
  const prefix: string[] = [];
  const rest: string[] = [];
  for (const name of ICON_NAMES) {
    if (name.startsWith(q)) prefix.push(name);
    else if (name.includes(q)) rest.push(name);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...rest].slice(0, limit);
}
