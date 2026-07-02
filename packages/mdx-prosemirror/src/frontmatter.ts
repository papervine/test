export interface SplitFrontmatter {
  /** The raw frontmatter block including the `---` fences (empty string if none). */
  frontmatter: string;
  /** The MDX body after the frontmatter. */
  body: string;
  /** Byte offset in the original text where `body` begins (for mapping edits back to Y.Text). */
  bodyStart: number;
}

// Frontmatter is a `---`-fenced block at the very start of the file (YAML). We only need to
// separate it from the body and record where the body starts — the Visual editor binds
// title/description as a header form, and the canonical Y.Text keeps the whole file, so the
// converter operates on the body region alone. We don't parse the YAML here (keeps this
// package pure and dependency-free); that lives at the editor/content layer with gray-matter.
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): SplitFrontmatter {
  const match = FRONTMATTER.exec(text);
  if (!match) return { frontmatter: "", body: text, bodyStart: 0 };
  const bodyStart = match[0].length;
  return {
    frontmatter: match[0],
    body: text.slice(bodyStart),
    bodyStart,
  };
}
