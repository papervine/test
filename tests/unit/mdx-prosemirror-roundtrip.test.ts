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
    // GFM task lists. These used to round-trip as PLAIN bullets — the checkboxes were dropped
    // silently, so opening a page with them in Visual mode and saving destroyed every one.
    "task list": "- [ ] not done\n- [x] done\n",
    // Legal GFM, and the reason `checked` is an attr on listItem rather than a separate node
    // type: one list can hold both kinds.
    "mixed task and plain list": "- [ ] task\n- plain bullet\n- [x] done\n",
    "nested task list": "- [ ] parent\n  - [x] child\n",
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

// Idempotency alone would NOT have caught the task-list bug: dropping every checkbox produces a
// plain bullet list, which is perfectly stable. These assert the output still equals the input —
// the property that actually says "your content came back".
describe("GFM task lists survive byte-for-byte", () => {
  const cases: Record<string, string> = {
    "unchecked and checked": "- [ ] not done\n- [x] done\n",
    "mixed with plain bullets": "- [ ] task\n- plain bullet\n- [x] done\n",
    nested: "- [ ] parent\n  - [x] child\n",
  };
  for (const [name, mdx] of Object.entries(cases)) {
    it(name, () => expect(norm(mdx)).toBe(mdx));
  }

  it("leaves an ordinary bullet list without checkboxes", () => {
    // The other half: `checked` must stay ABSENT for a plain item, or every list in every page
    // would sprout an empty box.
    expect(norm("- one\n- two\n")).toBe("- one\n- two\n");
    const doc = mdxToProseMirror("- one\n");
    const item = doc.content[0].content?.[0];
    expect(item?.attrs?.checked).toBeUndefined();
  });

  it("carries the checked state onto the node, not just the text", () => {
    const doc = mdxToProseMirror("- [x] done\n");
    expect(doc.content[0].content?.[0]?.attrs?.checked).toBe(true);
    expect(mdxToProseMirror("- [ ] todo\n").content[0].content?.[0]?.attrs?.checked).toBe(false);
  });

  // Reported from two browsers side by side: pressing Enter at the end of a task list gave the
  // typist a new checkbox, while the collaborator watching saw a plain BULLET until the first
  // letter arrived. Markdown can't say "unchecked task item with no text" — an empty `checked` item
  // stringifies to a bare `-`, and `- [ ]` doesn't parse back as a task item — so the transient row
  // is a plain bullet in the shared text, and the peer (who only ever sees the text) rendered it as
  // one. See `inheritTaskItems` in to-prosemirror.ts.
  it("gives a task list's still-empty item its checkbox back", () => {
    const items = mdxToProseMirror("- [ ] asasassa\n-\n").content[0].content ?? [];
    expect(items).toHaveLength(2);
    expect(items[0].attrs?.checked).toBe(false);
    expect(items[1].attrs?.checked).toBe(false);
  });

  it("still emits the same text for that empty item, so the round trip is unchanged", () => {
    // The recovery is a projection nicety, not a text rewrite: markdown gets the same bytes back.
    expect(norm("- [ ] asasassa\n-\n")).toBe("- [ ] asasassa\n-\n");
  });

  it("leaves an empty item alone in a list with no task items", () => {
    const items = mdxToProseMirror("- one\n-\n").content[0].content ?? [];
    expect(items[1]?.attrs?.checked).toBeUndefined();
  });

  it("leaves a NON-empty plain bullet alone in a mixed list", () => {
    // A list may legitimately mix task items and plain bullets; only the empty row is ambiguous.
    const items = mdxToProseMirror("- [ ] task\n- plain bullet\n- [x] done\n").content[0].content ?? [];
    expect(items[0]?.attrs?.checked).toBe(false);
    expect(items[1]?.attrs?.checked).toBeUndefined();
    expect(items[2]?.attrs?.checked).toBe(true);
  });
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
    Update: {
      mdx: '<Update label="2026-08-31" description="v1.2.0">\n  Shipped the thing.\n</Update>\n',
      node: "update",
      attrs: { mdxName: "Update", label: "2026-08-31", description: "v1.2.0" },
    },
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

  // <Badge> is the one INLINE component the converter models: it sits in a run of text, so MDX
  // parses it as a text element and its node belongs to the inline group. Before this it was an
  // unknown-inline atom — preserved byte-exact, but shown in the Visual editor as its own source.
  describe("Badge is an inline node, not a block", () => {
    it("parses inside a paragraph and keeps the sentence around it", () => {
      const mdx = 'Status: <Badge color="green">Stable</Badge> today.\n';
      const doc = mdxToProseMirror(mdx);
      const para = doc.content[0];
      expect(para.type).toBe("paragraph");
      expect(para.content?.map((c) => c.type)).toEqual(["text", "badge", "text"]);
      expect(para.content?.[1]).toMatchObject({
        type: "badge",
        attrs: { mdxName: "Badge", color: "green" },
        content: [{ type: "text", text: "Stable" }],
      });
      expectStable(mdx);
    });

    it("keeps every documented attr, including the one the renderer ignores", () => {
      // `iconType` picks a Font Awesome weight, which our icons don't have — but an attr the
      // author wrote has to survive the trip, and demoting the badge to raw over it would take it
      // out of the editor.
      const mdx =
        '<Badge icon="star" iconType="solid" color="blue" size="lg" shape="pill" stroke disabled>Premium</Badge>\n';
      const doc = mdxToProseMirror(mdx);
      expect(doc.content[0].content?.[0]).toMatchObject({
        type: "badge",
        attrs: {
          icon: "star",
          iconType: "solid",
          color: "blue",
          size: "lg",
          shape: "pill",
          stroke: true,
          disabled: true,
        },
      });
      expectStable(mdx);
    });

    it("on its own line, gets the paragraph an inline node needs", () => {
      // Written alone, MDX hands it over as a FLOW element — but the node is inline, so it needs
      // somewhere to live. The MDX it serializes back to is the same either way.
      const mdx = "<Badge>Beta</Badge>\n";
      const doc = mdxToProseMirror(mdx);
      expect(doc.content[0].type).toBe("paragraph");
      expect(doc.content[0].content?.[0].type).toBe("badge");
      expectStable(mdx);
    });

    it("carries the marks around it, so a linked or bold badge round-trips", () => {
      const mdx = "**<Badge>New</Badge>**\n";
      const doc = mdxToProseMirror(mdx);
      expect(doc.content[0].content?.[0]).toMatchObject({
        type: "badge",
        marks: [{ type: "bold" }],
      });
      expectStable(mdx);
    });

    it("keeps emphasis inside the label", () => {
      // The label is the node's content, so it's ordinary marked text — and the serializer writes
      // it back through the same machinery a paragraph uses.
      const mdx = "<Badge>**bold**</Badge>\n";
      const doc = mdxToProseMirror(mdx);
      expect(doc.content[0].content?.[0]).toMatchObject({
        type: "badge",
        content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }],
      });
      expectStable(mdx);
    });

    it("demotes to raw rather than lose what the typed model can't hold", () => {
      // An expression-valued attr and an unknown one: preserved verbatim rather than dropped.
      for (const mdx of [
        "<Badge color={theme.accent}>X</Badge>\n",
        '<Badge tooltip="unknown">X</Badge>\n',
      ]) {
        const doc = mdxToProseMirror(mdx);
        const inline = doc.content[0].content?.[0];
        expect(inline?.type).toBe("mdxUnknownText");
        expectStable(mdx);
      }
    });
  });

  it("literal expression attrs resolve to real typed nodes (cols={2}, defaultOpen={true})", () => {
    const cg = mdxToProseMirror("<CardGroup cols={2}>\n  <Card title=\"A\" />\n</CardGroup>\n");
    expect(cg.content[0].type).toBe("cardGroup");
    expect(cg.content[0].attrs).toMatchObject({ mdxName: "CardGroup", cols: 2 });

    const ac = mdxToProseMirror('<Accordion title="X" defaultOpen={true}>\n  Body.\n</Accordion>\n');
    expect(ac.content[0].type).toBe("accordion");
    expect(ac.content[0].attrs).toMatchObject({ defaultOpen: true });
  });

  // An empty component is the one shape whose PM node can't be what the source literally says:
  // component nodes are `block+`, so zero children is an INVALID node. Nothing rejects it at parse
  // time — it surfaces later as `RangeError: Invalid content for node type …` on the first
  // setNodeMarkup (editing an accordion's title does that on every keystroke), and until then the
  // component has no line to put a caret on. So the converter fills one empty paragraph in, and
  // drops it again on the way out.
  describe("an empty component gets a paragraph to type in — and gives it back", () => {
    const emptyForms: Record<string, string> = {
      "self-closing": '<ParamField path="id" type="string" />\n',
      "empty tag pair": '<Accordion title="More" />\n',
      "blank line between tags": '<Accordion title="More">\n</Accordion>\n',
    };

    for (const [name, mdx] of Object.entries(emptyForms)) {
      it(`${name}: valid node in, unchanged MDX out`, () => {
        const top = mdxToProseMirror(mdx).content[0];
        expect(top.content, "an empty component would be an invalid `block+` node").toEqual([
          { type: "paragraph" },
        ]);
        // The filler never reaches the file: a self-closing tag stays self-closing rather than
        // growing into a tag pair, which would rewrite every API page on save.
        expect(norm(mdx)).not.toContain("</ParamField>");
        expectStable(mdx);
      });
    }

    it("keeps real content — the filler is only for the empty case", () => {
      const top = mdxToProseMirror('<Accordion title="More">\n  Details.\n</Accordion>\n').content[0];
      expect(top.content).toHaveLength(1);
      expect(top.content?.[0].content?.[0]).toMatchObject({ type: "text", text: "Details." });
    });

    it("a paragraph the AUTHOR left empty is not the filler (there is no such MDX)", () => {
      // A blank line inside a tag pair parses to no children at all, so "one empty paragraph"
      // is unambiguous: it can only be the filler. This pins that assumption.
      const top = mdxToProseMirror("<Accordion>\n\n\n</Accordion>\n").content[0];
      expect(top.content).toEqual([{ type: "paragraph" }]);
    });
  });

  // A table cell holds blocks in the editor and a run of inline content in GFM. The reconciliation
  // is the interesting part: an ordinary cell must come out byte-identical, and a list — which pipe
  // tables cannot express at all — goes out as the HTML MDX renders as a real list, and comes back
  // as an editable one rather than as source text.
  describe("table cells: a paragraph stays inline, a list becomes HTML", () => {
    it("an ordinary cell is one paragraph, and its markdown is unchanged", () => {
      const doc = mdxToProseMirror("| a | b |\n| - | - |\n| 1 | 2 |\n");
      const cell = doc.content[0].content?.[0].content?.[0];
      expect(cell?.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "a" }] }]);
      expectStable("| a | b |\n| - | - |\n| 1 | 2 |\n");
    });

    it("a list in a cell round-trips as <ul>, and re-opens as a list", () => {
      const mdx = "| item | notes |\n| - | - |\n| x | <ul><li>one</li><li>two</li></ul> |\n";
      const cell = mdxToProseMirror(mdx).content[0].content?.[1].content?.[1];
      expect(cell?.content?.[0].type).toBe("bulletList");
      expect(cell?.content?.[0].content).toHaveLength(2);
      // …and not as the raw source it would otherwise be shown as.
      expect(JSON.stringify(cell)).not.toContain("mdxUnknownText");
      expectStable(mdx);
    });

    it("keeps an ordered list ordered", () => {
      const mdx = "| a |\n| - |\n| <ol><li>one</li><li>two</li></ol> |\n";
      const cell = mdxToProseMirror(mdx).content[0].content?.[1].content?.[0];
      expect(cell?.content?.[0].type).toBe("orderedList");
      expectStable(mdx);
    });

    it("parses an item's markdown, so emphasis in a cell's list survives the trip", () => {
      const mdx = "| a |\n| - |\n| <ul><li>**bold** item</li></ul> |\n";
      const item = mdxToProseMirror(mdx).content[0].content?.[1].content?.[0].content?.[0]
        .content?.[0].content?.[0];
      expect(item?.content?.[0].marks?.[0].type).toBe("bold");
      expect(norm(mdx)).toContain("<li>**bold** item</li>");
      expectStable(mdx);
    });

    it("handles a cell holding text AND a list — which is what typing one produces", () => {
      // Adding a list under a cell's existing text is the natural gesture, so the parse side can't
      // only recognise a cell that is nothing but a list.
      const mdx = "| a |\n| - |\n| Supports SSO<ul><li>one</li></ul> |\n";
      const cell = mdxToProseMirror(mdx).content[0].content?.[1].content?.[0];
      expect(cell?.content?.map((block) => block.type)).toEqual(["paragraph", "bulletList"]);
      expectStable(mdx);
    });

    it("leaves HTML that isn't a plain list alone", () => {
      // Only the shape to-mdx emits is read back as a list; anything else stays raw, which is the
      // passthrough guarantee for markup we don't model.
      const mdx = "| a |\n| - |\n| <div><li>odd</li></div> |\n";
      const cell = mdxToProseMirror(mdx).content[0].content?.[1].content?.[0];
      expect(cell?.content?.[0].type).toBe("paragraph");
      expectStable(mdx);
    });
  });

  it("an empty blockquote gets a paragraph too", () => {
    // `>` alone is a `block+` node with no children — the same invalid-node trap as the empty
    // component above, arriving from markdown's side. Nothing rejects it at parse time; it
    // surfaces later, the first time something tries to change the node.
    const quote = mdxToProseMirror(">\n").content[0];
    expect(quote.type).toBe("blockquote");
    expect(quote.content).toEqual([{ type: "paragraph" }]);
    expectStable(">\n");
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

  // `tags={["api"]}` is the one expression shape the model reads rather than demoting — a changelog
  // entry's tags are authored content, not code, and the starter's own Updates gallery writes them,
  // so demoting would have made the component's flagship example the one page Visual mode couldn't
  // edit. The literal-only reader is the line: anything less literal still demotes.
  describe("<Update> tags", () => {
    it("reads a literal string list onto the node and writes it back byte-exact", () => {
      const mdx = '<Update label="2026-08-23" description="v0.2.0" tags={["release"]}>\n  Body.\n</Update>\n';
      const doc = mdxToProseMirror(mdx);
      expect(doc.content[0].type).toBe("update");
      expect(doc.content[0].attrs?.tags).toEqual(["release"]);
      expect(norm(mdx)).toBe(mdx);
    });

    it("round-trips several tags", () => {
      const mdx = '<Update label="2026-08-23" tags={["api", "beta"]}>\n  Body.\n</Update>\n';
      expect(mdxToProseMirror(mdx).content[0].attrs?.tags).toEqual(["api", "beta"]);
      expect(norm(mdx)).toBe(mdx);
    });

    // Two documented normalizations. Neither is byte-exact, and both are STABLE — which is the
    // converter's actual contract (see the idempotency gate at the top of this file): formatting
    // settles to one canonical form on the first pass and never drifts again.
    it("normalizes tight spacing to one canonical form, then holds", () => {
      const mdx = '<Update label="2026-08-23" tags={["api","beta"]}>\n  Body.\n</Update>\n';
      const once = norm(mdx);
      expect(once).toContain('tags={["api", "beta"]}');
      expect(norm(once)).toBe(once);
    });

    it("drops an empty list rather than writing tags={[]}", () => {
      const mdx = '<Update label="2026-08-23" tags={[]}>\n  Body.\n</Update>\n';
      const once = norm(mdx);
      expect(once).toBe('<Update label="2026-08-23">\n  Body.\n</Update>\n');
      expect(norm(once)).toBe(once);
    });

    for (const [name, expr] of Object.entries({
      "a variable": "TAGS",
      "a spread": '[...base, "x"]',
      "a non-string member": '["api", 2]',
    })) {
      it(`demotes ${name} to raw, byte-exact`, () => {
        const mdx = `<Update label="2026-08-23" tags={${expr}}>\n  Body.\n</Update>\n`;
        expect(mdxToProseMirror(mdx).content[0].type).toBe("mdxUnknownFlow");
        expect(norm(mdx)).toBe(mdx);
      });
    }

    it("still demotes an entry carrying rss, which is an object", () => {
      const mdx = '<Update label="2026-08-23" rss={{ title: "x" }}>\n  Body.\n</Update>\n';
      expect(mdxToProseMirror(mdx).content[0].type).toBe("mdxUnknownFlow");
      expect(norm(mdx)).toBe(mdx);
    });
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
