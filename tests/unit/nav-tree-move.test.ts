import { describe, it, expect } from "vitest";
import type { NavSection, NavLeaf, NavNode } from "@papervine/renderer/lib/nav";
import { moveLeafInSections, moveGroupInSections } from "@/lib/nav-tree-move";

// The optimistic half of nav drag-and-drop: the same move applied to the BUILT tree so the drop
// lands instantly, while the server writes docs.json. These must agree with nav-edit's index
// semantics — a page's index counts only pages, a group's only groups — or the row would jump
// to one slot and then settle in another when the server data arrives.

const leaf = (title: string): NavLeaf => ({ title, href: `/${title.toLowerCase()}` });
const group = (name: string, items: (NavLeaf | NavNode)[]): NavNode => ({ group: name, items });

const tree = (): NavSection[] => [
  {
    tab: "Docs",
    hrefs: [],
    nodes: [
      group("A", [leaf("a1"), leaf("a2"), leaf("a3")]),
      group("B", [leaf("b1")]),
      group("Empty", []),
    ],
  },
];

const titles = (s: NavSection[], g: string): string[] => {
  const found = findGroup(s, g);
  return (found?.items ?? []).filter((i): i is NavLeaf => "href" in i).map((l) => l.title);
};
const findGroup = (s: NavSection[], name: string): NavNode | null => {
  const walk = (items: (NavLeaf | NavNode)[]): NavNode | null => {
    for (const i of items) {
      if ("href" in i) continue;
      if (i.group === name) return i;
      const hit = walk(i.items);
      if (hit) return hit;
    }
    return null;
  };
  return walk(s.flatMap((x) => x.nodes));
};
const groupNames = (s: NavSection[]): string[] =>
  s[0].nodes.filter((n): n is NavNode => !("href" in n)).map((n) => n.group);

describe("moveLeafInSections", () => {
  it("reorders within a group", () => {
    const out = moveLeafInSections(tree(), { group: "A", index: 0 }, { group: "A", index: 2 });
    expect(titles(out, "A")).toEqual(["a2", "a3", "a1"]);
  });

  it("reorders upward", () => {
    const out = moveLeafInSections(tree(), { group: "A", index: 2 }, { group: "A", index: 0 });
    expect(titles(out, "A")).toEqual(["a3", "a1", "a2"]);
  });

  it("moves a page to another group at the requested slot", () => {
    const out = moveLeafInSections(tree(), { group: "A", index: 1 }, { group: "B", index: 0 });
    expect(titles(out, "A")).toEqual(["a1", "a3"]);
    expect(titles(out, "B")).toEqual(["a2", "b1"]);
  });

  it("moves into a group with no pages", () => {
    const out = moveLeafInSections(tree(), { group: "A", index: 0 }, { group: "Empty", index: 0 });
    expect(titles(out, "Empty")).toEqual(["a1"]);
    expect(titles(out, "A")).toEqual(["a2", "a3"]);
  });

  it("clamps an index past the end, matching the server's clamp", () => {
    const out = moveLeafInSections(tree(), { group: "A", index: 0 }, { group: "A", index: 99 });
    expect(titles(out, "A")).toEqual(["a2", "a3", "a1"]);
  });

  it("never loses a page", () => {
    const before = tree();
    const count = (s: NavSection[]) =>
      ["A", "B", "Empty"].reduce((n, g) => n + titles(s, g).length, 0);
    const out = moveLeafInSections(before, { group: "A", index: 2 }, { group: "Empty", index: 0 });
    expect(count(out)).toBe(count(before));
  });

  it("leaves the tree untouched for an out-of-range address", () => {
    const before = tree();
    expect(moveLeafInSections(before, { group: "A", index: 9 }, { group: "B", index: 0 })).toBe(before);
    expect(moveLeafInSections(before, { group: "Ghost", index: 0 }, { group: "B", index: 0 })).toBe(before);
  });

  it("does not mutate the input", () => {
    const before = tree();
    moveLeafInSections(before, { group: "A", index: 0 }, { group: "B", index: 0 });
    expect(titles(before, "A")).toEqual(["a1", "a2", "a3"]);
    expect(titles(before, "B")).toEqual(["b1"]);
  });

  // A group holding both pages and subgroups: the page index must count pages only, or a move
  // would land relative to the wrong children.
  it("counts only pages when a group also holds subgroups", () => {
    const mixed: NavSection[] = [
      { tab: undefined, hrefs: [], nodes: [group("M", [group("sub", []), leaf("p1"), leaf("p2")])] },
    ];
    const out = moveLeafInSections(mixed, { group: "M", index: 0 }, { group: "M", index: 1 });
    expect(titles(out, "M")).toEqual(["p2", "p1"]);
    // The subgroup survives the rebuild.
    expect(findGroup(out, "sub")).not.toBeNull();
  });
});

describe("moveGroupInSections", () => {
  it("moves a group down and up", () => {
    expect(groupNames(moveGroupInSections(tree(), "A", 2))).toEqual(["B", "Empty", "A"]);
    expect(groupNames(moveGroupInSections(tree(), "Empty", 0))).toEqual(["Empty", "A", "B"]);
  });

  it("clamps past the end", () => {
    expect(groupNames(moveGroupInSections(tree(), "A", 99))).toEqual(["B", "Empty", "A"]);
  });

  it("reorders a nested subgroup among its own siblings, not the top level", () => {
    const nested: NavSection[] = [
      {
        tab: undefined,
        hrefs: [],
        nodes: [group("P", [group("c1", []), group("c2", [])]), group("Q", [])],
      },
    ];
    const out = moveGroupInSections(nested, "c2", 0);
    const p = findGroup(out, "P")!;
    expect((p.items as NavNode[]).map((g) => g.group)).toEqual(["c2", "c1"]);
    expect(groupNames(out)).toEqual(["P", "Q"]);
  });

  it("keeps leaves in place when reordering the groups around them", () => {
    const mixed: NavSection[] = [
      { tab: undefined, hrefs: [], nodes: [leaf("top"), group("A", []), group("B", [])] },
    ];
    const out = moveGroupInSections(mixed, "B", 0);
    expect(out[0].nodes.map((n) => ("href" in n ? n.title : n.group))).toEqual(["top", "B", "A"]);
  });

  it("returns an unchanged shape for an unknown group", () => {
    expect(groupNames(moveGroupInSections(tree(), "Ghost", 0))).toEqual(["A", "B", "Empty"]);
  });

  it("does not mutate the input", () => {
    const before = tree();
    moveGroupInSections(before, "A", 2);
    expect(groupNames(before)).toEqual(["A", "B", "Empty"]);
  });
});
