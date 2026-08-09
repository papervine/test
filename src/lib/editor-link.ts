/**
 * Where a link inside the Visual editor should go (SPEC §9.2).
 *
 * The editor is a control-plane surface on the **app host**, so a docs link like `/quickstart`
 * must never be followed as written: it resolves against `app.papervine.io`, which 404s and
 * throws away the editing session. Every link click is classified here first, and the editor
 * acts on the verdict — an in-site page loads in the editor, an external URL opens in a new tab,
 * a link to a page that doesn't exist is reported as the broken link it is.
 *
 * Pure and DOM-free so it can be unit-tested (tests/unit/editor-link.test.ts); the click
 * plumbing lives in VisualEditor.
 */
export type EditorLinkTarget =
  | { kind: "page"; slug: string }
  | { kind: "external"; href: string }
  /** A bare `#hash` — the same page, and the editor has nothing to scroll to. */
  | { kind: "anchor" }
  /** An in-site path with no such page — a broken link in the docs. */
  | { kind: "missing"; path: string };

// `https:`, `mailto:`, `tel:`, … — anything with a URL scheme leaves the site.
const SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/** Collapse `.` / `..` / empty segments of a slash-joined path. */
function normalizeSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Classify one `href` from the edited page.
 *
 * @param currentSlug the slug of the page being edited — relative links resolve against its folder
 * @param slugs every page slug in the site (the root page's slug is `""`, see `listPageSlugs`)
 */
export function resolveEditorLink(
  href: string,
  currentSlug: string,
  slugs: readonly string[],
): EditorLinkTarget {
  const raw = href.trim();
  if (raw === "" || raw.startsWith("#")) return { kind: "anchor" };
  // `//cdn.example.com/x` is protocol-relative, not a site path.
  if (raw.startsWith("//") || SCHEME.test(raw)) return { kind: "external", href: raw };

  const path = raw.split(/[?#]/)[0];
  if (path === "") return { kind: "anchor" }; // e.g. `?tab=cli` — same page

  const base = path.startsWith("/") ? "" : currentSlug.split("/").slice(0, -1).join("/");
  // Links occasionally carry the file extension (`./setup.mdx`); slugs never do.
  const resolved = normalizeSegments(`${base}/${path}`).replace(/\.mdx?$/, "");
  // The root page is slug `""`, so `/` and `/index` both mean it.
  const slug = resolved === "index" ? "" : resolved;

  return slugs.includes(slug) ? { kind: "page", slug } : { kind: "missing", path: `/${resolved}` };
}
