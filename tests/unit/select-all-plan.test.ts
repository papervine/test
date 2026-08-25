import { describe, expect, it } from "vitest";
import { nextSelectAllRange } from "../../src/components/editor/visual/select-all-plan";

// Innermost first, the way the extension collects them: a <Tab> inside a <Tabs>.
const TAB = { from: 12, to: 30 };
const TABS = { from: 10, to: 80 };
const CONTAINERS = [TAB, TABS];

describe("nextSelectAllRange", () => {
  it("scopes a bare caret to the innermost container", () => {
    expect(nextSelectAllRange(CONTAINERS, { from: 20, to: 20 })).toEqual(TAB);
  });

  it("scopes a partial selection to the innermost container", () => {
    expect(nextSelectAllRange(CONTAINERS, { from: 15, to: 22 })).toEqual(TAB);
  });

  it("widens on the next press, once the selection IS that container", () => {
    // This is the whole reason the extension normalizes candidates before comparing: if the
    // stored selection didn't match the candidate exactly, Mod-A would re-select the same range
    // forever and never reach the document.
    expect(nextSelectAllRange(CONTAINERS, TAB)).toEqual(TABS);
  });

  it("falls through once the outermost container is selected", () => {
    // null → the editor's built-in whole-document Select All runs, so it's never taken away.
    expect(nextSelectAllRange(CONTAINERS, TABS)).toBeNull();
  });

  it("widens rather than shrinking a selection that already spans two containers", () => {
    // Dragged from inside one tab into the next: the anchor's own tab does not contain the
    // selection, so scoping to it would make the user's selection smaller.
    expect(nextSelectAllRange(CONTAINERS, { from: 20, to: 55 })).toEqual(TABS);
  });

  it("falls through with no containers at all — a paragraph at the top level", () => {
    expect(nextSelectAllRange([], { from: 3, to: 3 })).toBeNull();
    expect(nextSelectAllRange([], { from: 3, to: 9 })).toBeNull();
  });

  it("skips a container that doesn't contain the selection and keeps looking outward", () => {
    const outer = { from: 0, to: 100 };
    expect(nextSelectAllRange([{ from: 60, to: 70 }, outer], { from: 20, to: 25 })).toEqual(outer);
  });

  it("returns null rather than a range that can't hold the selection", () => {
    expect(nextSelectAllRange([{ from: 60, to: 70 }], { from: 20, to: 25 })).toBeNull();
  });
});
