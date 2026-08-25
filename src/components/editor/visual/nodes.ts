import { Node, mergeAttributes, type Extensions, type NodeViewRenderer } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import CodeBlock from "@tiptap/extension-code-block";
import { ListItem } from "@tiptap/extension-list";
import { COMPONENTS } from "@papervine/mdx-prosemirror";
import { SelectAllScope } from "./select-all-scope";
import { EdgeGuard } from "./edge-guard";

// The TipTap schema for the Visual editor. Every node/mark name here matches the converter's
// ProseMirror JSON (@papervine/mdx-prosemirror) exactly, so mdxToProseMirror output loads and
// editor.getJSON() serializes back byte-faithfully. This module is intentionally free of
// @tiptap/react — the jsdom round-trip test reuses it; the live editor injects React node
// views via the opts below.

export interface NodeViewOpts {
  componentNodeView?: (type: string) => NodeViewRenderer;
  atomNodeView?: (type: string, inline: boolean) => NodeViewRenderer;
  imageNodeView?: () => NodeViewRenderer;
  codeBlockNodeView?: () => NodeViewRenderer;
}

// Derive each component node's attr set from the shared spec (union across aliased tags),
// always including mdxName (the original JSX tag, for exact serialization).
function componentNodeAttrs(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const spec of Object.values(COMPONENTS)) {
    const set = (out[spec.node] ||= []);
    for (const a of Object.keys(spec.attrs)) if (!set.includes(a)) set.push(a);
  }
  return out;
}

function componentNode(type: string, attrNames: string[], nodeView?: NodeViewRenderer): Node {
  return Node.create({
    name: type,
    group: "block",
    content: "block+", // permissive: never reject real content that isn't the idealized shape
    defining: true,
    addAttributes() {
      const attrs: Record<string, { default: unknown }> = { mdxName: { default: null } };
      for (const a of attrNames) attrs[a] = { default: null };
      return attrs;
    },
    parseHTML() {
      return [{ tag: `div[data-mdx="${type}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-mdx": type }), 0];
    },
    ...(nodeView ? { addNodeView: () => nodeView } : {}),
  });
}

function atomNode(type: string, inline: boolean, nodeView?: NodeViewRenderer): Node {
  const tag = inline ? "span" : "div";
  return Node.create({
    name: type,
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    selectable: true,
    addAttributes() {
      return { raw: { default: "" } };
    },
    parseHTML() {
      return [{ tag: `${tag}[data-mdx="${type}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { "data-mdx": type })];
    },
    ...(nodeView ? { addNodeView: () => nodeView } : {}),
  });
}

// Minimal table nodes matching the converter's shape (cells hold inline content directly —
// unlike @tiptap/extension-table, which requires block content and a header row).
const Table = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  addAttributes: () => ({ align: { default: [] } }),
  parseHTML: () => [{ tag: "table" }],
  renderHTML: () => ["table", ["tbody", 0]],
});
const TableRow = Node.create({
  name: "tableRow",
  content: "tableCell+",
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: () => ["tr", 0],
});
const TableCell = Node.create({
  name: "tableCell",
  content: "inline*",
  parseHTML: () => [{ tag: "td" }],
  renderHTML: () => ["td", 0],
});

// Converter emits `thematicBreak`; StarterKit's node is `horizontalRule` — use our name.
const ThematicBreak = Node.create({
  name: "thematicBreak",
  group: "block",
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: () => ["hr"],
});

// codeBlock keeps the fence info string (```lang meta); Link keeps the `title` (`[x](u "t")`).
// In the live editor a node view renders a ```mermaid fence as a diagram (see NodeViews).
function codeBlockExt(nodeView?: NodeViewRenderer) {
  return CodeBlock.extend({
    addAttributes() {
      return { ...this.parent?.(), meta: { default: null } };
    },
    ...(nodeView ? { addNodeView: () => nodeView } : {}),
  });
}
/**
 * A GFM task item — `- [ ]` / `- [x]` — is StarterKit's ordinary `listItem` carrying a `checked`
 * attr, not a separate node type.
 *
 * Deliberately NOT @tiptap/extension-task-list, which introduces its own `taskList`/`taskItem`
 * node pair. The converter emits `bulletList` > `listItem` because that's what the markdown IS:
 * a bullet list whose items happen to be checked. A second node type would need converting to and
 * from the same markdown, and a list mixing checked and plain items — legal GFM — couldn't be
 * represented at all.
 *
 * The checkbox is rendered by CSS off `data-checked` rather than by a node view: it's decoration,
 * and a node view per list item is a React root per bullet.
 */
const TaskListItem = ListItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      checked: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-checked");
          return raw === null ? null : raw === "true";
        },
        // Absent for a plain bullet, so nothing marks an ordinary list as a task list.
        renderHTML: (attrs) =>
          typeof attrs.checked === "boolean" ? { "data-checked": String(attrs.checked) } : {},
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Toggle the item under the cursor. Mod-Enter is what every editor with checkboxes uses,
      // and it means the list is usable without reaching for the mouse.
      "Mod-Enter": () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name !== "listItem") continue;
          // Only toggles an item that IS a task item; Mod-Enter in a plain list stays free for
          // whatever else wants it.
          if (typeof node.attrs.checked !== "boolean") return false;
          const pos = $from.before(depth);
          view.dispatch(
            state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }),
          );
          return true;
        }
        return false;
      },
    };
  },
});

const LinkWithTitle = Link.extend({
  addAttributes() {
    return { ...this.parent?.(), title: { default: null } };
  },
});

export function buildMdxExtensions(opts: NodeViewOpts = {}): Extensions {
  const attrs = componentNodeAttrs();
  const componentNodes = Object.entries(attrs).map(([type, names]) =>
    componentNode(type, names, opts.componentNodeView?.(type)),
  );
  // Image carries mdxTag/width/height (so a literal `<img>` round-trips) and, in the live
  // editor, a node view that resolves the tenant asset URL so the image actually loads.
  const imageNodeView = opts.imageNodeView;
  const ImageWithAttrs = Image.extend({
    addAttributes() {
      return { ...this.parent?.(), mdxTag: { default: null }, width: { default: null }, height: { default: null } };
    },
    ...(imageNodeView ? { addNodeView: () => imageNodeView() } : {}),
  });
  return [
    // listItem comes from TaskListItem below instead, so it can carry GFM's `checked`.
    StarterKit.configure({ horizontalRule: false, codeBlock: false, link: false, listItem: false }),
    TaskListItem,
    codeBlockExt(opts.codeBlockNodeView?.()),
    LinkWithTitle.configure({ openOnClick: false }),
    ImageWithAttrs.configure({ inline: true, allowBase64: true }),
    ThematicBreak,
    Table,
    TableRow,
    TableCell,
    ...componentNodes,
    SelectAllScope,
    EdgeGuard,
    atomNode("mdxUnknownFlow", false, opts.atomNodeView?.("mdxUnknownFlow", false)),
    atomNode("mdxUnknownText", true, opts.atomNodeView?.("mdxUnknownText", true)),
  ];
}
