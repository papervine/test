// Editing `docs.json` by PATH, for the Site settings drawer (SPEC §9.2).
//
// The drawer is one long form over a config file, so every control needs the same two operations:
// read the value at `["colors", "primary"]`, and write it back. Doing that with a bespoke server
// action per field would be sixty near-identical actions; doing it with a path is one — and the
// interesting part (what "clearing a field" means in a config file, and not trampling keys we don't
// model) is pure, so it lives here with tests rather than inside a React component.
//
// Two rules the whole drawer depends on:
//
//  1. **Clearing a field REMOVES the key**, it doesn't write `""` or `null`. `docs.json` is read by
//     other tools too, and `"logo": ""` is a broken logo where an absent `logo` is simply no logo.
//     Emptying the last field of an object removes that object as well, so a cleared Branding
//     section leaves no `{}` behind.
//  2. **Everything else is preserved.** These helpers copy objects on the way down and never touch
//     a sibling key — a config carrying blocks this renderer doesn't model (an `api`, a `redirects`,
//     an `integrations`) must come back byte-for-byte identical apart from the edited path. That's
//     the same passthrough promise the config parser itself makes (warn, don't throw, keep unknown
//     keys), applied to writing.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the value at a path, or undefined if any step is missing (or isn't an object). */
export function getAtPath(config: unknown, path: readonly string[]): unknown {
  let node: unknown = config;
  for (const key of path) {
    if (!isObj(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Return a copy of `config` with `value` at `path`. Missing intermediate objects are created.
 *
 * `undefined` (or `""`, which is what an emptied text input actually produces) DELETES the key, and
 * prunes any ancestor object left empty by that deletion — see rule 1 above. `false` and `0` are
 * real values and are written as-is.
 */
export function setAtPath(config: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const base: Obj = isObj(config) ? { ...config } : {};
  const [key, ...rest] = path;

  if (rest.length === 0) {
    if (value === undefined || value === "") delete base[key];
    else base[key] = value;
    return base;
  }

  const child = setAtPath(base[key], rest, value);
  // Pruning: an object that lost its last key goes with it, so clearing every Branding field
  // doesn't leave `"logo": {}` in the file.
  if (isObj(child) && Object.keys(child).length === 0) delete base[key];
  else base[key] = child;
  return base;
}

/** Delete the key at a path (and prune emptied ancestors). Sugar for `setAtPath(…, undefined)`. */
export function deleteAtPath(config: unknown, path: readonly string[]): unknown {
  return setAtPath(config, path, undefined);
}

/**
 * `logo` and `favicon` are each EITHER a string or `{ light, dark }` (the config parser accepts
 * both — GAP-REPORT §1.1). The drawer shows two fields, so writing one of them has to decide what
 * shape the file should end up in:
 *
 *  - both values, and different → the object form
 *  - one value, or both the same → the plain string, because that's what a hand-written
 *    `docs.json` says and round-tripping a one-logo site into `{light, dark}` with identical
 *    values is noise in someone's diff
 *  - neither → the key is removed
 *
 * `href` (the logo's link target) only exists in the object form, so supplying it forces that shape.
 */
export function logoValue(input: {
  light?: string;
  dark?: string;
  href?: string;
}): unknown {
  const light = input.light?.trim() || undefined;
  const dark = input.dark?.trim() || undefined;
  const href = input.href?.trim() || undefined;
  if (!light && !dark) return href ? { href } : undefined;
  if (!href && (light === dark || !dark || !light)) return light ?? dark;
  return { ...(light ? { light } : {}), ...(dark ? { dark } : {}), ...(href ? { href } : {}) };
}

/**
 * Counts for the drawer's Navigation section: how many tabs, groups and pages the nav declares.
 *
 * The drawer doesn't edit the nav — that's the editor's tree, with drag-and-drop and page creation
 * — so it says what's there and sends you to the tree. Counting has to be structural rather than
 * shape-specific, because `navigation` legitimately arrives as tabs, or groups, or a bare `pages`
 * list, or wrapped in `languages`/`versions`/`dropdowns`/`anchors`; this walks for the marker keys
 * instead of assuming one layout.
 */
export function summarizeNavigation(nav: unknown): { tabs: number; groups: number; pages: number } {
  let tabs = 0;
  let groups = 0;
  let pages = 0;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        // A bare string inside a `pages` array IS a page; anything else recurses.
        if (typeof child === "string") pages += 1;
        else walk(child);
      }
      return;
    }
    if (!isObj(node)) return;
    if (typeof node.tab === "string") tabs += 1;
    if (typeof node.group === "string") groups += 1;
    for (const value of Object.values(node)) walk(value);
  };

  walk(nav);
  return { tabs, groups, pages };
}

/** The light/dark pair a `logo`/`favicon` value represents, whichever shape it's in. */
export function logoParts(value: unknown): { light: string; dark: string; href: string } {
  if (typeof value === "string") return { light: value, dark: value, href: "" };
  if (isObj(value)) {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return { light: str(value.light), dark: str(value.dark), href: str(value.href) };
  }
  return { light: "", dark: "", href: "" };
}
