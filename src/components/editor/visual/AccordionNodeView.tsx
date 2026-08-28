"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Plus, X } from "lucide-react";
import { Accordion, AccordionGroup } from "@papervine/renderer/components/mdx/editor-registry";

// <AccordionGroup> and <Accordion> in the Visual editor: the REAL components, with the three
// things editing one needs handed into them — a field to type the title in, a toggle the editor
// owns, and a body that stays mounted while it's closed.
//
// Handing controls in rather than rebuilding the markup is the same call StepsNodeView makes, and
// the reason is the same: a copy of the classes drifts the day the component is restyled, and this
// pane's whole promise is that it looks like the published page. `Accordion` grew `title:
// ReactNode`, `open`/`onToggle` and `keepMounted` for exactly this — see the note there.
//
// What the editor keeps for itself is open/closed, which is *view* state: collapsing a section
// while you write says nothing about what a reader gets, so it never touches `defaultOpen` and is
// never saved — the same line the tab strip draws for "which tab is showing".

/** The group is the real component; it draws the border and flattens the rows inside it. */
export function AccordionGroupNodeView() {
  return (
    <NodeViewWrapper className="pv-visual-node">
      <AccordionGroup>
        <NodeViewContent />
      </AccordionGroup>
    </NodeViewWrapper>
  );
}

/** A row: the real <Accordion>, with the title slot carrying a field and the row's controls. */
export function AccordionNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  // Starts open so nothing arrives hidden: a row whose body you can't see is a row you can't edit,
  // and that was the reason the old view forced every accordion open in the first place.
  const [open, setOpen] = useState(true);
  const title = (node.attrs.title as string | null) ?? "";

  // undefined once the node view is detached (its node left the document).
  const base = typeof getPos === "function" ? getPos() : undefined;
  const parent = base === undefined ? null : editor.state.doc.resolve(base).parent;
  // Add and remove are operations on a LIST, so they're offered inside a group only — a standalone
  // accordion is one block, added to and deleted the way any block is, from the drag handle. And
  // the last row of a group keeps its ✕ hidden: a group with nothing in it renders as nothing and
  // can't be recovered from. Same rule as the tab strip's ×.
  const inGroup = parent?.type.name === "accordionGroup";
  const canRemove = inGroup && parent.childCount > 1;

  // Committed on every keystroke rather than on blur, so the title is in the document — and
  // therefore in the autosaved draft — even if the page is switched mid-word. Safe to do per key:
  // an attrs-only change lets TipTap update the existing node view instead of recreating it, so
  // the input keeps its DOM node and its caret. Empty commits back to null, so it serializes as
  // `<Accordion />`, never `title=""`.
  const commit = (value: string) => updateAttributes({ title: value.trim() === "" ? null : value });

  /** Insert a sibling directly below this row, and put the caret in its name. */
  const addBelow = () => {
    const type = editor.schema.nodes.accordion;
    if (base === undefined || !type) return;
    const at = base + node.nodeSize;
    // No `title` attr: it defaults to null and serializes away, so an untitled row round-trips as
    // `<Accordion />` rather than a title nobody chose. The slot to type it into is rendered
    // regardless — see the input below.
    editor.view.dispatch(
      editor.state.tr.insert(
        at,
        type.create({ mdxName: "Accordion" }, editor.schema.nodes.paragraph.create()),
      ),
    );
    requestAnimationFrame(() => {
      // nodeDOM addresses the inserted node directly, rather than guessing that the last title
      // field on the page is the right one.
      const dom = editor.view.nodeDOM(at);
      const field = dom instanceof HTMLElement ? dom.querySelector("input") : null;
      if (field) field.focus();
    });
  };

  const remove = () => {
    if (base === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(base, base + node.nodeSize));
  };

  // Enter in the title moves into the body — an accordion is a heading then what's under it, and
  // that's the order you write it in.
  const toBody = () => {
    if (base === undefined) return;
    setOpen(true);
    const { doc } = editor.state;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(base + 2, doc.content.size)))),
    );
    editor.view.focus();
  };

  return (
    <NodeViewWrapper className="pv-visual-node">
      <Accordion
        open={open}
        onToggle={() => setOpen((o) => !o)}
        keepMounted
        title={
          // contentEditable={false}: chrome, not document content — without it ProseMirror reads
          // clicks and keystrokes in here as edits to the doc. `group` is what the row's hover
          // controls reveal against.
          <span contentEditable={false} className="group flex min-w-0 flex-1 items-center gap-2">
            {/* Always rendered, so an untitled row still shows somewhere to put a name. */}
            <input
              value={title}
              placeholder="Accordion title"
              aria-label="Accordion title"
              onChange={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  toBody();
                }
              }}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:font-normal placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
            {inGroup && (
              <RowButton
                label={`Add an accordion below ${title || "this one"}`}
                hint="Add accordion below"
                onClick={addBelow}
              >
                <Plus className="h-3.5 w-3.5" />
              </RowButton>
            )}
            {canRemove && (
              <RowButton label={`Remove ${title || "accordion"}`} hint="Remove accordion" onClick={remove}>
                <X className="h-3.5 w-3.5" />
              </RowButton>
            )}
          </span>
        }
      >
        <NodeViewContent className="pv-accordion-body" />
      </Accordion>
    </NodeViewWrapper>
  );
}

/**
 * Same affordance rule as the tab strip and the nav tree: reveal on hover only where hover EXISTS,
 * since a bare `opacity-0 group-hover:opacity-100` leaves the control invisible AND unreachable on
 * a touch device. focus-visible keeps it keyboard-reachable either way.
 */
function RowButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hint}
      className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:opacity-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
    >
      {children}
    </button>
  );
}
