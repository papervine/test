import type { Root } from "mdast";
import { stringifyMdast } from "./processor";
import { COMPONENTS, buildAttributes, isInlineTag, isVoidTag, tagForNode } from "./components";
import type { PMDoc, PMMark, PMNode } from "./types";

// ProseMirror → mdast → MDX. The exact inverse of to-prosemirror: standard nodes rebuild
// their mdast, component nodes rebuild their `mdxJsxFlowElement` (name + attributes + flow
// children), and `mdxUnknown*` nodes emit their preserved raw source verbatim via the
// `mdxRaw` handler registered on the processor.

type Any = Record<string, any>;

const COMPONENT_NODE_TYPES = new Set(Object.values(COMPONENTS).map((c) => c.node));

function hasMark(marks: PMMark[] | undefined, type: string): boolean {
  return !!marks?.some((m) => m.type === type);
}

// Wrapping marks in fixed outer→inner nesting order. `code` is not here: it's baked into the
// leaf (inlineCode), the innermost level. This precedence keeps output deterministic.
const MARK_PRECEDENCE = ["link", "bold", "italic", "strike"] as const;

interface InlineItem {
  marks: PMMark[];
  leaf: Any;
}

/** The base (mark-free) mdast for a PM inline node — the innermost node the marks wrap. */
function leafToMdast(node: PMNode): Any {
  if (node.type === "hardBreak") return { type: "break" };
  if (node.type === "image") {
    // Preserve the authored form: a JSX `<img>` round-trips as `<img>` (and keeps width/height,
    // which markdown image syntax can't express); a markdown image stays `![alt](src)`.
    if (node.attrs?.mdxTag === "img") {
      const attributes = ["src", "alt", "title", "width", "height"]
        .filter((k) => node.attrs?.[k] !== null && node.attrs?.[k] !== undefined)
        .map((k) => ({ type: "mdxJsxAttribute", name: k, value: String(node.attrs?.[k]) }));
      return { type: "mdxJsxTextElement", name: "img", attributes, children: [] };
    }
    return { type: "image", url: node.attrs?.src ?? "", alt: node.attrs?.alt ?? null, title: node.attrs?.title ?? null };
  }
  if (node.type === "mdxUnknownText") return { type: "mdxRaw", value: node.attrs?.raw ?? "" };
  // An inline component (`<Badge>Beta</Badge>`): a text element, so it stays inside the paragraph
  // it was written in rather than breaking the line the way a flow element would.
  if (isInlineTag((node.attrs?.mdxName as string) ?? null)) {
    const name = tagForNode(node);
    return {
      type: "mdxJsxTextElement",
      name,
      attributes: buildAttributes(node.attrs),
      // Through the same inline machinery as a paragraph, so emphasis inside a label survives —
      // the schema lets a badge's text carry marks, so the serializer has to write them. A
      // childless component has none of that: no children serializes as `<Icon … />`.
      children: isVoidTag(name) ? [] : inlineList(node.content),
    };
  }
  return hasMark(node.marks, "code")
    ? { type: "inlineCode", value: node.text ?? "" }
    : { type: "text", value: node.text ?? "" };
}

function markOf(item: InlineItem, type: string): PMMark | undefined {
  return item.marks.find((m) => m.type === type);
}

/** Two marks merge into one wrapper only if truly the same (links compare href+title). */
function markEqual(a: PMMark | undefined, b: PMMark | undefined): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "link") {
    return (a.attrs?.href ?? "") === (b.attrs?.href ?? "") && (a.attrs?.title ?? null) === (b.attrs?.title ?? null);
  }
  return true;
}

function wrapMark(type: string, mark: PMMark, children: Any[]): Any {
  switch (type) {
    case "bold":
      return { type: "strong", children };
    case "italic":
      return { type: "emphasis", children };
    case "strike":
      return { type: "delete", children };
    default: // link
      return { type: "link", url: mark.attrs?.href ?? "", title: mark.attrs?.title ?? null, children };
  }
}

/**
 * Fold shared marks around consecutive inline items. Wrapping each node individually would
 * emit `**a****b**` for two adjacent bold runs (and `&#x20;`-encode boundary whitespace),
 * which the next serialize pass re-escapes — non-idempotent. Grouping emits one `**ab**`,
 * so the output is a fixed point. An unmarked node between two marked ones breaks the run
 * (so `**a** **b**` stays two strongs, not `**a b**`).
 */
function buildInline(items: InlineItem[], prec: number): Any[] {
  if (prec >= MARK_PRECEDENCE.length) return items.map((it) => it.leaf);
  const type = MARK_PRECEDENCE[prec];
  const out: Any[] = [];
  let i = 0;
  while (i < items.length) {
    const mark = markOf(items[i], type);
    if (!mark) {
      // Gather the whole run of consecutive items lacking this mark and recurse deeper as a
      // group — peeling them one at a time would break grouping at inner precedence levels.
      let j = i;
      while (j < items.length && !markOf(items[j], type)) j++;
      out.push(...buildInline(items.slice(i, j), prec + 1));
      i = j;
      continue;
    }
    let j = i;
    while (j < items.length && markEqual(markOf(items[j], type), mark)) j++;
    out.push(wrapMark(type, mark, buildInline(items.slice(i, j), prec + 1)));
    i = j;
  }
  return out;
}

function inlineList(content: PMNode[] | undefined): Any[] {
  const items: InlineItem[] = (content ?? []).map((node) => ({ marks: node.marks ?? [], leaf: leafToMdast(node) }));
  return buildInline(items, 0);
}

function blockList(content: PMNode[] | undefined): Any[] {
  return (content ?? []).map(blockToMdast);
}

/**
 * A table cell's blocks, flattened back to the inline run a GFM cell can hold.
 *
 * A paragraph is just its inline content, so an ordinary cell is byte-identical to what it always
 * was. A list has no pipe-table syntax at all, so it goes out as HTML — the form MDX renders as a
 * real list, and the one `cellBlocks` reads back in to-prosemirror. Anything else flattens to its
 * inline content rather than being dropped.
 */
function cellChildren(blocks: PMNode[] | undefined): Any[] {
  const out: Any[] = [];
  for (const block of blocks ?? []) {
    if (block.type === "bulletList" || block.type === "orderedList") out.push(listAsHtml(block));
    else out.push(...inlineList(block.content));
  }
  return out;
}

function listAsHtml(list: PMNode): Any {
  const tag = list.type === "orderedList" ? "ol" : "ul";
  const items = (list.content ?? [])
    .map((item) => `<li>${inlineToMarkdown(item.content?.[0]?.content)}</li>`)
    .join("");
  // `mdxRaw`, not `html`: the processor's passthrough handler emits it verbatim and suppresses the
  // escaping that would otherwise creep in around it.
  return { type: "mdxRaw", value: `<${tag}>${items}</${tag}>` };
}

/** One item's inline content as markdown text, so emphasis inside a cell's list survives. */
function inlineToMarkdown(content: PMNode[] | undefined): string {
  if (!content?.length) return "";
  return stringifyMdast({
    type: "root",
    children: [{ type: "paragraph", children: inlineList(content) }],
  } as Root).trim();
}

/**
 * A component holding nothing but one empty paragraph — the filler to-prosemirror adds so an empty
 * component is a valid node with somewhere to type (see the note there). It has no MDX of its own:
 * no source produces a single *empty* paragraph, because a blank line inside a tag pair parses to
 * no children at all. So it's dropped here, and `<ParamField … />` serializes back self-closing
 * instead of growing into a `<ParamField …>\n</ParamField>` pair across every API page on save.
 */
function isFillerParagraph(content: PMNode[] | undefined): boolean {
  return content?.length === 1 && content[0].type === "paragraph" && !content[0].content?.length;
}

/** Rebuild a flow (block) mdast node from a PM block node. */
function blockToMdast(node: PMNode): Any {
  if (COMPONENT_NODE_TYPES.has(node.type)) {
    const name = tagForNode(node);
    return {
      type: "mdxJsxFlowElement",
      name,
      attributes: buildAttributes(node.attrs),
      // A childless component (`<Tree.File />`) has no children to serialize; anything else
      // serializes its blocks, minus the filler paragraph an empty one was given to type in.
      children:
        isVoidTag(name) || isFillerParagraph(node.content) ? [] : blockList(node.content),
    };
  }
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: inlineList(node.content) };
    case "heading":
      return { type: "heading", depth: (node.attrs?.level as number) ?? 1, children: inlineList(node.content) };
    case "blockquote":
      return { type: "blockquote", children: blockList(node.content) };
    case "bulletList":
      return { type: "list", ordered: false, spread: false, children: blockList(node.content) };
    case "orderedList":
      return {
        type: "list",
        ordered: true,
        start: (node.attrs?.start as number) ?? 1,
        spread: false,
        children: blockList(node.content),
      };
    case "listItem": {
      // `checked` back out as GFM's `[ ]` / `[x]`. Undefined (a plain bullet) must stay undefined
      // rather than become false, or every ordinary list item would grow an empty checkbox.
      const checked = node.attrs?.checked;
      return {
        type: "listItem",
        ...(typeof checked === "boolean" ? { checked } : {}),
        spread: false,
        children: blockList(node.content),
      };
    }
    case "codeBlock":
      return {
        type: "code",
        lang: (node.attrs?.language as string) ?? null,
        meta: (node.attrs?.meta as string) ?? null,
        value: (node.content ?? []).map((c) => c.text ?? "").join(""),
      };
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "table":
      return {
        type: "table",
        align: (node.attrs?.align as unknown[]) ?? [],
        children: (node.content ?? []).map((row) => ({
          type: "tableRow",
          children: (row.content ?? []).map((cell) => ({
            type: "tableCell",
            children: cellChildren(cell.content),
          })),
        })),
      };
    case "mdxUnknownFlow":
      return { type: "mdxRaw", value: node.attrs?.raw ?? "" };
    default:
      // Unknown PM node type — preserve nothing rather than crash; emit an empty paragraph.
      return { type: "paragraph", children: [] };
  }
}

export function proseMirrorToMdx(doc: PMDoc): string {
  const tree = { type: "root", children: blockList(doc.content) } as unknown as Root;
  return stringifyMdast(tree);
}
