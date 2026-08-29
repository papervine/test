import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Token colours for MDX shown in a CodeMirror pane.
 *
 * CodeMirror 6 separates *parsing* from *painting*: `markdown()` builds the syntax tree, but
 * nothing is coloured until a highlight style maps tree tags to styles. Without this the source
 * reads as one flat block of monospace — which is what the editor's own Source mode still looks
 * like today (`SourceEditor.tsx` configures `markdown()` and no highlight style; adopting this
 * there is a small, obvious follow-up).
 *
 * Colours are the platform tokens rather than a canned CodeMirror theme, so the pane belongs to
 * the same palette as everything around it and follows the light/dark appearance for free —
 * `--blue`, `--violet` and `--muted` are all redefined per theme in platform.css.
 */
export const markdownHighlight = HighlightStyle.define([
  // Structure: headings and the component tags that make MDX more than markdown.
  { tag: tags.heading, color: "var(--fg)", fontWeight: "600" },
  { tag: tags.tagName, color: "var(--violet)" },
  { tag: tags.angleBracket, color: "var(--violet)", opacity: "0.7" },
  { tag: tags.attributeName, color: "var(--blue)" },
  { tag: tags.attributeValue, color: "var(--fg)" },

  // Inline emphasis, rendered as the thing it describes.
  { tag: tags.strong, color: "var(--fg)", fontWeight: "600" },
  { tag: tags.emphasis, color: "var(--fg)", fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },

  { tag: tags.link, color: "var(--blue)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--blue)" },

  // Code: the fence markers stay quiet, the code inside reads as content.
  { tag: tags.monospace, color: "var(--fg)" },
  { tag: tags.meta, color: "var(--muted)" },

  { tag: tags.list, color: "var(--blue)" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  // The `---`/`##`/`>` punctuation itself — present, but never competing with the prose.
  { tag: tags.processingInstruction, color: "var(--muted)", opacity: "0.65" },
  { tag: tags.contentSeparator, color: "var(--muted)", opacity: "0.65" },
]);
