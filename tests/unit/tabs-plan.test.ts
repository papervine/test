import { describe, expect, it } from "vitest";
import {
  activeAfterRemove,
  hiddenPaneRule,
  insertTargetForMove,
  type TabSlot,
} from "../../src/components/editor/visual/tabs-plan";

// Three <Tab>s of different sizes, laid out the way ProseMirror would: each starts where the
// previous one ended. Uneven sizes are the point — equal sizes would let an off-by-one in the
// rightward case pass by coincidence.
const TABS: TabSlot[] = [
  { pos: 1, size: 10 },
  { pos: 11, size: 6 },
  { pos: 17, size: 20 },
];

describe("insertTargetForMove", () => {
  it("targets the far side of the destination when moving rightwards", () => {
    // 0 → 2 lands after the third tab, i.e. at its end (17 + 20). Targeting dest.pos (17) would
    // put the dragged tab BEFORE the destination once the cut shifted everything left.
    expect(insertTargetForMove(TABS, 0, 2)).toBe(37);
    expect(insertTargetForMove(TABS, 0, 1)).toBe(17);
  });

  it("targets the near side of the destination when moving leftwards", () => {
    expect(insertTargetForMove(TABS, 2, 0)).toBe(1);
    expect(insertTargetForMove(TABS, 2, 1)).toBe(11);
  });

  it("is a no-op for a drag that ends where it started", () => {
    expect(insertTargetForMove(TABS, 1, 1)).toBeNull();
  });

  it("refuses indices that don't name a tab", () => {
    expect(insertTargetForMove(TABS, 0, 3)).toBeNull();
    expect(insertTargetForMove(TABS, -1, 0)).toBeNull();
    expect(insertTargetForMove([], 0, 1)).toBeNull();
  });
});

describe("activeAfterRemove", () => {
  it("keeps the index, so the tab that slid into place is shown", () => {
    expect(activeAfterRemove(0, 3)).toBe(0);
    expect(activeAfterRemove(1, 3)).toBe(1);
  });

  it("steps back when the removed tab was last", () => {
    expect(activeAfterRemove(2, 3)).toBe(1);
    expect(activeAfterRemove(1, 2)).toBe(0);
  });

  it("never goes negative when the strip is down to one", () => {
    expect(activeAfterRemove(0, 1)).toBe(0);
  });
});

describe("hiddenPaneRule", () => {
  it("hides every pane but the nth, scoped to one <Tabs>", () => {
    const rule = hiddenPaneRule("x1", 2);
    expect(rule).toContain('[data-pv-tabs="x1"]');
    expect(rule).toContain(":not(:nth-child(2))");
    expect(rule).toContain("display: none");
  });

  it("walks TipTap's content wrapper as direct children, so it can't reach a nested Tabs", () => {
    // Every hop must be `>`; a descendant combinator here would hide panes of a <Tabs> nested
    // inside one of this strip's own tabs.
    expect(hiddenPaneRule("x1", 1)).toContain(
      '[data-pv-tabs="x1"] > [data-node-view-content-react] > :is(',
    );
  });

  it("matches the pane's wrapper as well as the pane", () => {
    // TipTap gives each child node view its own .react-renderer div, so the element that has to
    // take `display: none` is the wrapper — targeting only [data-pv-tab] hides nothing.
    const rule = hiddenPaneRule("x1", 1);
    expect(rule).toContain(":has(> [data-pv-tab])");
    expect(rule).toContain("[data-pv-tab],");
  });

  it("scopes by id, so two strips on one page don't hide each other's panes", () => {
    expect(hiddenPaneRule("a", 1)).not.toBe(hiddenPaneRule("b", 1));
  });
});
