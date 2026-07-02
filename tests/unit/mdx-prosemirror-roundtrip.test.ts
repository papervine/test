import { describe, it, expect } from "vitest";
import { mdxToProseMirror, proseMirrorToMdx, splitFrontmatter } from "@papervine/mdx-prosemirror";

// The Phase-1 gate (SPEC: WYSIWYG editor). The converter's contract:
//  1. IDEMPOTENT — once MDX passes through parse→serialize, re-running is a no-op. This is
//     the "documented normalization allowlist": markdown formatting settles to one canonical
//     form, then never drifts. Editing a page in Visual mode can only reformat *edited*
//     regions, and even those are stable.
//  2. RAW-PRESERVING — anything the editor can't model (custom components, {expressions},
//     import/export, expression-valued attrs) survives byte-for-byte via mdxUnknown* nodes.
//  3. STRUCTURAL — the 15 known components parse to their typed nodes with the right attrs.

const norm = (mdx: string) => proseMirrorToMdx(mdxToProseMirror(mdx));
/** Idempotency: normalize is a fixed point after the first pass. */
function expectStable(mdx: string) {
  const once = norm(mdx);
  expect(norm(once)).toBe(once);
  return once;
}

describe("markdown round-trip is idempotent", () => {
  const cases: Record<string, string> = {
    headings: "# H1\n\n## H2\n\n### H3\n",
    emphasis: "Some **bold**, _italic_, `code`, and ~~struck~~ text.\n",
    link: "See [the docs](https://example.com) for details.\n",
    "bullet list": "- one\n- two\n- three\n",
    "ordered list": "1. first\n2. second\n3. third\n",
    "nested list": "- parent\n  - child\n  - child two\n",
    blockquote: "> a quote\n>\n> second line\n",
    "code fence": "```ts\nconst x = 1;\n```\n",
    "thematic break": "before\n\n---\n\nafter\n",
    table: "| a | b |\n| - | - |\n| 1 | 2 |\n",
    "mixed doc": "# Title\n\nIntro paragraph with **bold**.\n\n- a\n- b\n\n```js\nfoo();\n```\n",
  };
  for (const [name, mdx] of Object.entries(cases)) {
    it(name, () => expectStable(mdx));
  }
});

describe("known components parse to typed nodes and round-trip", () => {
  const components: Record<string, { mdx: string; node: string; attrs?: Record<string, unknown> }> = {
    Note: { mdx: "<Note>\n  Heads up.\n</Note>\n", node: "callout", attrs: { mdxName: "Note" } },
    Warning: { mdx: "<Warning>\n  Careful.\n</Warning>\n", node: "callout", attrs: { mdxName: "Warning" } },
    Card: {
      mdx: '<Card title="Setup" icon="rocket" href="/start">\n  Body.\n</Card>\n',
      node: "card",
      attrs: { mdxName: "Card", title: "Setup", icon: "rocket", href: "/start" },
    },
    CardGroup: { mdx: '<CardGroup cols="2">\n  <Card title="A" />\n</CardGroup>\n', node: "cardGroup" },
    Steps: { mdx: "<Steps>\n  <Step title=\"One\">\n    Do it.\n  </Step>\n</Steps>\n", node: "steps" },
    Accordion: {
      mdx: '<Accordion title="More" defaultOpen>\n  Details.\n</Accordion>\n',
      node: "accordion",
      attrs: { mdxName: "Accordion", title: "More", defaultOpen: true },
    },
    ParamField: {
      mdx: '<ParamField path="id" type="string" required>\n  The id.\n</ParamField>\n',
      node: "apiField",
      attrs: { mdxName: "ParamField", path: "id", type: "string", required: true },
    },
    Expandable: { mdx: '<Expandable title="attrs">\n  Nested.\n</Expandable>\n', node: "expandable" },
    Frame: { mdx: '<Frame caption="A figure">\n  ![x](/y.png)\n</Frame>\n', node: "frame" },
  };
  for (const [name, { mdx, node, attrs }] of Object.entries(components)) {
    it(name, () => {
      const doc = mdxToProseMirror(mdx);
      const top = doc.content[0];
      expect(top.type).toBe(node);
      if (attrs) expect(top.attrs).toMatchObject(attrs);
      expectStable(mdx);
    });
  }

  it("literal expression attrs resolve to real typed nodes (cols={2}, defaultOpen={true})", () => {
    const cg = mdxToProseMirror("<CardGroup cols={2}>\n  <Card title=\"A\" />\n</CardGroup>\n");
    expect(cg.content[0].type).toBe("cardGroup");
    expect(cg.content[0].attrs).toMatchObject({ mdxName: "CardGroup", cols: 2 });

    const ac = mdxToProseMirror('<Accordion title="X" defaultOpen={true}>\n  Body.\n</Accordion>\n');
    expect(ac.content[0].type).toBe("accordion");
    expect(ac.content[0].attrs).toMatchObject({ defaultOpen: true });
  });

  it("Columns keeps its own tag name (not normalized to CardGroup)", () => {
    const out = norm('<Columns cols="3">\n  <Card title="A" />\n</Columns>\n');
    expect(out).toContain("<Columns");
    expect(out).not.toContain("CardGroup");
  });
});

describe("unmodelable MDX is preserved verbatim (raw passthrough)", () => {
  it("custom component becomes mdxUnknownFlow with exact source", () => {
    const mdx = '<CustomThing foo="bar" baz={1 + 2}>\n  inner\n</CustomThing>\n';
    const doc = mdxToProseMirror(mdx);
    expect(doc.content[0].type).toBe("mdxUnknownFlow");
    expect(doc.content[0].attrs?.raw).toContain("<CustomThing");
    expect(norm(mdx)).toContain('<CustomThing foo="bar" baz={1 + 2}>');
  });

  it("import/export statements survive", () => {
    const mdx = 'import { Foo } from "./foo";\n\nexport const meta = { a: 1 };\n\nText.\n';
    const out = norm(mdx);
    expect(out).toContain('import { Foo } from "./foo";');
    expect(out).toContain("export const meta = { a: 1 };");
  });

  it("expression blocks and comments survive", () => {
    const mdx = "{/* a comment */}\n\nText.\n";
    expect(norm(mdx)).toContain("{/* a comment */}");
  });

  it("a known component with a NON-literal expression attr is demoted to raw (not lost)", () => {
    const mdx = "<CardGroup cols={cols}>\n  <Card title=\"A\" />\n</CardGroup>\n";
    const doc = mdxToProseMirror(mdx);
    expect(doc.content[0].type).toBe("mdxUnknownFlow");
    expect(norm(mdx)).toContain("cols={cols}");
  });

  it("arithmetic/complex expression attrs still demote to raw", () => {
    const mdx = "<CardGroup cols={1 + 1}>\n  <Card title=\"A\" />\n</CardGroup>\n";
    expect(mdxToProseMirror(mdx).content[0].type).toBe("mdxUnknownFlow");
    expect(norm(mdx)).toContain("cols={1 + 1}");
  });

  it("a literal <img> becomes a real image node and round-trips as <img>", () => {
    const mdx = '<img src="/img/hero.png" alt="The hero" />\n';
    const doc = mdxToProseMirror(mdx);
    expect(doc.content[0].type).toBe("paragraph");
    expect(doc.content[0].content?.[0]).toMatchObject({
      type: "image",
      attrs: { mdxTag: "img", src: "/img/hero.png", alt: "The hero" },
    });
    const out = norm(mdx);
    expect(out).toContain('<img');
    expect(out).toContain('src="/img/hero.png"');
    expect(out).toContain('alt="The hero"');
  });

  it("markdown images stay markdown (not converted to <img>)", () => {
    const out = norm("![alt text](/pic.png)\n");
    expect(out).toContain("![alt text](/pic.png)");
    expect(out).not.toContain("<img");
  });

  it("an <img> with an unsupported attr is preserved verbatim as raw", () => {
    const mdx = '<img src="/x.png" className="rounded" />\n';
    expect(mdxToProseMirror(mdx).content[0].type).toBe("mdxUnknownFlow");
    expect(norm(mdx)).toContain('className="rounded"');
  });

  it("inline JSX/expressions inside a paragraph survive", () => {
    const mdx = "Hello <Icon name=\"x\" /> and {value} world.\n";
    const out = norm(mdx);
    expect(out).toContain("<Icon");
    expect(out).toContain("{value}");
  });
});

describe("inline mark serialization is idempotent (grouping, not per-node wrapping)", () => {
  it("bold spanning inline code doesn't emit `****` (the docs-corpus regression)", () => {
    // Was: `**no ****`deploy`****` — adjacent per-node strong wrappers re-escaped each pass.
    const out = expectStable("it has **no `deploy` and no `login`**.\n");
    expect(out).toContain("**no `deploy` and no `login`**");
    expect(out).not.toContain("****");
  });

  it("adjacent bold words merge cleanly", () => {
    const out = expectStable("**alpha** **beta** and **gamma**.\n");
    expect(out).not.toContain("****");
  });

  it("mixed nested marks round-trip stably", () => {
    expectStable("A [**bold link**](https://x.com) and _italic with `code`_ here.\n");
  });

  it("a linked image keeps its link", () => {
    const out = expectStable("[![alt](/img.png)](https://x.com)\n");
    expect(out).toContain("](/img.png)");
    expect(out).toContain("(https://x.com)");
  });
});

describe("splitFrontmatter", () => {
  it("separates a frontmatter block from the body", () => {
    const file = "---\ntitle: Hi\ndescription: yo\n---\n\n# Body\n";
    const { frontmatter, body, bodyStart } = splitFrontmatter(file);
    expect(frontmatter).toContain("title: Hi");
    // The blank line between the closing `---` and the content belongs to the body.
    expect(body).toBe("\n# Body\n");
    expect(file.slice(bodyStart)).toBe(body);
  });
  it("no frontmatter → whole text is the body", () => {
    const file = "# Body only\n";
    const { frontmatter, body, bodyStart } = splitFrontmatter(file);
    expect(frontmatter).toBe("");
    expect(body).toBe(file);
    expect(bodyStart).toBe(0);
  });
});
