import { unified, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkStringify from "remark-stringify";
import type { Root } from "mdast";

// A remark plugin that teaches remark-stringify our synthetic `mdxRaw` node: emit its
// `.value` verbatim, no escaping. This is the byte-exact passthrough for unknown MDX
// (custom components, `{expressions}`, `import`/`export`) — mirroring the renderer's
// Fallback philosophy: never mangle what we don't model, preserve the source.
function remarkRawPassthrough(this: Processor) {
  const data = this.data();
  const toMd = (data.toMarkdownExtensions ||= []) as unknown[];
  toMd.push({
    handlers: {
      mdxRaw: (node: { value: string }) => node.value,
    },
    // The raw value is authoritative; don't let to-markdown insert escape characters
    // adjacent to it.
    unsafe: [],
  });
}

// remark-stringify options tuned for stable, idempotent output. These are the "documented
// normalization" the round-trip corpus allows: once text passes through the processor,
// re-running it is a no-op.
const stringifyOptions = {
  bullet: "-" as const,
  emphasis: "_" as const,
  strong: "*" as const,
  fences: true as const,
  rule: "-" as const,
  listItemIndent: "one" as const,
};

// One processor does both directions: `.parse()` (remark-parse + gfm + mdx) yields an mdast
// tree with mdxJsx*/expression/esm nodes carrying source `position`; `.stringify()` uses the
// gfm + mdx toMarkdown extensions plus our raw passthrough.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMdx)
  .use(remarkStringify, stringifyOptions)
  .use(remarkRawPassthrough)
  .freeze();

export function parseMdx(source: string): Root {
  return processor.parse(source) as Root;
}

export function stringifyMdast(tree: Root): string {
  return processor.stringify(tree);
}
