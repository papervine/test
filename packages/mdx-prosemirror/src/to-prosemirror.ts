import { parseMdx } from "./processor";
import { extractAttrs, nodeTypeForTag, rawSlice } from "./components";
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
    case "mdxJsxTextElement":
      // Literal inline `<img>` → a real image node; other inline JSX is preserved verbatim.
      if (node.name === "img") {
        const img = imgNode(node, marks);
        if (img) return [img];
      }
      return [{ type: "mdxUnknownText", attrs: { raw: rawSlice(source, node) } }];
    default:
      // mdxTextExpression, inline html, reference links/images, footnotes — preserved verbatim.
      return [{ type: "mdxUnknownText", attrs: { raw: rawSlice(source, node) } }];
  }
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

/** Convert a flow (block) mdast node to a PM block node (or null to drop it). */
function blockToPM(node: Any, source: string): PMNode | PMNode[] | null {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", content: childrenInline(node, source, []) };
    case "heading":
      return { type: "heading", attrs: { level: node.depth ?? 1 }, content: childrenInline(node, source, []) };
    case "blockquote":
      return { type: "blockquote", content: childrenBlock(node, source) };
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
            content: childrenInline(cell, source, []),
          })),
        })),
      };
    case "mdxJsxFlowElement": {
      // A standalone `<img>` line → a paragraph holding the image (image is an inline node).
      if (node.name === "img") {
        const img = imgNode(node, []);
        return img ? { type: "paragraph", content: [img] } : raw(source, node);
      }
      const nodeType = nodeTypeForTag(node.name);
      if (nodeType) {
        const attrs = extractAttrs(node.name, node.attributes ?? []);
        // attrs === null means an expression/unknown attr forced a demotion to raw.
        if (attrs) return { type: nodeType, attrs, content: childrenBlock(node, source) };
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
