import { parseMdx } from "./processor";
import { extractAttrs, isInlineTag, isVoidTag, nodeTypeForTag, rawSlice } from "./components";
import type { PMDoc, PMMark, PMNode } from "./types";

// mdast → ProseMirror. Standard markdown maps to conventional PM nodes; the 15 known
// components map to typed component nodes; everything else the visual editor can't model
// (custom components, `{expressions}`, `import`/`export`, raw HTML, reference-style links)
// is captured verbatim in an `mdxUnknown*` atom via the source `position` offsets, so it
// round-trips byte-for-byte. This is the fidelity keystone — never lose what we don't model.

type Any = Record<string, any>;

// Literal `<img>` attrs we model on the image node. Any other attribute (className, style,
// loading, an expression, a spread) forces a demotion to raw so nothing is silently lost.
const IMG_ATTRS = new Set(["src", "alt", "title", "width", "height"]);

/** Build a PM image node from a literal `<img>` JSX element, or null to demote it to raw. */
function imgNode(el: Any, marks: PMMark[]): PMNode | null {
  const attrs: Record<string, unknown> = { mdxTag: "img", src: "", alt: null, title: null, width: null, height: null };
  for (const a of el.attributes ?? []) {
    if (a.type !== "mdxJsxAttribute" || !IMG_ATTRS.has(a.name)) return null;
    let value = a.value;
    if (value !== null && typeof value === "object") {
      // Expression value — accept a simple numeric/string literal (e.g. width={600}), else demote.
      const s = String(value.value).trim();
      const lit = /^-?\d+$/.test(s) ? s : (/^(['"])(.*)\1$/.exec(s)?.[2] ?? null);
      if (lit === null) return null;
      value = lit;
    }
    attrs[a.name] = value;
  }
  const node: PMNode = { type: "image", attrs };
  if (marks.length) node.marks = marks;
  return node;
}

function addMark(marks: PMMark[], mark: PMMark): PMMark[] {
  if (marks.some((m) => m.type === mark.type)) return marks;
  return [...marks, mark];
}

function text(value: string, marks: PMMark[]): PMNode {
  const node: PMNode = { type: "text", text: value };
  if (marks.length) node.marks = marks;
  return node;
}

/** Convert phrasing (inline) mdast content to PM inline nodes, threading active marks. */
function inlineToPM(node: Any, source: string, marks: PMMark[]): PMNode[] {
  switch (node.type) {
    case "text":
      return node.value ? [text(node.value, marks)] : [];
    case "strong":
      return childrenInline(node, source, addMark(marks, { type: "bold" }));
    case "emphasis":
      return childrenInline(node, source, addMark(marks, { type: "italic" }));
    case "delete":
      return childrenInline(node, source, addMark(marks, { type: "strike" }));
    case "inlineCode":
      // Collapse an internal soft-wrap (newline + indentation) to a single space. Inline code
      // renders newlines as spaces anyway, and a multi-line inline-code span inside a component
      // is mis-indented by mdast-util-mdx-jsx on every round-trip (+2 spaces per pass). This
      // keeps such content single-line and byte-stable. Block code fences are untouched.
      return [text((node.value ?? "").replace(/\s*\n\s*/g, " "), addMark(marks, { type: "code" }))];
    case "link":
      return childrenInline(
        node,
        source,
        addMark(marks, { type: "link", attrs: { href: node.url ?? "", title: node.title ?? null } }),
      );
    case "break":
      return [{ type: "hardBreak" }];
    case "image": {
      const img: PMNode = { type: "image", attrs: { src: node.url ?? "", alt: node.alt ?? null, title: node.title ?? null } };
      // Carry active marks (e.g. a wrapping link) so a linked image round-trips.
      if (marks.length) img.marks = marks;
      return [img];
    }
    case "mdxJsxTextElement": {
      // Literal inline `<img>` → a real image node; other inline JSX is preserved verbatim.
      if (node.name === "img") {
        const img = imgNode(node, marks);
        if (img) return [img];
      }
      const inlineNode = inlineComponent(node, source, marks);
      if (inlineNode) return [inlineNode];
      return [{ type: "mdxUnknownText", attrs: { raw: rawSlice(source, node) } }];
    }
    default:
      // mdxTextExpression, inline html, reference links/images, footnotes — preserved verbatim.
      return [{ type: "mdxUnknownText", attrs: { raw: rawSlice(source, node) } }];
  }
}

/**
 * An inline component (`<Badge color="green">Beta</Badge>`) as a typed PM node, or null when it
 * has to stay raw.
 *
 * The label is the node's own content, so it's edited in place like any other text. It's kept to
 * TEXT, though — a badge holding a link or an image is not something the component renders
 * meaningfully, and demoting those to raw preserves them exactly rather than silently dropping
 * what the typed model can't hold.
 */
function inlineComponent(node: Any, source: string, marks: PMMark[]): PMNode | null {
  if (!isInlineTag(node.name)) return null;
  const attrs = extractAttrs(node.name as string, node.attributes ?? []);
  if (!attrs) return null; // an expression/unknown attr forced a demotion to raw
  const type = nodeTypeForTag(node.name) as string;
  // A childless component (`<Icon />`) is an atom: no content, and anything written between its
  // tags anyway would be dropped, so that demotes to raw instead.
  if (isVoidTag(node.name)) {
    if ((node.children ?? []).length) return null;
    const atom: PMNode = { type, attrs };
    if (marks.length) atom.marks = marks;
    return atom;
  }
  const content = childrenInline(node, source, []);
  if (content.some((c) => c.type !== "text")) return null;
  const out: PMNode = { type, attrs, content };
  // A badge inside a link or bold run carries those marks, so it round-trips inside them.
  if (marks.length) out.marks = marks;
  return out;
}

function childrenInline(node: Any, source: string, marks: PMMark[]): PMNode[] {
  const out: PMNode[] = [];
  for (const child of node.children ?? []) out.push(...inlineToPM(child, source, marks));
  return out;
}

function childrenBlock(node: Any, source: string): PMNode[] {
  const out: PMNode[] = [];
  for (const child of node.children ?? []) {
    const converted = blockToPM(child, source);
    if (Array.isArray(converted)) out.push(...converted);
    else if (converted) out.push(converted);
  }
  return out;
}

function raw(source: string, node: Any): PMNode {
  return { type: "mdxUnknownFlow", attrs: { raw: rawSlice(source, node) } };
}

// A table cell holds BLOCKS in the editor — a paragraph, or a list — while a GFM cell holds a run
// of inline content and nothing else. The two are reconciled here and in to-mdx's `cellChildren`:
//
//   `| a |`                          ⇄  a paragraph
//   `| <ul><li>a</li></ul> |`        ⇄  a list
//
// The HTML form is the only way markdown can put a list in a cell — there's no pipe-table syntax
// for it — and it renders as a real list, since MDX passes HTML through. Parsed back here so it
// re-opens as an editable list instead of the raw source it would otherwise be shown as.
const CELL_LIST = /^<(ul|ol)>\s*((?:<li>[\s\S]*?<\/li>\s*)+)<\/\1>$/;
const CELL_ITEM = /<li>([\s\S]*?)<\/li>/g;

function cellBlocks(cell: Any, source: string): PMNode[] {
  // Read the HTML off the parsed content rather than slicing the source: remark doesn't give table
  // cells position offsets, so `rawSlice` on one comes back empty. Markup in a cell arrives as a
  // raw atom holding it verbatim, which is exactly what to match — and a cell can hold text AND a
  // list ("Supports SSO<ul>…</ul>"), so this walks the run rather than testing it whole.
  const blocks: PMNode[] = [];
  let run: PMNode[] = [];
  const flushText = () => {
    if (run.length) blocks.push({ type: "paragraph", content: run });
    run = [];
  };
  for (const child of childrenInline(cell, source, [])) {
    const markup = child.type === "mdxUnknownText" ? String(child.attrs?.raw ?? "") : "";
    const list = markup ? cellList(markup.trim()) : null;
    if (!list) {
      run.push(child);
      continue;
    }
    flushText();
    blocks.push(list);
  }
  flushText();
  // An empty cell is still a cell: `block+` needs something to hold the caret.
  return blocks.length ? blocks : [{ type: "paragraph", content: [] }];
}

function cellList(raw: string): PMNode | null {
  const match = CELL_LIST.exec(raw);
  if (!match) return null;
  const items = [...match[2].matchAll(CELL_ITEM)].map((item) => item[1].trim());
  if (!items.length) return null;
  const ordered = match[1] === "ol";
  return {
    type: ordered ? "orderedList" : "bulletList",
    ...(ordered ? { attrs: { start: 1 } } : {}),
    content: items.map((text) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: inlineFromMarkdown(text) }],
    })),
  };
}

/** An item's text, parsed as markdown — so `**bold**` in a cell's list is bold, not four asterisks. */
function inlineFromMarkdown(text: string): PMNode[] {
  const first = ((parseMdx(text) as Any).children ?? [])[0];
  return first?.type === "paragraph" ? childrenInline(first, text, []) : [{ type: "text", text }];
}

/** Convert a flow (block) mdast node to a PM block node (or null to drop it). */
function blockToPM(node: Any, source: string): PMNode | PMNode[] | null {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: childrenInline(node, source, []) };
    case "heading":
      return { type: "heading", attrs: { level: node.depth ?? 1 }, content: childrenInline(node, source, []) };
    case "blockquote": {
      // `>` on its own is a quote with nothing in it, and a `block+` node with no children is an
      // INVALID ProseMirror node — the same trap as an empty component: nothing rejects it at
      // parse time, and it surfaces later as a RangeError the first time something tries to change
      // it. One empty paragraph makes it a quote you can put a caret in.
      const quoted = childrenBlock(node, source);
      return { type: "blockquote", content: quoted.length ? quoted : [{ type: "paragraph" }] };
    }
    case "list":
      return {
        type: node.ordered ? "orderedList" : "bulletList",
        attrs: node.ordered ? { start: node.start ?? 1 } : {},
        content: childrenBlock(node, source),
      };
    case "listItem":
      return {
        type: "listItem",
        // GFM task items carry `checked: true | false`; a plain bullet carries null. Dropping it
        // was silent DATA LOSS: opening a page with `- [ ] thing` in the Visual editor and saving
        // rewrote it as `- thing`, losing every checkbox on the page. Null stays absent so an
        // ordinary list round-trips byte-identically.
        attrs: node.checked === null || node.checked === undefined ? {} : { checked: node.checked },
        content: childrenBlock(node, source),
      };
    case "code": {
      const content = node.value ? [{ type: "text", text: node.value }] : [];
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        content,
      };
    }
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "table":
      return {
        type: "table",
        attrs: { align: node.align ?? [] },
        content: (node.children ?? []).map((row: Any) => ({
          type: "tableRow",
          content: (row.children ?? []).map((cell: Any) => ({
            type: "tableCell",
            content: cellBlocks(cell, source),
          })),
        })),
      };
    case "mdxJsxFlowElement": {
      // A standalone `<img>` line → a paragraph holding the image (image is an inline node).
      if (node.name === "img") {
        const img = imgNode(node, []);
        return img ? { type: "paragraph", content: [img] } : raw(source, node);
      }
      // An inline component on a line of its own arrives as a FLOW element. Its PM node belongs
      // to the inline group, so it needs a paragraph to live in — the MDX it serializes back to
      // is the same either way.
      if (isInlineTag(node.name)) {
        const inlineNode = inlineComponent(node, source, []);
        return inlineNode ? { type: "paragraph", content: [inlineNode] } : raw(source, node);
      }
      const nodeType = nodeTypeForTag(node.name);
      if (nodeType) {
        const attrs = extractAttrs(node.name, node.attributes ?? []);
        // A childless BLOCK component (`<Tree.File name="x" />`) is an atom: a row, not a
        // container. Anything written between its tags anyway demotes to raw rather than being
        // silently dropped.
        if (attrs && isVoidTag(node.name)) {
          return (node.children ?? []).length ? raw(source, node) : { type: nodeType, attrs };
        }
        // attrs === null means an expression/unknown attr forced a demotion to raw.
        if (attrs) {
          const content = childrenBlock(node, source);
          // An empty component — `<ParamField … />`, or a tag pair with nothing between it — is an
          // INVALID ProseMirror node: every component node's content is `block+`. Nothing rejects
          // it at parse time; it surfaces later as a `RangeError: Invalid content for node type …`
          // the first time something calls setNodeMarkup on it (editing a title in the Visual
          // editor does exactly that), and before then the component has no line to put a caret
          // on. One empty paragraph makes it valid and gives it that line. to-mdx drops it again,
          // so `<X />` still serializes as `<X />` — see emptyComponent there.
          return { type: nodeType, attrs, content: content.length ? content : [{ type: "paragraph" }] };
        }
      }
      return raw(source, node);
    }
    // Custom components, `{expressions}`, `import`/`export`, raw HTML blocks — preserve verbatim.
    case "mdxFlowExpression":
    case "mdxjsEsm":
    case "html":
    case "yaml":
    case "definition":
    case "footnoteDefinition":
      return raw(source, node);
    default:
      return raw(source, node);
  }
}

export function mdxToProseMirror(mdxBody: string): PMDoc {
  const tree = parseMdx(mdxBody) as Any;
  return { type: "doc", content: childrenBlock(tree, mdxBody) };
}
