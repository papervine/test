import { describe, expect, it } from "vitest";
import {
  blocksEdgeDelete,
  edgeDeleteAction,
  guardsCodeGroupTab,
} from "../../src/components/editor/visual/edge-guard-plan";

// A <Tab> whose editable content spans 12..30, inside a <Tabs> spanning 10..80 — innermost first,
// the order enclosingContainers returns.
const TAB = { from: 12, to: 30 };
const TABS = { from: 10, to: 80 };
const CONTAINERS = [TAB, TABS];

const caret = (at: number) => ({ from: at, to: at });

describe("blocksEdgeDelete", () => {
  it("swallows Backspace on the leading edge — the press that used to destroy the tab", () => {
    expect(blocksEdgeDelete(CONTAINERS, caret(TAB.from), "backward")).toBe(true);
  });

  it("swallows Delete on the trailing edge, which pulls the next block IN", () => {
    expect(blocksEdgeDelete(CONTAINERS, caret(TAB.to), "forward")).toBe(true);
  });

  it("leaves every ordinary delete alone", () => {
    // Mid-content: there's a character to remove, so this is a normal keystroke.
    expect(blocksEdgeDelete(CONTAINERS, caret(20), "backward")).toBe(false);
    expect(blocksEdgeDelete(CONTAINERS, caret(20), "forward")).toBe(false);
    // Outside any component entirely.
    expect(blocksEdgeDelete([], caret(5), "backward")).toBe(false);
  });

  it("only blocks the direction that would escape", () => {
    // At the start, Delete removes the first character — that's forward, into the content.
    expect(blocksEdgeDelete(CONTAINERS, caret(TAB.from), "forward")).toBe(false);
    // At the end, Backspace removes the last character.
    expect(blocksEdgeDelete(CONTAINERS, caret(TAB.to), "backward")).toBe(false);
  });

  it("blocks at an outer container's edge too", () => {
    // The cursor can sit on the <Tabs> edge without being on a <Tab>'s — escaping either one
    // destroys structure.
    expect(blocksEdgeDelete(CONTAINERS, caret(TABS.from), "backward")).toBe(true);
    expect(blocksEdgeDelete(CONTAINERS, caret(TABS.to), "forward")).toBe(true);
  });

  it("never blocks a real selection — deleting one is deliberate", () => {
    // Selecting the tab's contents and pressing Backspace should clear them, and selecting across
    // a component and deleting is a considered act, not a slip.
    expect(blocksEdgeDelete(CONTAINERS, { from: TAB.from, to: TAB.to }, "backward")).toBe(false);
    expect(blocksEdgeDelete(CONTAINERS, { from: 5, to: 40 }, "backward")).toBe(false);
  });
});

// Guarding the edge is right; treating it as "nothing can happen here" is not. What Backspace means
// at the start of a block is usually "strip this block's formatting" — unwrap the list item, leave
// the quote, turn an emptied code fence back into a paragraph — and each of those stays inside the
// component. Blocking them made a component the one place those blocks couldn't be undone.
describe("edgeDeleteAction", () => {
  it("runs the in-container action instead of swallowing the key at the leading edge", () => {
    expect(edgeDeleteAction(CONTAINERS, caret(TAB.from), "backward", true)).toBe("handle");
  });

  it("still blocks there when there is nothing to strip — the tab must survive", () => {
    expect(edgeDeleteAction(CONTAINERS, caret(TAB.from), "backward", false)).toBe("block");
  });

  it("gives forward Delete no such escape: it pulls the NEXT block in either way", () => {
    expect(edgeDeleteAction(CONTAINERS, caret(TAB.to), "forward", true)).toBe("block");
  });

  it("leaves every ordinary delete to the editor", () => {
    expect(edgeDeleteAction(CONTAINERS, caret(20), "backward", true)).toBe("allow");
    expect(edgeDeleteAction(CONTAINERS, caret(20), "forward", false)).toBe("allow");
    // A selection is a deliberate delete — including one that starts on the edge.
    expect(edgeDeleteAction(CONTAINERS, { from: TAB.from, to: TAB.to }, "backward", true)).toBe(
      "allow",
    );
  });
});

// A <CodeGroup> tab is a code block whose parent is the group. Every default for a delete key at
// its edge destroyed the tab (an empty one became a paragraph and left the strip; a full one was
// joined with its neighbour), so the rule is blunt on purpose: at the edge, inside a group, nothing.
describe("guardsCodeGroupTab", () => {
  const tab = { type: "codeBlock", parentType: "codeGroup" };
  const at = (offset: number, size: number, empty = true) => ({ offset, size, empty });

  it("swallows Backspace at the start of a tab, empty or not", () => {
    expect(guardsCodeGroupTab(tab, at(0, 0), "backward")).toBe(true);
    expect(guardsCodeGroupTab(tab, at(0, 12), "backward")).toBe(true);
  });

  it("swallows Delete at the end of a tab", () => {
    expect(guardsCodeGroupTab(tab, at(12, 12), "forward")).toBe(true);
    expect(guardsCodeGroupTab(tab, at(0, 0), "forward")).toBe(true);
  });

  it("lets a delete inside the tab's text run — that's editing code, not structure", () => {
    expect(guardsCodeGroupTab(tab, at(5, 12), "backward")).toBe(false);
    expect(guardsCodeGroupTab(tab, at(5, 12), "forward")).toBe(false);
    // The far edge for each direction is an ordinary character delete too.
    expect(guardsCodeGroupTab(tab, at(12, 12), "backward")).toBe(false);
    expect(guardsCodeGroupTab(tab, at(0, 12), "forward")).toBe(false);
  });

  it("lets a real selection delete — the user picked what to remove", () => {
    expect(guardsCodeGroupTab(tab, at(0, 12, false), "backward")).toBe(false);
  });

  it("only applies to a code block INSIDE a group", () => {
    const backspace = (block: { type: string; parentType: string | null }) =>
      guardsCodeGroupTab(block, at(0, 0), "backward");
    expect(backspace({ type: "codeBlock", parentType: "accordion" })).toBe(false);
    expect(backspace({ type: "codeBlock", parentType: null })).toBe(false);
    expect(backspace({ type: "paragraph", parentType: "codeGroup" })).toBe(false);
  });
});
