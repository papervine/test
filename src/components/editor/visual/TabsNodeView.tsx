"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { GripHorizontal, Plus, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { activeAfterRemove, hiddenPaneRule, insertTargetForMove } from "./tabs-plan";

// A live <Tabs> in the Visual editor: a real tab strip you can click, rename, add to, remove
// from and reorder, with only the active tab's content editable beneath it.
//
// Tabs was one of the two components deliberately left as labelled chrome, because it "picks
// apart its children structurally" and ProseMirror gives a node view exactly ONE content hole.
// The way through: still render one hole holding every <Tab>, and hide the inactive ones in CSS.
// A scoped <style> keyed to this instance does that declaratively, which survives ProseMirror
// re-rendering its children — toggling classes from an effect would not. Selection stays inside
// the document, so typing, undo and the collab sync are untouched; "which tab is showing" is view
// state and lives in React, never in the doc.
//
// The position arithmetic behind add/remove/reorder lives in ./tabs-plan, pure and unit-tested.

// Same affordance rule as the navigation tree (NavTree.tsx): reveal on hover only where hover
// EXISTS, since an unconditional `opacity-0 group-hover:opacity-100` leaves the handle invisible
// AND unreachable on a touch device. Keyed on the capability, not a width breakpoint — a touch
// laptop at desktop width has the same problem. focus-visible keeps it keyboard-reachable.
const GRIP_CLASS =
  "cursor-grab rounded px-1 text-[var(--muted)] transition-opacity active:cursor-grabbing " +
  "hover:bg-[rgba(var(--ink-rgb),0.08)] hover:text-[var(--fg)] focus-visible:opacity-100 " +
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100";

type TabInfo = {
  title: string;
  pos: number; // absolute document position of the <Tab> node
  size: number;
  domIndex: number; // index among ALL children, since <Tabs> permits stray non-Tab content
};

// NOT useId(): TipTap mounts every node view in its own React root, and useId() restarts its
// counter per root — so two <Tabs> on a page both got ":r0:", their scoped rules matched each
// other's panes, and between them they hid every tab. A module counter is unique across roots,
// and node views only ever render in the browser, so there's no SSR sequence to match.
let nextScopeId = 0;

export function TabsNodeView({ node, editor, getPos }: NodeViewProps) {
  const [scopeId] = useState(() => `pvtabs${(nextScopeId++).toString(36)}`);
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);

  // Recomputed every render: an edit anywhere earlier in the document shifts these, so a cached
  // position is stale the moment anything else changes.
  // getPos() returns undefined once the node view is detached (its node left the document).
  const base = typeof getPos === "function" ? getPos() : undefined;
  const tabs: TabInfo[] = [];
  let childIndex = 0;
  node.forEach((child, offset) => {
    const domIndex = childIndex++;
    if (child.type.name !== "tab" || base === undefined) return;
    tabs.push({
      title: (child.attrs.title as string) || `Tab ${tabs.length + 1}`,
      pos: base + 1 + offset,
      size: child.nodeSize,
      domIndex,
    });
  });

  const current = Math.min(active, Math.max(0, tabs.length - 1));
  const showIndex = tabs[current]?.domIndex ?? 0;

  const addTab = () => {
    if (base === undefined) return;
    const type = editor.schema.nodes.tab;
    if (!type) return;
    const fresh = type.create(
      { mdxName: "Tab", title: `Tab ${tabs.length + 1}` },
      editor.schema.nodes.paragraph.create(),
    );
    // Just inside the closing token, so the new tab lands last.
    editor.view.dispatch(editor.state.tr.insert(base + node.nodeSize - 1, fresh));
    setActive(tabs.length);
  };

  const removeTab = (i: number) => {
    const t = tabs[i];
    // Refuse the last one: a <Tabs> with no <Tab> renders as nothing and can't be recovered from
    // the strip. Deleting the whole block is what the block drag handle's menu is for.
    if (!t || tabs.length <= 1) return;
    editor.view.dispatch(editor.state.tr.delete(t.pos, t.pos + t.size));
    setActive((a) => activeAfterRemove(a, tabs.length));
  };

  const renameTab = (i: number, title: string) => {
    const t = tabs[i];
    if (!t) return;
    const child = editor.state.doc.nodeAt(t.pos);
    if (!child) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(t.pos, undefined, {
        ...child.attrs,
        title: title.trim() || `Tab ${i + 1}`,
      }),
    );
  };

  const moveTab = (from: number, to: number) => {
    const target = insertTargetForMove(tabs, from, to);
    const src = tabs[from];
    if (target === null || !src) return;
    const child = editor.state.doc.nodeAt(src.pos);
    if (!child) return;
    // Cut first, then map the target through that deletion — the plan works in pre-cut
    // coordinates, and the mapping is what turns them into post-cut ones.
    const tr = editor.state.tr.delete(src.pos, src.pos + src.size);
    tr.insert(tr.mapping.map(target), child.copy(child.content));
    editor.view.dispatch(tr);
    setActive(to);
  };

  const sensors = useSensors(
    // A small threshold, so a plain click still selects the tab instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const from = Number(e.active.id);
    const to = e.over ? Number(e.over.id) : from;
    if (Number.isInteger(from) && Number.isInteger(to)) moveTab(from, to);
  }

  return (
    <NodeViewWrapper className="my-5">
      {/* contentEditable={false}: the strip is chrome, not document content. Without it
          ProseMirror reads clicks and keystrokes in here as edits to the doc. */}
      <div
        contentEditable={false}
        className="flex items-end gap-2 border-b border-[rgba(var(--ink-rgb),0.12)]"
      >
        <style>{hiddenPaneRule(scopeId, showIndex + 1)}</style>
        <DndContext
          id={scopeId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={tabs.map((_, i) => i)} strategy={horizontalListSortingStrategy}>
            <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
              {tabs.map((t, i) => (
                <SortableTab
                  key={i}
                  index={i}
                  title={t.title}
                  active={i === current}
                  renaming={renaming === i}
                  canRemove={tabs.length > 1}
                  onSelect={() => setActive(i)}
                  onStartRename={() => setRenaming(i)}
                  onCommitRename={(v) => {
                    renameTab(i, v);
                    setRenaming(null);
                  }}
                  onCancelRename={() => setRenaming(null)}
                  onRemove={() => removeTab(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <button
          type="button"
          onClick={addTab}
          aria-label="Add tab"
          title="Add tab"
          className="mb-1 shrink-0 rounded p-1 text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)] hover:text-[var(--fg)]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* One content hole holding every <Tab>; the rule above shows only the active one. */}
      <NodeViewContent data-pv-tabs={scopeId} className="pt-3" />
    </NodeViewWrapper>
  );
}

/** A single <Tab>: a plain editable pane, marked so the strip above can show one at a time. */
export function TabPaneNodeView() {
  return (
    <NodeViewWrapper data-pv-tab="">
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

function SortableTab({
  index,
  title,
  active,
  renaming,
  canRemove,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRemove,
}: {
  index: number;
  title: string;
  active: boolean;
  renaming: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: index,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group flex shrink-0 flex-col items-center ${isDragging ? "opacity-60" : ""}`}
    >
      {/* A dedicated handle above the tab rather than a draggable label, for the same reason the
          navigation tree uses one: a distance-activated drag on the label competes with the click
          that selects the tab and the double-click that renames it. The row is always laid out
          (opacity, not display) so revealing the grip never shifts the strip. */}
      <button
        type="button"
        aria-label={`Reorder ${title}`}
        title="Drag to reorder"
        className={GRIP_CLASS}
        {...attributes}
        {...listeners}
      >
        <GripHorizontal className="h-3.5 w-3.5" />
      </button>
      <div
        className={`flex items-center gap-1 border-b-2 px-2 pb-1.5 text-sm ${
          active
            ? "border-[var(--fg)] font-medium text-[var(--fg)]"
            : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
        }`}
      >
        {renaming ? (
          <input
            autoFocus
            defaultValue={title}
            aria-label="Tab title"
            onBlur={(e) => onCommitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onCancelRename();
            }}
            className="w-28 rounded bg-transparent px-1 outline-none ring-1 ring-[rgba(var(--ink-rgb),0.2)]"
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={onStartRename}
            title="Double-click to rename"
            className="whitespace-nowrap bg-transparent"
          >
            {title}
          </button>
        )}
        {/* Only the active tab offers removal, so a stray click never deletes a tab you aren't
            looking at. Absent entirely when it's the last one — see removeTab. */}
        {active && canRemove && !renaming && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${title}`}
            className="rounded p-0.5 text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.08)] hover:text-[var(--fg)]"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
