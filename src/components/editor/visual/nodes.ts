import { Node, mergeAttributes, type Extensions, type NodeViewRenderer } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import CodeBlock from "@tiptap/extension-code-block";
import { ListItem } from "@tiptap/extension-list";
import { Table as TipTapTable } from "@tiptap/extension-table";
import { TableRow as TipTapTableRow } from "@tiptap/extension-table-row";
import { TableCell as TipTapTableCell } from "@tiptap/extension-table-cell";
import { TableHeader as TipTapTableHeader } from "@tiptap/extension-table-header";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
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
  tableNodeView?: () => NodeViewRenderer;
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

// Tables. The node NAMES and shape are the converter's — a `table` of `tableRow`s of `tableCell`s
// whose content is inline, because that's what a GFM table is. The extensions are TipTap's, so the
// schema carries the `tableRole` specs and cell attrs prosemirror-tables needs: without those, none
// of the table commands (add/delete a row or column, Tab between cells, dragging a cell selection)
// can run at all, which is why this used to be three hand-rolled nodes you could only type into.
//
//
// `align` (GFM's `|:---|---:|`) rides on the table node, as before. Column widths deliberately
// aren't a thing: `resizable: false`, because a markdown table has no widths to write them to and
// a control that silently loses its effect on save is worse than no control.
const TableWithAlign = TipTapTable.configure({ resizable: false }).extend({
  addAttributes() {
    return { ...this.parent?.(), align: { default: [] } };
  },
});
// Cells hold BLOCKS (TipTap's default), which is what lets you put a list in one. A GFM cell can't
// express that — it's a run of inline content — so the converter reconciles the two: an ordinary
// cell is one paragraph and serializes to exactly the text it always did, and a list serializes to
// the `<ul><li>…</li></ul>` MDX renders as a real list. See `cellBlocks` / `cellChildren` there.
const BlockTableCell = TipTapTableCell;
const BlockTableHeader = TipTapTableHeader;

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
 * The checkbox is a real `<input>`, built by a plain-DOM node view — the first version drew it in
 * CSS as an `::before`, which looked right and could not be clicked, because a pseudo-element is
 * not a thing you can put a pointer on. A plain bullet gets `contentDOM === li` (the default
 * rendering, no wrapper), so an ordinary list is untouched; only a task item grows the label and
 * the content div the input needs to sit outside of. Plain DOM rather than
 * `ReactNodeViewRenderer`, since a React root per bullet is exactly the cost worth avoiding.
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

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const li = document.createElement("li");
      const isTask = (n: ProseMirrorNode) => typeof n.attrs.checked === "boolean";

      // A plain bullet renders exactly as it would without a node view.
      if (!isTask(node)) {
        return { dom: li, contentDOM: li, update: (updated: ProseMirrorNode) => !isTask(updated) };
      }

      li.setAttribute("data-checked", String(node.attrs.checked));
      const label = document.createElement("label");
      // The input must live OUTSIDE contentDOM, or ProseMirror treats it as document content and
      // tries to map positions onto it. contentEditable=false also stops its clicks and its DOM
      // from being read back as edits.
      label.contentEditable = "false";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "pv-task-check";
      input.checked = node.attrs.checked;
      // Without this the mousedown moves the selection into the label before the click lands,
      // which blurs the editor and makes the caret jump on every toggle.
      input.addEventListener("mousedown", (event) => event.preventDefault());
      input.addEventListener("change", () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos === undefined || !editor.isEditable) {
          input.checked = !input.checked;
          return;
        }
        // Read the node back out of the CURRENT doc: the position is stale the moment anything
        // above this item changes, and writing `node.attrs` would resurrect the old attributes.
        const { state, view } = editor;
        const current = state.doc.nodeAt(pos);
        if (!current) return;
        view.dispatch(
          state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: input.checked }),
        );
      });
      label.append(input);

      const content = document.createElement("div");
      li.append(label, content);
      return {
        dom: li,
        contentDOM: content,
        // Everything outside contentDOM is chrome. Without this, toggling — which mutates
        // `data-checked` on the <li> — reads as a content change, and ProseMirror re-parses the
        // node view's DOM: the label and the content div come back as two blocks and the doc
        // grows a stray empty paragraph on every click.
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" && !content.contains(mutation.target),
        update: (updated: ProseMirrorNode) => {
          // Becoming (or ceasing to be) a task item changes the DOM shape, so let ProseMirror
          // rebuild it rather than trying to morph one into the other.
          if (!isTask(updated)) return false;
          li.setAttribute("data-checked", String(updated.attrs.checked));
          input.checked = updated.attrs.checked;
          return true;
        },
      };
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
  const tableView = opts.tableNodeView?.();
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
    tableView ? TableWithAlign.extend({ addNodeView: () => tableView }) : TableWithAlign,
    TipTapTableRow,
    BlockTableCell,
    BlockTableHeader,
    ...componentNodes,
    SelectAllScope,
    EdgeGuard,
    atomNode("mdxUnknownFlow", false, opts.atomNodeView?.("mdxUnknownFlow", false)),
    atomNode("mdxUnknownText", true, opts.atomNodeView?.("mdxUnknownText", true)),
  ];
}
