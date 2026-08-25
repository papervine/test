import { describe, expect, it } from "vitest";
import { blocksEdgeDelete } from "../../src/components/editor/visual/edge-guard-plan";

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
