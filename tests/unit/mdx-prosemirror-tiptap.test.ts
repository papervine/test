// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { mdxToProseMirror, proseMirrorToMdx } from "@papervine/mdx-prosemirror";
import { buildMdxExtensions } from "@/components/editor/visual/nodes";

// Proves the TipTap schema is compatible with the converter: loading mdxToProseMirror() into a
// real editor and reading editor.getJSON() back through proseMirrorToMdx() must equal the pure
// converter round-trip. If a node type / attr / content spec diverges, ProseMirror drops or
// coerces it here and the assertion fails. This is the Phase-2 schema gate.

const norm = (mdx: string) => proseMirrorToMdx(mdxToProseMirror(mdx));

function throughEditor(mdx: string): string {
  const editor = new Editor({ extensions: buildMdxExtensions(), content: mdxToProseMirror(mdx) });
  const out = proseMirrorToMdx(editor.getJSON() as never);
  editor.destroy();
  return out;
}

describe("TipTap schema round-trips converter output unchanged", () => {
  const cases: Record<string, string> = {
    headings: "# H1\n\n## H2\n",
    emphasis: "Some **bold**, _italic_, `code`, ~~struck~~ text.\n",
    "bold with inline code": "It has **no `deploy` and no `login`**.\n",
    link: "See [docs](https://example.com) and [titled](https://x.com \"T\").\n",
    "bullet list": "- one\n- two\n",
    "task list": "- [ ] todo\n- [x] done\n- plain\n",
    "ordered list": "1. first\n2. second\n",
    blockquote: "> quoted\n",
    "code fence": "```ts\nconst x = 1;\n```\n",
    "code fence with meta": "```js title.js\nfoo();\n```\n",
    "thematic break": "a\n\n---\n\nb\n",
    table: "| a | b |\n| - | - |\n| 1 | 2 |\n",
    image: "![alt](/x.png)\n",
    Note: "<Note>\n  Heads up.\n</Note>\n",
    Card: '<Card title="Setup" icon="rocket" href="/start">\n  Body.\n</Card>\n',
    Steps: '<Steps>\n  <Step title="One">\n    Do it.\n  </Step>\n</Steps>\n',
    Accordion: '<Accordion title="More" defaultOpen>\n  Details.\n</Accordion>\n',
    ParamField: '<ParamField path="id" type="string" required>\n  The id.\n</ParamField>\n',
    "custom component (raw)": '<CustomThing foo="bar" baz={1 + 2}>\n  inner\n</CustomThing>\n',
    "import/export (raw)": 'import { Foo } from "./foo";\n\nText.\n',
    "inline expression (raw)": "Hello {value} world.\n",
  };
  for (const [name, mdx] of Object.entries(cases)) {
    it(name, () => {
      expect(throughEditor(mdx)).toBe(norm(mdx));
    });
  }
});

// The checkbox must be a real control. The first version drew it in CSS, which looked correct in a
// screenshot and could not be clicked — so these assert on the input, not on `data-checked`.
describe("task item checkboxes are clickable", () => {
  function mount(source: string) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: buildMdxExtensions(),
      content: mdxToProseMirror(source),
    });
    // StarterKit appends a trailing paragraph to a doc ending in a list on the first transaction
    // (plain StarterKit does this too), so it shows up as a trailing blank line here.
    const mdx = () => proseMirrorToMdx(editor.getJSON() as never).trimEnd() + "\n";
    const boxes = () => [...element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    return { editor, element, mdx, boxes };
  }

  it("renders one input per task item and none for a plain bullet", () => {
    const { editor, element, boxes } = mount("- [ ] todo\n- [x] done\n- plain\n");
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
    expect(element.querySelectorAll("li")).toHaveLength(3);
    editor.destroy();
  });

  it("clicking one writes `checked` back into the document", () => {
    const { editor, mdx, boxes } = mount("- [ ] todo\n- [x] done\n");

    boxes()[0].click();
    expect(mdx()).toBe("- [x] todo\n- [x] done\n");
    boxes()[1].click();
    expect(mdx()).toBe("- [x] todo\n- [ ] done\n");

    // And the inputs follow the document rather than only their own local state — the node view's
    // update() has to re-read it, or an undo would leave a box disagreeing with the markdown.
    // (History groups both clicks into one step, so this rewinds to the original.)
    editor.commands.undo();
    expect(mdx()).toBe("- [ ] todo\n- [x] done\n");
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
    editor.destroy();
  });

  it("toggling does not add stray blocks to the document", () => {
    // Mutating `data-checked` on the <li> reads as a content change unless the node view ignores
    // it, and ProseMirror then re-parses the label + content div into extra blocks.
    const { editor, mdx, boxes } = mount("Intro.\n\n- [ ] todo\n\nOutro.\n");
    boxes()[0].click();
    boxes()[0].click();
    expect(mdx()).toBe("Intro.\n\n- [ ] todo\n\nOutro.\n");
    editor.destroy();
  });
});
