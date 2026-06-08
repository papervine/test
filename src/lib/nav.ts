import "server-only";
import type { DocsConfig } from "./config";
import { loadPage } from "./content";
import { apiOperations } from "./openapi";

/** Serializable nav tree handed to the client Sidebar. */
export type NavLeaf = { title: string; href: string };
export type NavNode = { group: string; icon?: string; items: (NavLeaf | NavNode)[] };
export type NavSection = {
  tab?: string;
  href?: string; // landing page for the tab (its first leaf) — what the tab links to
  hrefs: string[]; // every leaf href under this tab — used to detect the active tab
  nodes: (NavLeaf | NavNode)[];
};

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

const OP_SELECTOR = /^(get|post|put|patch|delete|head|options)\s+\//i;

/**
 * A division with an `openapi` property auto-generates a leaf per operation
 * (incumbent model). `pages`, if present, selects/orders endpoints by "METHOD /path"
 * (other strings are treated as normal page slugs, so manual pages can mix in).
 */
async function openapiLeaves(div: Division): Promise<(NavLeaf | NavNode)[]> {
  const specPath = div.openapi as string;
  const ops = await apiOperations(specPath);
  const bySelector = new Map(ops.map((op) => [`${op.method} ${op.path}`, op]));
  const leafFor = (op: (typeof ops)[number]): NavLeaf => ({
    title: op.summary ?? `${op.method} ${op.path}`,
    href: "/" + op.slug,
  });

  if (!Array.isArray(div.pages)) return ops.map(leafFor);

  const out: (NavLeaf | NavNode)[] = [];
  for (const entry of div.pages) {
    if (typeof entry === "string" && OP_SELECTOR.test(entry)) {
      const [method, path] = entry.split(/\s+/);
      const op = bySelector.get(`${method.toUpperCase()} ${path}`);
      if (op) out.push(leafFor(op));
    } else {
      out.push(...(await collectItem(entry)));
    }
  }
  return out;
}

/** Collect the child nav items of a division (its root + container arrays). */
async function collectChildren(div: Division): Promise<(NavLeaf | NavNode)[]> {
  const out: (NavLeaf | NavNode)[] = [];
  if (typeof div.root === "string") {
    const leaf = await resolveLeaf(div.root);
    if (leaf) out.push(leaf);
  }
  if (typeof div.openapi === "string") {
    out.push(...(await openapiLeaves(div)));
    return out; // openapi division: `pages` are operation selectors, handled above
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
    if (label) {
      const icon = typeof div.icon === "string" ? div.icon : undefined;
      return [{ group: label, icon, items: children }];
    }
    return children; // unlabeled wrapper — splice children up a level
  }
  return [];
}

/** Flatten a node tree to every leaf href it contains. */
function collectHrefs(nodes: (NavLeaf | NavNode)[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if ("href" in node) out.push(node.href);
    else out.push(...collectHrefs(node.items));
  }
  return out;
}

/**
 * The label of the deepest group containing `href` — the incumbent shows this as an
 * "eyebrow" above the page title (e.g. "Introduction" over "Pixwel Platform").
 */
export function findGroupLabel(sections: NavSection[], href: string): string | undefined {
  let found: string | undefined;
  function walk(nodes: (NavLeaf | NavNode)[], group: string | undefined) {
    for (const node of nodes) {
      if ("href" in node) {
        if (node.href === href) found = group;
      } else {
        walk(node.items, node.group);
      }
    }
  }
  for (const section of sections) walk(section.nodes, undefined);
  return found;
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
      const nodes = await collectChildren(tab);
      const hrefs = collectHrefs(nodes);
      sections.push({
        tab: typeof tab.tab === "string" ? tab.tab : undefined,
        href: hrefs[0],
        hrefs,
        nodes,
      });
    }
  } else {
    const nodes = await collectChildren(nav);
    sections.push({ hrefs: collectHrefs(nodes), nodes });
  }

  return sections;
}
