import "server-only";
import type { DocsConfig } from "./config";
import { loadPage } from "./content";

/** Serializable nav tree handed to the client Sidebar. */
export type NavLeaf = { title: string; href: string };
export type NavNode = { group: string; items: (NavLeaf | NavNode)[] };
export type NavSection = { tab?: string; nodes: (NavLeaf | NavNode)[] };

type Division = Record<string, unknown>;

function titleFromSlug(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Resolve a page slug to a sidebar leaf, honoring sidebarTitle and hidden. Null = omit. */
async function resolveLeaf(slug: string): Promise<NavLeaf | null> {
  const page = await loadPage(slug);
  if (page?.frontmatter.hidden) return null;
  return {
    title: page?.frontmatter.sidebarTitle ?? page?.frontmatter.title ?? titleFromSlug(slug),
    href: "/" + slug,
  };
}

// Container keys whose values hold further pages/divisions, and label keys that
// name a division. Walking these generically covers the incumbent's whole recursive
// navigation surface (languages → versions → tabs → anchors/dropdowns → groups
// → pages) without enumerating every combination — GAP-REPORT §1.2.
const CONTAINER_KEYS = ["pages", "groups", "anchors", "dropdowns"];
const LABEL_KEYS = ["group", "anchor", "dropdown"];

function labelOf(div: Division): string | undefined {
  for (const k of LABEL_KEYS) {
    if (typeof div[k] === "string") return div[k] as string;
  }
  return undefined;
}

/** Collect the child nav items of a division (its root + container arrays). */
async function collectChildren(div: Division): Promise<(NavLeaf | NavNode)[]> {
  const out: (NavLeaf | NavNode)[] = [];
  if (typeof div.root === "string") {
    const leaf = await resolveLeaf(div.root);
    if (leaf) out.push(leaf);
  }
  for (const key of CONTAINER_KEYS) {
    const value = div[key];
    if (Array.isArray(value)) {
      for (const item of value) out.push(...(await collectItem(item)));
    }
  }
  return out;
}

/** Turn a single nav entry (slug string or division object) into nav items. */
async function collectItem(item: unknown): Promise<(NavLeaf | NavNode)[]> {
  if (typeof item === "string") {
    const leaf = await resolveLeaf(item);
    return leaf ? [leaf] : [];
  }
  if (item && typeof item === "object") {
    const div = item as Division;
    const children = await collectChildren(div);
    const label = labelOf(div);
    if (label) return [{ group: label, items: children }];
    return children; // unlabeled wrapper — splice children up a level
  }
  return [];
}

/**
 * Build the sidebar from docs.json. Unwraps the default language/version (M1
 * renders one; a switcher comes later), then renders tabs as sections.
 */
export async function buildNav(config: DocsConfig): Promise<NavSection[]> {
  let nav = config.navigation as Division;

  // Descend through localization/version wrappers to the default (first) entry.
  for (const wrapper of ["languages", "versions"]) {
    const arr = nav[wrapper];
    if (Array.isArray(arr) && arr.length && arr[0] && typeof arr[0] === "object") {
      nav = arr[0] as Division;
    }
  }

  const sections: NavSection[] = [];

  if (Array.isArray(nav.tabs) && nav.tabs.length) {
    for (const tab of nav.tabs as Division[]) {
      sections.push({
        tab: typeof tab.tab === "string" ? tab.tab : undefined,
        nodes: await collectChildren(tab),
      });
    }
  } else {
    sections.push({ nodes: await collectChildren(nav) });
  }

  return sections;
}
