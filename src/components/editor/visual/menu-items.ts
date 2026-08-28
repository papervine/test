import type { Editor, Range } from "@tiptap/core";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code,
  Minus,
  Type,
  Table,
  Image,
  GitBranch,
  Info,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  Pencil,
  LayoutGrid,
  Columns3,
  Columns4,
  ListChecks,
  ChevronDown,
  ListCollapse,
  SquareStack,
  Frame,
  ChevronsUpDown,
  TextCursorInput,
  MessageSquare,
  FileCode2,
  Video,
  CodeXml,
  type LucideIcon,
} from "lucide-react";
import {
  embedMarkup,
  isSafeMediaUrl,
  toEmbedUrl,
  videoMarkup,
  type MediaInputKind,
} from "@/lib/media-embed";

/** Collect a URL from the user, then insert. Supplied by whoever hosts the menu (VisualEditor),
 *  which owns the dialog — the menu itself stays free of React. */
export type RequestInput = (kind: MediaInputKind, onSubmit: (value: string) => void) => void;

export type SlashCategory =
  | "Basic blocks"
  | "Lists & tables"
  | "Media"
  | "Callouts"
  | "Components";

export interface SlashItem {
  title: string;
  description: string;
  category: SlashCategory;
  icon: LucideIcon;
  searchTerms: string[];
  /** Slash-menu behavior: operates on the typed `/query` range (toggle in place, or insert). */
  command: (ctx: { editor: Editor; range: Range; requestInput: RequestInput }) => void;
  /**
   * Picker ("+") behavior: the fresh node to insert at a block boundary. null = nothing to insert.
   * Items with `input` set receive the collected URL; the rest ignore the argument.
   */
  make: (input?: string) => object | null;
  /** Needs a URL first, collected through the media dialog rather than inserted straight away. */
  input?: MediaInputKind;
}

export const SLASH_CATEGORIES: SlashCategory[] = [
  "Basic blocks",
  "Lists & tables",
  "Media",
  "Callouts",
  "Components",
];

// ── Node factories ────────────────────────────────────────────────────────
// Fresh ProseMirror nodes for each block. Component nodes carry `mdxName` + typed attrs exactly
// as the converter expects, so anything inserted round-trips to MDX. Shared by both the slash
// `command` (insert-type items) and the picker `make`.
const paragraph = () => ({ type: "paragraph" });
const heading = (level: number) => ({ type: "heading", attrs: { level } });
const blockquote = () => ({ type: "blockquote", content: [paragraph()] });
const bulletList = () => ({ type: "bulletList", content: [{ type: "listItem", content: [paragraph()] }] });
const orderedList = () => ({ type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [paragraph()] }] });
// A task list is a bullet list whose items carry GFM's `checked` — not a separate node type, so
// one list can mix checked items with plain bullets exactly as the markdown allows.
const taskList = () => ({
  type: "bulletList",
  content: [{ type: "listItem", attrs: { checked: false }, content: [paragraph()] }],
});
const codeBlock = () => ({ type: "codeBlock", attrs: { language: null, meta: null }, content: [] });
const divider = () => ({ type: "thematicBreak" });
const table = () => ({
  type: "table",
  content: [
    { type: "tableRow", content: [{ type: "tableCell" }, { type: "tableCell" }] },
    { type: "tableRow", content: [{ type: "tableCell" }, { type: "tableCell" }] },
  ],
});
const mermaid = () => ({ type: "codeBlock", attrs: { language: "mermaid", meta: null }, content: [{ type: "text", text: "graph TD;\n  A --> B;" }] });
const image = (src?: string) =>
  src
    ? { type: "paragraph", content: [{ type: "image", attrs: { mdxTag: "img", src, alt: null, title: null } }] }
    : null;
// Video and embeds are raw HTML, not a component: the docs.json-compatible schema has no video
// component, and its own guidance is a plain `<video>` / `<iframe>` with utility classes. The
// converter keeps raw HTML as an opaque block whose `raw` attr is the source text, so this
// round-trips byte-exact and stays portable — and NodeViews renders it as a live player rather
// than the read-only source it would otherwise show. The URL is collected by the media dialog
// (see `input` on the items below); browsing or uploading files needs an asset pipeline that
// doesn't exist yet.
//
// The URL is re-checked here rather than trusted from the dialog: `make` is also reachable from
// the "+" picker, and a validity check that only lives in one caller is one refactor from gone.
const rawBlock = (raw: string) => ({ type: "mdxUnknownFlow", attrs: { raw } });
const video = (src?: string) =>
  src && isSafeMediaUrl(src) ? rawBlock(videoMarkup(src.trim())) : null;
const embed = (url?: string) =>
  // Resolve the share link people actually paste into the one the provider allows framing.
  url && isSafeMediaUrl(url) ? rawBlock(embedMarkup(toEmbedUrl(url.trim()).url)) : null;
const callout = (mdxName: string) => ({ type: "callout", attrs: { mdxName }, content: [paragraph()] });
const card = () => ({ type: "card", attrs: { mdxName: "Card", title: "Card title" }, content: [paragraph()] });
const cardGroup = (n: number) => ({ type: "cardGroup", attrs: { mdxName: "CardGroup", cols: n }, content: Array.from({ length: n }, card) });
// No `title`: it defaults to null and serializes away, so an untitled accordion round-trips as
// `<Accordion>` rather than a `title="Accordion title"` nobody meant to publish. The node view
// renders the title slot regardless, with that text as its placeholder — the same bargain the
// `<Step>` title makes. A group starts with two, since one collapsible row is just an accordion.
const accordion = () => ({ type: "accordion", attrs: { mdxName: "Accordion" }, content: [paragraph()] });
const accordionGroup = () => ({
  type: "accordionGroup",
  attrs: { mdxName: "AccordionGroup" },
  content: [accordion(), accordion()],
});
const steps = () => ({ type: "steps", attrs: { mdxName: "Steps" }, content: [{ type: "step", attrs: { mdxName: "Step", title: "Step title" }, content: [paragraph()] }] });
const tabs = () => ({
  type: "tabs",
  attrs: { mdxName: "Tabs" },
  content: [
    { type: "tab", attrs: { mdxName: "Tab", title: "Tab 1" }, content: [paragraph()] },
    { type: "tab", attrs: { mdxName: "Tab", title: "Tab 2" }, content: [paragraph()] },
  ],
});
const codeGroup = () => ({ type: "codeGroup", attrs: { mdxName: "CodeGroup" }, content: [{ type: "codeBlock", attrs: { language: "js", meta: null }, content: [{ type: "text", text: "// code" }] }] });
const frame = () => ({ type: "frame", attrs: { mdxName: "Frame" }, content: [paragraph()] });
const expandable = () => ({ type: "expandable", attrs: { mdxName: "Expandable", title: "Details" }, content: [paragraph()] });
const paramField = () => ({ type: "apiField", attrs: { mdxName: "ParamField", name: "param", type: "string" }, content: [paragraph()] });
const responseField = () => ({ type: "apiField", attrs: { mdxName: "ResponseField", name: "field", type: "string" }, content: [paragraph()] });

// Slash command that inserts the node returned by `make` in place of the typed `/query`.
const insertCmd =
  (make: (input?: string) => object | null, input?: MediaInputKind, focusTitle?: boolean) =>
  ({ editor, range, requestInput }: { editor: Editor; range: Range; requestInput: RequestInput }) => {
    if (input) {
      // Drop the typed `/query` before opening the dialog, so it isn't sitting behind it as
      // stray text — and if the dialog is dismissed, that's the whole effect.
      editor.chain().focus().deleteRange(range).run();
      requestInput(input, (value) => {
        const node = make(value);
        if (node) editor.chain().focus().insertContent(node).run();
      });
      return;
    }
    const node = make();
    const chain = editor.chain().focus().deleteRange(range);
    if (node) chain.insertContent(node);
    chain.run();
    // A component whose first field is a name gets the caret put in it, so inserting one is
    // immediately followed by naming it. The node lands where the `/query` was, so `range.from`
    // addresses it directly rather than hunting for the last title field on the page. The
    // document selection stays in the body, which is where typing continues after the name.
    if (node && focusTitle) {
      requestAnimationFrame(() => {
        const dom = editor.view.nodeDOM(range.from);
        const field = dom instanceof HTMLElement ? dom.querySelector("input") : null;
        if (field) field.focus();
      });
    }
  };

// Helper to define an item whose slash + picker behavior both come from a node factory.
function insertItem(
  title: string,
  description: string,
  category: SlashCategory,
  icon: LucideIcon,
  searchTerms: string[],
  make: (input?: string) => object | null,
  input?: MediaInputKind,
  focusTitle?: boolean,
): SlashItem {
  return {
    title,
    description,
    category,
    icon,
    searchTerms,
    make,
    input,
    command: insertCmd(make, input, focusTitle),
  };
}

export const SLASH_ITEMS: SlashItem[] = [
  // ── Basic blocks (text-like: slash toggles in place; picker inserts fresh) ──
  {
    title: "Text",
    description: "Plain paragraph",
    category: "Basic blocks",
    icon: Type,
    searchTerms: ["p", "paragraph", "text"],
    make: paragraph,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Big section heading",
    category: "Basic blocks",
    icon: Heading1,
    searchTerms: ["h1", "title"],
    make: () => heading(1),
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium heading",
    category: "Basic blocks",
    icon: Heading2,
    searchTerms: ["h2"],
    make: () => heading(2),
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small heading",
    category: "Basic blocks",
    icon: Heading3,
    searchTerms: ["h3"],
    make: () => heading(3),
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Blockquote",
    description: "Quoted text",
    category: "Basic blocks",
    icon: Quote,
    searchTerms: ["quote", "blockquote"],
    make: blockquote,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    description: "Fenced code",
    category: "Basic blocks",
    icon: Code,
    searchTerms: ["code", "fence", "pre"],
    make: codeBlock,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  insertItem("Divider", "Horizontal rule", "Basic blocks", Minus, ["hr", "divider", "rule", "separator"], divider),

  // ── Lists & tables ──────────────────────────────────────────────────────
  {
    title: "Bullet list",
    description: "Unordered list",
    category: "Lists & tables",
    icon: List,
    searchTerms: ["ul", "bullet", "unordered"],
    make: bulletList,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    category: "Lists & tables",
    icon: ListOrdered,
    searchTerms: ["ol", "ordered", "number"],
    make: orderedList,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  insertItem(
    "Task list",
    "Checklist with checkboxes",
    "Lists & tables",
    ListTodo,
    ["task", "todo", "checkbox", "check", "checklist"],
    taskList,
  ),
  insertItem("Table", "2×2 table", "Lists & tables", Table, ["table", "grid", "rows"], table),

  // ── Media ───────────────────────────────────────────────────────────────
  insertItem("Image", "Embed an image", "Media", Image, ["image", "img", "picture", "photo"], image, "image"),
  insertItem(
    "Video",
    "Add video media",
    "Media",
    Video,
    ["video", "mp4", "webm", "movie", "media"],
    video,
    "video",
  ),
  insertItem(
    "Embed",
    "YouTube, Loom, Vimeo, or any iframe",
    "Media",
    CodeXml,
    ["embed", "iframe", "youtube", "loom", "vimeo"],
    embed,
    "embed",
  ),
  insertItem("Mermaid", "Diagram", "Media", GitBranch, ["mermaid", "diagram", "graph", "flow"], mermaid),

  // ── Callouts ────────────────────────────────────────────────────────────
  insertItem("Note", "Neutral callout", "Callouts", Pencil, ["note", "callout"], () => callout("Note")),
  insertItem("Info", "Info callout", "Callouts", Info, ["info", "callout"], () => callout("Info")),
  insertItem("Tip", "Tip callout", "Callouts", Lightbulb, ["tip", "hint"], () => callout("Tip")),
  insertItem("Warning", "Warning callout", "Callouts", AlertTriangle, ["warning", "caution"], () => callout("Warning")),
  insertItem("Check", "Success callout", "Callouts", CheckCircle2, ["check", "success"], () => callout("Check")),

  // ── Components ──────────────────────────────────────────────────────────
  insertItem("Card", "Single card", "Components", SquareStack, ["card"], card),
  insertItem("2 columns", "Card grid", "Components", LayoutGrid, ["card", "cards", "columns", "grid", "2"], () => cardGroup(2)),
  insertItem("3 columns", "Card grid", "Components", Columns3, ["columns", "grid", "3"], () => cardGroup(3)),
  insertItem("4 columns", "Card grid", "Components", Columns4, ["columns", "grid", "4"], () => cardGroup(4)),
  insertItem("Accordion", "Collapsible section", "Components", ChevronDown, ["accordion", "toggle", "collapse", "expand"], accordion, undefined, true),
  insertItem("Accordion group", "Group of accordions", "Components", ListCollapse, ["accordion", "group"], accordionGroup, undefined, true),
  insertItem("Steps", "Numbered steps", "Components", ListChecks, ["step", "steps", "guide"], steps),
  insertItem("Tabs", "Tabbed content", "Components", SquareStack, ["tab", "tabs"], tabs),
  insertItem("Code group", "Tabbed code blocks", "Components", FileCode2, ["code", "group", "tabs"], codeGroup),
  insertItem("Frame", "Framed media", "Components", Frame, ["frame", "figure", "screenshot"], frame),
  insertItem("Expandable", "Inline collapsible", "Components", ChevronsUpDown, ["expandable", "expand", "collapse", "details"], expandable),
  insertItem("Parameter field", "API request param", "Components", TextCursorInput, ["param", "parameter", "field", "api"], paramField),
  insertItem("Response field", "API response field", "Components", MessageSquare, ["response", "field", "api"], responseField),
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.searchTerms.some((t) => t.includes(q)),
  );
}
