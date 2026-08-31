// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { buildMdxExtensions } from "@/components/editor/visual/nodes";
import { SLASH_ITEMS } from "@/components/editor/visual/menu-items";

// Every block the "+" picker and the slash menu can insert has to be a node the editor's schema
// actually accepts. Inserting the table proved it wasn't checked anywhere: `{ type: "tableCell" }`
// with no content threw `Invalid content for node tableCell: <>` at insert time — a cell holds
// BLOCKS, so it needs its paragraph — and the only place that surfaced was a runtime error in the
// user's face. There is nothing table-specific about the mistake, so this validates the whole
// catalogue rather than the one item that broke: `check()` is ProseMirror's own assertion that a
// node satisfies its content expression, which is exactly the failure.

const editor = new Editor({ extensions: buildMdxExtensions() });
const schema = editor.schema;

// Media items are handed a URL by the dialog before their node is built; everything else ignores
// the argument. A plausible value keeps those items testable rather than skipped.
const INPUT = "https://example.com/thing.mp4";

describe("every insertable slash item builds a schema-valid node", () => {
  for (const item of SLASH_ITEMS) {
    it(item.title, () => {
      const json = item.make(INPUT);
      // null is a legitimate answer (nothing to insert); the toggles use `command` instead.
      if (json === null) return;
      const node = PMNode.fromJSON(schema, json);
      expect(() => node.check()).not.toThrow();
    });
  }

  it("covers the catalogue, so an unrunnable list can't pass silently", () => {
    expect(SLASH_ITEMS.length).toBeGreaterThan(20);
  });
});

describe("the table the picker inserts", () => {
  it("is a 2x2 grid whose cells each hold a paragraph", () => {
    const item = SLASH_ITEMS.find((i) => i.title === "Table");
    expect(item, "no Table item in the catalogue").toBeTruthy();
    const node = PMNode.fromJSON(schema, item!.make()!);
    expect(node.type.name).toBe("table");
    expect(node.childCount).toBe(2);
    node.forEach((row) => {
      expect(row.childCount).toBe(2);
      row.forEach((cell) => {
        expect(cell.childCount).toBe(1);
        expect(cell.firstChild?.type.name).toBe("paragraph");
      });
    });
  });
});
