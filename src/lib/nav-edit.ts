// Pure docs.json navigation mutations, for the nav tree's "+" menu (SPEC §9.2). Kept out of
// the server actions so they're unit-testable without a DB: the actions do
// read docs.json → call one of these → saveDraft, exactly like saveGroupSettingsAction.
//
// docs.json's navigation is a nest of container arrays — `pages`, `groups`, `anchors`,
// `dropdowns`, plus the `languages`/`versions`/`tabs` wrappers — and a real repo can put a
// group at any depth. So every helper here WALKS to find its target rather than assuming a
// shape, matching how `findGroupNode`/`removeGroupNode` already work and how the renderer's
// nav.ts descends (CONTAINER_KEYS).

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The navigation root: docs.json may nest under `navigation`, or BE the navigation object. */
export function navRoot(config: unknown): unknown {
  if (isObj(config) && "navigation" in config) return config.navigation;
  return config;
}

/** Depth-first search for the group object named `name`. */
export function findGroup(node: unknown, name: string): Obj | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findGroup(child, name);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(node)) return null;
  if (node.group === name) return node;
  for (const value of Object.values(node)) {
    const hit = findGroup(value, name);
    if (hit) return hit;
  }
  return null;
}

/** Every page slug referenced anywhere in the navigation, in document order. */
export function navPageSlugs(config: unknown): string[] {
  const out: string[] = [];
  // A string is a page slug ONLY inside a `pages` array. Collecting every string in the tree
  // instead swept up the labels — `group: "Get Started"`, `tab: "Guides"`, `anchor: "API"` —
  // and "Add existing page" would then offer group names as pages.
  const walk = (node: unknown, inPages: boolean) => {
    if (typeof node === "string") {
      if (inPages) out.push(node.replace(/^\//, ""));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, inPages);
      return;
    }
    if (!isObj(node)) return;
    for (const [key, value] of Object.entries(node)) {
      // `href` on an anchor/dropdown is a link, not a page slug.
      if (key === "href") continue;
      // A `pages` array may itself hold nested group objects; descending into those under any
      // other key resets the flag, so their labels aren't collected either.
      walk(value, key === "pages");
    }
  };
  walk(navRoot(config), false);
  // De-dupe, keeping first occurrence.
  return [...new Set(out)];
}

/**
 * One spelling for a page, for comparing across the two conventions that disagree about the
 * index page: `listPageSlugs()` reports it as `""` (its route is `/`), while docs.json writes
 * it as `"index"` and buildNav gives it the href `/index`. Comparing the raw strings made the
 * index page look absent from its own navigation — "Add existing page" then offered it as a row
 * with no label, which on a site whose only other pages were already listed rendered as an
 * apparently empty submenu.
 */
export function canonicalSlug(slug: string): string {
  const clean = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  return clean === "" ? "index" : clean;
}

/**
 * Page files that the navigation doesn't reference — what "Add existing page" offers.
 * `navHrefs` are leaf hrefs as buildNav emits them ("/guides/intro"); `pageSlugs` are as
 * listPageSlugs emits them (""/"guides/intro"). Returns canonical slugs, so every entry has a
 * label and can be written straight into docs.json.
 */
export function unlistedPageSlugs(pageSlugs: string[], navHrefs: string[]): string[] {
  const listed = new Set(navHrefs.map(canonicalSlug));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pageSlugs) {
    const slug = canonicalSlug(raw);
    if (listed.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/**
 * Add `slug` to a group's `pages`. Creates the array if the group has none (a group with only
 * nested `groups` is legal). Returns false if the group isn't found, or if the slug is already
 * there — a no-op is reported rather than silently writing a duplicate nav entry.
 */
export function addPageToGroup(config: unknown, group: string, slug: string): boolean {
  const node = findGroup(navRoot(config), group);
  if (!node) return false;
  // Canonical on both sides: adding the index page must write "index", not the "" that
  // listPageSlugs reports it as — an empty nav entry resolves to nothing.
  const clean = canonicalSlug(slug);
  if (!Array.isArray(node.pages)) node.pages = [];
  const pages = node.pages as unknown[];
  const already = pages.some((p) => typeof p === "string" && canonicalSlug(p) === clean);
  if (already) return false;
  pages.push(clean);
  return true;
}

/**
 * Add an empty group. With `parent`, nests it under that group's `groups`; without, appends to
 * the navigation's top-level group list. Returns false if the parent is missing or a group of
 * that name already exists (names are the addressing key for every other nav action here —
 * `findGroup` would resolve to whichever came first, so duplicates are refused).
 */
export function addGroup(config: unknown, name: string, parent?: string): boolean {
  const root = navRoot(config);
  if (findGroup(root, name)) return false;
  const fresh = { group: name, pages: [] as unknown[] };

  if (parent) {
    const parentNode = findGroup(root, parent);
    if (!parentNode) return false;
    if (!Array.isArray(parentNode.groups)) parentNode.groups = [];
    (parentNode.groups as unknown[]).push(fresh);
    return true;
  }

  // Top level. Prefer an existing `groups` array; then the first tab's; else create one.
  if (isObj(root)) {
    if (Array.isArray(root.groups)) {
      (root.groups as unknown[]).push(fresh);
      return true;
    }
    if (Array.isArray(root.tabs) && root.tabs.length) {
      const tab = root.tabs[0];
      if (isObj(tab)) {
        if (!Array.isArray(tab.groups)) tab.groups = [];
        (tab.groups as unknown[]).push(fresh);
        return true;
      }
    }
    root.groups = [fresh];
    return true;
  }
  if (Array.isArray(root)) {
    root.push(fresh);
    return true;
  }
  return false;
}

// Root keys that hold navigation content. When a tab-less site gains its first tab, ALL of these
// have to move into it — buildNav takes the `tabs` branch or the top-level branch, never both.
const ROOT_CONTAINERS = ["groups", "pages", "anchors", "dropdowns"];

/** The name given to the implicit first tab when converting a tab-less navigation. */
export const IMPLICIT_TAB_NAME = "Documentation";

/**
 * Add a tab. Two very different cases, because `tabs` and top-level `groups` are alternative
 * structures rather than siblings (confirmed against the docs.json JSON Schema, and buildNav
 * takes one branch or the other):
 *
 *  - Already tabbed → append `{ tab, groups: [] }`.
 *  - Not yet tabbed → CONVERT: the existing top-level containers move into a first tab (named
 *    `IMPLICIT_TAB_NAME`) and the new tab is appended after it. Without the move, adding a tab
 *    would make every existing group vanish from the site — buildNav would stop reading the root.
 *
 * Returns false on a duplicate tab name. Report `converted` so the UI can say what happened
 * rather than silently restructuring someone's navigation.
 */
export function addTab(config: unknown, name: string): { ok: boolean; converted: boolean } {
  const root = navRoot(config);
  if (!isObj(root)) return { ok: false, converted: false };

  const fresh = { tab: name, groups: [] as unknown[] };

  if (Array.isArray(root.tabs)) {
    const tabs = root.tabs as unknown[];
    const clash = tabs.some((t) => isObj(t) && t.tab === name);
    if (clash) return { ok: false, converted: false };
    tabs.push(fresh);
    return { ok: true, converted: false };
  }

  const present = ROOT_CONTAINERS.filter((key) => root[key] !== undefined);

  if (present.length === 0) {
    // Nothing to preserve — the new tab is simply the first one.
    root.tabs = [fresh];
    return { ok: true, converted: false };
  }

  // Refuse BEFORE moving anything: converting and then bailing would leave the navigation
  // gutted (containers deleted, no tabs written).
  if (name === IMPLICIT_TAB_NAME) return { ok: false, converted: false };

  const moved: Obj = {};
  for (const key of present) {
    moved[key] = root[key];
    delete root[key];
  }
  root.tabs = [{ tab: IMPLICIT_TAB_NAME, ...moved }, fresh];
  return { ok: true, converted: true };
}

/**
 * Move a page entry within the navigation — reorder inside its group, or move it to another one.
 *
 * Addressed POSITIONALLY (group + index), not by slug: the same page may legitimately appear in
 * more than one group, and drag-and-drop knows exactly which row was picked up. Resolving by slug
 * would move an arbitrary one of them.
 *
 * The entry is spliced out and re-inserted, so whatever it is survives the trip — a bare slug
 * string, or an object entry (an OpenAPI selector, a page with its own `href`). Reading it as a
 * string would silently destroy the object forms.
 */
export function movePage(
  config: unknown,
  from: { group: string; index: number },
  to: { group: string; index: number },
): boolean {
  const root = navRoot(config);
  const src = findGroup(root, from.group);
  const dst = findGroup(root, to.group);
  if (!src || !dst) return false;
  if (!Array.isArray(src.pages)) return false;

  const srcPages = src.pages as unknown[];
  if (from.index < 0 || from.index >= srcPages.length) return false;

  const [entry] = srcPages.splice(from.index, 1);

  if (!Array.isArray(dst.pages)) dst.pages = [];
  const dstPages = dst.pages as unknown[];
  // Clamp: the drop index is computed from the pre-removal list, so a downward move within the
  // same group can point one past the end after the splice.
  const at = Math.max(0, Math.min(to.index, dstPages.length));
  dstPages.splice(at, 0, entry);
  return true;
}

/**
 * Reorder a group among its siblings. Re-parenting is deliberately NOT supported here — dropping
 * a group into another group is a different gesture from sliding it up and down a list, and
 * conflating them makes an accidental nest very easy. `addGroup(..., parent)` covers deliberate
 * nesting.
 */
export function reorderGroup(config: unknown, group: string, toIndex: number): boolean {
  const siblings = findGroupSiblings(navRoot(config), group);
  if (!siblings) return false;
  const i = siblings.findIndex((g) => isObj(g) && g.group === group);
  if (i < 0) return false;
  const [entry] = siblings.splice(i, 1);
  const at = Math.max(0, Math.min(toIndex, siblings.length));
  siblings.splice(at, 0, entry);
  return true;
}

/** The array that directly contains the named group, so it can be reordered in place. */
function findGroupSiblings(node: unknown, name: string): unknown[] | null {
  if (Array.isArray(node)) {
    if (node.some((c) => isObj(c) && c.group === name)) return node;
    for (const child of node) {
      const hit = findGroupSiblings(child, name);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(node)) return null;
  for (const value of Object.values(node)) {
    const hit = findGroupSiblings(value, name);
    if (hit) return hit;
  }
  return null;
}

/**
 * A slug for a new page titled `title`, unique against `taken`. Separate from `slugify` in
 * src/lib/slug.ts: that one is for tenant/site slugs and its collision suffix is random, which
 * would put a random string in a URL an author has to live with. Here a numeric suffix is
 * predictable ("overview", "overview-2").
 */
export function newPageSlug(title: string, taken: Iterable<string>, prefix = ""): string {
  const base =
    title
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled";
  const used = new Set([...taken].map((s) => s.replace(/^\//, "")));
  const at = (n: number) => {
    const stem = n === 1 ? base : `${base}-${n}`;
    return prefix ? `${prefix.replace(/\/+$/, "")}/${stem}` : stem;
  };
  let n = 1;
  while (used.has(at(n))) n += 1;
  return at(n);
}

/** Frontmatter-only starter body for a newly created page. */
export function newPageContent(title: string): string {
  // JSON-quote the title: a title containing `:` or a quote would otherwise emit invalid YAML
  // and the page would fail to parse on its very first render.
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}
