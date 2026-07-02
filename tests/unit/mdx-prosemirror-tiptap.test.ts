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
