import type { NavSection, NavLeaf, NavNode } from "@papervine/renderer/lib/nav";

// Optimistic counterparts to nav-edit's docs.json mutations, applied to the BUILT tree
// (NavSection[]) that the editor's nav panel renders. Two shapes for the same move, on purpose:
// docs.json is the source of truth the server writes, and NavSection[] is what's on screen — a
// drag has to update the screen immediately and let the server catch up.
//
// The index semantics match nav-edit exactly, or the optimistic result and the server result
// would disagree: a page's index is its position among its group's PAGES (leaves), and a group's
// index is its position among its sibling GROUPS. Both ignore the other kind.
//
// Pure and immutable — the caller feeds the result to useOptimistic, which needs a new value
// rather than a mutated one.

const isLeaf = (n: NavLeaf | NavNode): n is NavLeaf => "href" in n;

/** Splice a leaf out of one group and into another (or the same one, to reorder). */
export function moveLeafInSections(
  sections: NavSection[],
  from: { group: string; index: number },
  to: { group: string; index: number },
): NavSection[] {
  let cut: NavLeaf | null = null;

  // Pass 1: remove. Done first so a same-group move computes its target against the shortened
  // list, exactly as the server's splice does.
  const removed = mapGroups(sections, (node) => {
    if (node.group !== from.group) return node;
    const leaves = node.items.filter(isLeaf);
    const target = leaves[from.index];
    if (!target) return node;
    cut = target;
    return { ...node, items: node.items.filter((i) => i !== target) };
  });
  if (!cut) return sections; // nothing at that address — leave the tree alone

  // Pass 2: insert at the requested slot among the destination's leaves.
  return mapGroups(removed, (node) => {
    if (node.group !== to.group) return node;
    const items = [...node.items];
    const leafPositions = items.flatMap((item, i) => (isLeaf(item) ? [i] : []));
    const at =
      to.index >= leafPositions.length
        ? // Past the last page: after it, or at the very front of a group that has none.
          (leafPositions.at(-1) ?? -1) + 1
        : leafPositions[to.index];
    items.splice(at, 0, cut!);
    return { ...node, items };
  });
}

/** Reorder a group among its immediate siblings, at whatever depth it lives. */
export function moveGroupInSections(
  sections: NavSection[],
  group: string,
  toIndex: number,
): NavSection[] {
  const reorder = (items: (NavLeaf | NavNode)[]): (NavLeaf | NavNode)[] => {
    const groups = items.filter((i): i is NavNode => !isLeaf(i));
    const found = groups.findIndex((g) => g.group === group);

    if (found >= 0) {
      // Rebuild this level: keep leaves where they are, lay the groups out in the new order.
      const next = [...groups];
      const [moved] = next.splice(found, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
      let g = 0;
      return items.map((item) => (isLeaf(item) ? item : next[g++]));
    }
    // Not at this level — recurse, so a nested subgroup reorders among ITS siblings.
    return items.map((item) =>
      isLeaf(item) ? item : { ...item, items: reorder(item.items) },
    );
  };
  return sections.map((s) => ({ ...s, nodes: reorder(s.nodes) }));
}

/** Apply `fn` to every group node in the tree, depth-first, rebuilding immutably. */
function mapGroups(sections: NavSection[], fn: (node: NavNode) => NavNode): NavSection[] {
  const walk = (items: (NavLeaf | NavNode)[]): (NavLeaf | NavNode)[] =>
    items.map((item) => {
      if (isLeaf(item)) return item;
      const mapped = fn(item);
      return { ...mapped, items: walk(mapped.items) };
    });
  return sections.map((s) => ({ ...s, nodes: walk(s.nodes) }));
}
