"use client";

import { useId, useState } from "react";
import { ChevronRight, FileText, GripVertical, Settings } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NavSection, NavLeaf, NavNode } from "@papervine/renderer/lib/nav";
import { NavAddMenu, type NavAddHandlers } from "./NavAddMenu";

// The editor's navigation panel (col 2) — the docs.json nav, draft-aware (built from the draft
// overlay server-side). Click a page to load it; a cog opens settings — pages open Page settings
// (frontmatter), groups open Group settings (docs.json). A group also gets a "+" (NavAddMenu):
// new page, add an existing page, new group, new tab. Rows can be DRAGGED to reorder — pages
// within or between groups, groups among their siblings. Every affordance here (cog, +, grip) is
// revealed on hover where the device has hover, and always visible where it doesn't.
//
// Still a follow-up: anchors and dropdowns (the schema REQUIRES an `href` on each, so they need a
// URL field, not just a name), and languages / versions / products, which wrap or duplicate a
// whole content tree rather than adding an item to one. Those belong in a structural docs.json
// editor, not this menu.

const hrefToSlug = (href: string) => href.replace(/^\//, "");

// Row affordances. Reveal-on-hover only where hover EXISTS: unconditional
// `opacity-0 group-hover:opacity-100` makes a control invisible AND unreachable on a touch
// device — there is no hover to trigger it. Keyed on the capability rather than a width
// breakpoint because a touch laptop at desktop width has the same problem. focus-visible keeps
// it keyboard-reachable on a hover device, where it's otherwise invisible while focused.
const AFFORDANCE =
  "shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-200 focus-visible:opacity-100 " +
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 dark:hover:bg-neutral-700";
const COG_CLASS = `pv-nav-cog ${AFFORDANCE}`;
const GRIP_CLASS = `pv-nav-grip cursor-grab active:cursor-grabbing ${AFFORDANCE}`;

// Drag ids carry the address, so dragEnd needs no lookup table. A page's id includes its index
// because the same slug may legitimately appear in more than one group — position is the
// identity, not the slug.
const pageId = (group: string, index: number) => `page::${group}::${index}`;
const groupId = (group: string) => `group::${group}`;

// Pages and groups are both sortable rows in one DndContext, and page rows are dense — so plain
// closestCenter resolves a dragged GROUP onto whichever page happens to be nearest, and the drop
// is silently ignored (a group can only land among groups). Restrict the candidates to the same
// kind first. A dragged page keeps both kinds as targets: dropping it on a group row is the only
// way into a group that has no pages yet.
const sameKindCollision: CollisionDetection = (args) => {
  const dragging = args.active.data.current?.type;
  const candidates =
    dragging === "group"
      ? args.droppableContainers.filter((c) => c.data.current?.type === "group")
      : args.droppableContainers;
  return closestCenter({ ...args, droppableContainers: candidates });
};

interface Handlers extends NavAddHandlers {
  activeSlug: string;
  onSelect: (slug: string) => void;
  onPageSettings: (slug: string) => void;
  onGroupSettings: (group: string) => void;
}

function Leaf({ leaf, h, group, index }: { leaf: NavLeaf; h: Handlers; group: string; index: number }) {
  const slug = hrefToSlug(leaf.href);
  const active = slug === h.activeSlug;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortableRow(
    pageId(group, index),
    { type: "page", group, index },
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      title={leaf.hidden ? "Hidden — not shown on the published site" : undefined}
      className={`group flex items-center rounded-md pr-1 ${leaf.hidden ? "opacity-40" : ""} ${
        isDragging ? "z-10 opacity-60" : ""
      } ${active ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"}`}
    >
      {/* A dedicated handle rather than a draggable row: a distance-activated row drag competes
          with scrolling the tree on a touch device, and with the click that opens the page. */}
      <button
        type="button"
        aria-label={`Reorder ${leaf.title}`}
        className={GRIP_CLASS}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => h.onSelect(slug)}
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm ${
          active ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="truncate">{leaf.title}</span>
      </button>
      <button
        type="button"
        aria-label="Page settings"
        onClick={() => h.onPageSettings(slug)}
        className={COG_CLASS}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** useSortable with the bits every row needs, and the data payload dragEnd reads. */
function useSortableRow(id: string, data: Record<string, unknown>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data });
  return { attributes, listeners, setNodeRef, transform, transition, isDragging };
}

function Node({ node, h, index }: { node: NavNode; h: Handlers; index: number }) {
  const [open, setOpen] = useState(true);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortableRow(
    groupId(node.group),
    { type: "group", group: node.group, index },
  );

  const leaves = node.items.filter((i): i is NavLeaf => "href" in i);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${node.hidden ? "opacity-40" : ""} ${isDragging ? "z-10 opacity-60" : ""}`}
    >
      <div
        className="group flex items-center pr-1"
        title={node.hidden ? "Hidden — not shown on the published site" : undefined}
      >
        <button
          type="button"
          aria-label={`Reorder ${node.group}`}
          className={GRIP_CLASS}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pr-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"
        >
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="truncate">{node.group}</span>
        </button>
        <NavAddMenu group={node.group} h={h} />
        <button
          type="button"
          aria-label="Group settings"
          onClick={() => h.onGroupSettings(node.group)}
          className={COG_CLASS}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="ml-2 border-l border-neutral-200 pl-2 dark:border-neutral-800">
          {/* One SortableContext per group: its page ids are the sortable set, so a drop inside
              this group reorders, and a drop on another group's row moves across. */}
          <SortableContext
            items={leaves.map((_, i) => pageId(node.group, i))}
            strategy={verticalListSortingStrategy}
          >
            <NodeList nodes={node.items} h={h} group={node.group} />
          </SortableContext>
        </div>
      )}
    </div>
  );
}

function NodeList({
  nodes,
  h,
  group,
}: {
  nodes: (NavLeaf | NavNode)[];
  h: Handlers;
  group: string | null;
}) {
  // Indices are per-kind: a page's index is its position among the group's PAGES (which is what
  // docs.json stores), not among mixed children.
  let pageIndex = -1;
  let groupIndex = -1;
  return (
    <div className="space-y-0.5">
      {nodes.map((n, i) => {
        if ("href" in n) {
          pageIndex += 1;
          return <Leaf key={i} leaf={n} h={h} group={group ?? ""} index={pageIndex} />;
        }
        groupIndex += 1;
        return <Node key={i} node={n} h={h} index={groupIndex} />;
      })}
    </div>
  );
}

export function NavTree({
  sections,
  activeSlug,
  onSelect,
  onPageSettings,
  onGroupSettings,
  onNewPage,
  onNewGroup,
  onNewTab,
  onAddExisting,
  onMovePage,
  onMoveGroup,
  unlistedSlugs,
  tabless,
}: {
  sections: NavSection[];
  activeSlug: string;
  onSelect: (slug: string) => void;
  onPageSettings: (slug: string) => void;
  onGroupSettings: (group: string) => void;
} & NavAddHandlers) {
  const h: Handlers = {
    activeSlug,
    onSelect,
    onPageSettings,
    onGroupSettings,
    onNewPage,
    onNewGroup,
    onNewTab,
    onAddExisting,
    onMovePage,
    onMoveGroup,
    unlistedSlugs,
    tabless,
  };

  // dnd-kit derives its screen-reader description element's id from a module-level counter, so
  // the server render and the client render disagree ("DndDescribedBy-0" vs "-1") — a hydration
  // mismatch that shows up ONLY in the console. Passing a stable useId() makes it deterministic.
  const dndId = useId();

  const sensors = useSensors(
    // A handle-initiated drag still wants a small threshold so a stray click on the grip isn't a
    // zero-distance "drag". Keyboard support comes free and matters: the grip is a real button,
    // so Space picks up and the arrows move.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const a = active.data.current as { type?: string; group?: string; index?: number } | undefined;
    const o = over.data.current as { type?: string; group?: string; index?: number } | undefined;
    if (!a || !o) return;

    if (a.type === "page") {
      // Dropping on a page targets its slot; dropping on a GROUP row appends to that group —
      // which is the only way to move a page into a group that has no pages yet.
      const to =
        o.type === "page"
          ? { group: o.group!, index: o.index! }
          : { group: o.group!, index: Number.MAX_SAFE_INTEGER };
      onMovePage({ group: a.group!, index: a.index! }, to);
      return;
    }
    if (a.type === "group" && o.type === "group") onMoveGroup(a.group!, o.index!);
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={sameKindCollision}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <nav className="space-y-3 p-2">
        {sections.map((s, i) => (
          <div key={i}>
            {s.tab && <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{s.tab}</div>}
            {/* Top-level groups of this tab are sortable among themselves. */}
            <SortableContext
              items={s.nodes.filter((n) => !("href" in n)).map((n) => groupId((n as NavNode).group))}
              strategy={verticalListSortingStrategy}
            >
              <NodeList nodes={s.nodes} h={h} group={null} />
            </SortableContext>
          </div>
        ))}
      </nav>
    </DndContext>
  );
}
