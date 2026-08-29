// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { mdxToProseMirror, proseMirrorToMdx } from "@papervine/mdx-prosemirror";
import { buildMdxExtensions } from "@/components/editor/visual/nodes";

// The edge guard's IN-CONTAINER actions, at the position that made them necessary: the first block
// of a component, where Backspace has nothing above to join with. `edge-guard-plan` decides
// *whether* to act; this is the other half — that the action the extension runs is real, legal at
// that spot, and leaves the component standing.
//
// jsdom rather than Playwright because it's the commands that were in question, not the keystroke:
// the browser case is covered once in editor.spec.ts, and these run everywhere in milliseconds.

/** Load MDX into a real editor and put the caret at the start of the deepest first textblock. */
function atStartOfFirstBlock(mdx: string): Editor {
  const editor = new Editor({ extensions: buildMdxExtensions(), content: mdxToProseMirror(mdx) });
  const { doc } = editor.state;
  let pos = 0;
  doc.descendants((node, at) => {
    if (pos || !node.isTextblock) return true;
    pos = at + 1;
    return false;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, pos)));
  return editor;
}

const ACCORDION = (body: string) => `<Accordion title="T">\n\n${body}\n\n</Accordion>\n`;

describe("what Backspace can do at a component's leading edge", () => {
  it("lifts a list item out of its list, without leaving the component", () => {
    const editor = atStartOfFirstBlock(ACCORDION("  - one\n  - two"));
    expect(editor.can().liftListItem("listItem")).toBe(true);
    editor.commands.liftListItem("listItem");
    const mdx = proseMirrorToMdx(editor.getJSON() as never);
    expect(mdx).toContain("<Accordion");
    expect(mdx).toContain("one");
    editor.destroy();
  });

  it("lifts a paragraph out of a blockquote, without leaving the component", () => {
    const editor = atStartOfFirstBlock(ACCORDION("  > quoted"));
    expect(editor.can().lift("blockquote"), "the quote can't be lifted here").toBe(true);
    editor.commands.lift("blockquote");
    const mdx = proseMirrorToMdx(editor.getJSON() as never);
    expect(mdx, "the quote survived the lift").not.toMatch(/^\s*>/m);
    expect(mdx).toContain("<Accordion");
    expect(mdx).toContain("quoted");
    editor.destroy();
  });

  it("turns an emptied code block back into a paragraph, in place", () => {
    const editor = atStartOfFirstBlock(ACCORDION("  ```js\n  \n  ```"));
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    expect(editor.commands.setNode("paragraph")).toBe(true);
    const mdx = proseMirrorToMdx(editor.getJSON() as never);
    expect(mdx, "the fence survived").not.toContain("```");
    expect(mdx).toContain("<Accordion");
    editor.destroy();
  });
});
