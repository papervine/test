import type { MdxAttr, MdxJsxElement, PMNode } from "./types";

// The Papervine/docs.json MDX component set (mirrors packages/renderer/components/mdx/index.ts).
// Each source JSX tag maps to a ProseMirror node type plus the plain-value props we model as
// typed attrs. Several tags share a node type (Note/Info/... → callout; CardGroup/Columns →
// cardGroup; ParamField/ResponseField/ApiField → apiField); the original tag name is stored
// on the node so serialization round-trips the exact element, aliases included.
// "strings" is a LIST of plain strings, written as an expression attr (`tags={["api","beta"]}`) —
// the one expression shape modeled rather than demoted, because a changelog entry's tags are
// ordinary authored content, not code. Anything less literal (a variable, a computed array, an
// object inside it) still demotes to a raw passthrough like every other expression.
type AttrKind = "string" | "boolean" | "number" | "strings";

interface ComponentSpec {
  node: string;
  attrs: Record<string, AttrKind>;
  /**
   * The component is INLINE — it sits in a run of text (`<Badge>Beta</Badge>` mid-sentence), so
   * MDX parses it as an `mdxJsxTextElement` and its PM node belongs to the inline group. Written
   * on its own line it arrives as a flow element instead, and is wrapped in a paragraph so the
   * node still lands somewhere legal (the serialized MDX is identical either way).
   */
  inline?: true;
  /**
   * The component holds no children — `<Icon icon="rocket" />`. Its PM node is an atom, so it is
   * selected and deleted as one thing rather than typed into, and it serializes back as a
   * self-closing tag.
   */
  void?: true;
}

export const COMPONENTS: Record<string, ComponentSpec> = {
  Note: { node: "callout", attrs: {} },
  Info: { node: "callout", attrs: {} },
  Warning: { node: "callout", attrs: {} },
  Tip: { node: "callout", attrs: {} },
  Check: { node: "callout", attrs: {} },
  Card: { node: "card", attrs: { title: "string", icon: "string", href: "string" } },
  CardGroup: { node: "cardGroup", attrs: { cols: "number" } },
  Columns: { node: "cardGroup", attrs: { cols: "number" } },
  Steps: { node: "steps", attrs: {} },
  Step: { node: "step", attrs: { title: "string" } },
  Frame: { node: "frame", attrs: { caption: "string" } },
  Tabs: { node: "tabs", attrs: {} },
  Tab: { node: "tab", attrs: { title: "string" } },
  CodeGroup: { node: "codeGroup", attrs: {} },
  Accordion: { node: "accordion", attrs: { title: "string", defaultOpen: "boolean" } },
  AccordionGroup: { node: "accordionGroup", attrs: {} },
  ParamField: {
    node: "apiField",
    attrs: {
      path: "string",
      query: "string",
      header: "string",
      body: "string",
      name: "string",
      type: "string",
      required: "boolean",
      deprecated: "boolean",
      default: "string",
    },
  },
  ResponseField: {
    node: "apiField",
    attrs: { name: "string", type: "string", required: "boolean", deprecated: "boolean", default: "string" },
  },
  ApiField: {
    node: "apiField",
    attrs: { name: "string", type: "string", required: "boolean", deprecated: "boolean", defaultValue: "string" },
  },
  Expandable: { node: "expandable", attrs: { title: "string", defaultOpen: "boolean" } },
  // A changelog entry. `label` (the anchor readers link to) and `description` are plain strings;
  // `tags` is a list of them, which is why "strings" exists — the starter's own Updates gallery
  // writes `tags={["release"]}`, so demoting over it would have meant the flagship example of the
  // component was the one page the Visual editor couldn't edit. `rss` stays unmodeled (it's an
  // object), so an entry carrying one is still kept as raw MDX, byte-exact.
  Update: { node: "update", attrs: { label: "string", description: "string", tags: "strings" } },
  // The one inline component we model. `iconType` is carried through the typed model even though
  // the renderer ignores it (it selects a Font Awesome weight): dropping an attr an author wrote
  // would lose information, and demoting the whole badge to raw source over it would take it out
  // of the Visual editor entirely.
  // The file tree. Its rows are MEMBER-EXPRESSION tags (`<Tree.Folder>`), which mdast reports as
  // the literal name — so they're keys here like any other, and `mdxName` round-trips the exact
  // spelling (`Tree.File` vs `FileTree.File`). A file row is childless, so its node is an atom.
  Tree: { node: "tree", attrs: {} },
  FileTree: { node: "tree", attrs: {} },
  "Tree.Folder": {
    node: "treeFolder",
    attrs: {
      name: "string",
      defaultOpen: "boolean",
      openable: "boolean",
      highlight: "boolean",
    },
  },
  "FileTree.Folder": {
    node: "treeFolder",
    attrs: {
      name: "string",
      defaultOpen: "boolean",
      openable: "boolean",
      highlight: "boolean",
    },
  },
  "Tree.File": { node: "treeFile", void: true, attrs: { name: "string", highlight: "boolean" } },
  "FileTree.File": {
    node: "treeFile",
    void: true,
    attrs: { name: "string", highlight: "boolean" },
  },
  // Colour swatches. Same member-expression shape as the tree; a swatch is childless, and its
  // `value` is modeled only in its plain-string form — `value={{ light, dark }}` is an expression,
  // which demotes that swatch to raw and preserves it verbatim (see extractAttrs).
  Color: { node: "color", attrs: { variant: "string" } },
  "Color.Item": { node: "colorItem", void: true, attrs: { name: "string", value: "string" } },
  "Color.Row": { node: "colorRow", attrs: { title: "string" } },
  // Inline and childless: `<Icon icon="rocket" size={24} />`. `iconType` is carried for the same
  // reason as Badge's — an attr the author wrote survives even where the renderer ignores it.
  Icon: {
    node: "icon",
    inline: true,
    void: true,
    attrs: {
      icon: "string",
      src: "string",
      iconType: "string",
      color: "string",
      size: "number",
      className: "string",
    },
  },
  Badge: {
    node: "badge",
    inline: true,
    attrs: {
      color: "string",
      size: "string",
      shape: "string",
      icon: "string",
      iconType: "string",
      stroke: "boolean",
      disabled: "boolean",
      className: "string",
    },
  },
};

/** Is this tag one of the inline components (see ComponentSpec.inline)? */
export function isInlineTag(name: string | null): boolean {
  return !!name && COMPONENTS[name]?.inline === true;
}

/** Is this tag a childless component (see ComponentSpec.void)? */
export function isVoidTag(name: string | null): boolean {
  return !!name && COMPONENTS[name]?.void === true;
}

/** The PM node types of the inline components, for the editor's schema. */
export const INLINE_NODE_TYPES = new Set(
  Object.values(COMPONENTS)
    .filter((c) => c.inline)
    .map((c) => c.node),
);

/** …and of the childless ones, which are atoms. */
export const VOID_NODE_TYPES = new Set(
  Object.values(COMPONENTS)
    .filter((c) => c.void)
    .map((c) => c.node),
);

/** The PM node type for a source tag, or undefined if the tag isn't a known component. */
export function nodeTypeForTag(name: string | null): string | undefined {
  return name ? COMPONENTS[name]?.node : undefined;
}

/**
 * Resolve a `prop={…}` expression to its equivalent attribute-string form if — and only if —
 * it is a simple JS literal (number, boolean, single/double-quoted string). Returns undefined
 * for anything else (identifiers, member access, arithmetic), signalling the element should be
 * demoted to raw so the expression is preserved verbatim.
 */
function literalFromExpression(expr: string): string | undefined {
  const src = expr.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(src)) return src; // number: 2, -1, 3.5
  if (src === "true" || src === "false") return src; // boolean
  const str = /^"([^"\\]*)"$/.exec(src) ?? /^'([^'\\]*)'$/.exec(src); // simple string (no escapes)
  if (str) return str[1];
  return undefined;
}

/**
 * `["api", "beta"]` → `["api", "beta"]`; anything else → undefined (demote).
 *
 * Deliberately a literal-only reader, like `literalFromExpression` above: an array of plain quoted
 * strings, no escapes, no nesting, no trailing garbage. A repo that writes `tags={TAGS}` or
 * `tags={[...base, "x"]}` keeps its element as raw source rather than having the model quietly
 * flatten something it can't reproduce.
 */
function stringListFromExpression(expr: string): string[] | undefined {
  const src = expr.trim();
  if (!src.startsWith("[") || !src.endsWith("]")) return undefined;
  const inner = src.slice(1, -1).trim();
  if (inner === "") return [];
  const out: string[] = [];
  for (const part of inner.split(",")) {
    const literal = literalFromExpression(part);
    // A number or boolean in the list isn't a string list — demote rather than coerce.
    if (literal === undefined || !/^["']/.test(part.trim())) return undefined;
    out.push(literal);
  }
  return out;
}

/**
 * Extract typed attrs from a known component's JSX attributes. Returns null to signal the
 * element must be **demoted to a raw passthrough** — the fidelity guard from the plan: any
 * unknown attr, expression-valued attr (`prop={expr}`), or spread (`{...x}`) would lose
 * information through the typed model, so we preserve the whole element verbatim instead.
 */
export function extractAttrs(name: string, attributes: MdxAttr[]): Record<string, unknown> | null {
  const spec = COMPONENTS[name];
  if (!spec) return null;
  const out: Record<string, unknown> = { mdxName: name };

  for (const attr of attributes) {
    // Spread attributes (`{...props}`) can't be modeled — demote.
    if (attr.type === "mdxJsxExpressionAttribute") return null;

    const kind = spec.attrs[attr.name];
    if (!kind) return null; // unknown attribute for this component → demote

    let value = attr.value;
    // A string list only ever arrives as an expression (`tags={["api"]}`) — read it before the
    // scalar path below, which has no way to represent one.
    if (kind === "strings") {
      if (value === null || typeof value !== "object") return null; // `tags` or `tags="api"` → demote
      const list = stringListFromExpression(value.value);
      if (list === undefined) return null;
      out[attr.name] = list;
      continue;
    }
    // Expression-valued attribute (`prop={…}`). Simple JS literals — `cols={2}`,
    // `defaultOpen={true}`, `title={"x"}` (the common hosted docs platforms idiom) — resolve to their
    // value so the component stays a real typed node. Non-literal expressions (variables,
    // `{1 + 2}`) still demote to raw, preserving the expression verbatim.
    if (value !== null && typeof value === "object") {
      const literal = literalFromExpression(value.value);
      if (literal === undefined) return null;
      value = literal;
    }

    if (value === null) {
      // Bare boolean attribute (`required`).
      if (kind !== "boolean") return null;
      out[attr.name] = true;
    } else if (kind === "boolean") {
      if (value !== "true" && value !== "false") return null;
      out[attr.name] = value === "true";
    } else if (kind === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      out[attr.name] = n;
    } else {
      out[attr.name] = value;
    }
  }
  return out;
}

/** Rebuild an mdast mdxJsxFlowElement's `attributes` array from a stored PM node's attrs. */
export function buildAttributes(attrs: Record<string, unknown> | undefined): MdxAttr[] {
  const name = (attrs?.mdxName as string) ?? "";
  const spec = COMPONENTS[name];
  if (!spec || !attrs) return [];
  const out: MdxAttr[] = [];
  // Emit in the spec's declared order for deterministic, idempotent output.
  for (const key of Object.keys(spec.attrs)) {
    const value = attrs[key];
    if (value === undefined || value === null) continue;
    if (spec.attrs[key] === "boolean") {
      // Only emit truthy booleans, as a bare attribute (`required`).
      if (value === true) out.push({ type: "mdxJsxAttribute", name: key, value: null });
    } else if (spec.attrs[key] === "strings") {
      // Back out as the expression it came in as. An empty list is omitted rather than written as
      // `tags={[]}`, matching how every other empty value serializes away.
      if (!Array.isArray(value) || value.length === 0) continue;
      const list = value.map((v) => JSON.stringify(String(v))).join(", ");
      out.push({
        type: "mdxJsxAttribute",
        name: key,
        value: { type: "mdxJsxAttributeValueExpression", value: `[${list}]` },
      });
    } else {
      out.push({ type: "mdxJsxAttribute", name: key, value: String(value) });
    }
  }
  return out;
}

/** The source tag name to serialize a component PM node back to (falls back for safety). */
export function tagForNode(node: PMNode): string {
  const stored = node.attrs?.mdxName;
  if (typeof stored === "string" && stored) return stored;
  // Should not happen (parser always stores mdxName), but keep serialization total.
  const fallback = Object.keys(COMPONENTS).find((t) => COMPONENTS[t].node === node.type);
  return fallback ?? node.type;
}

/**
 * Reads the raw source slice for an mdast node that carries `position` offsets.
 *
 * Continuation lines are DEDENTED by the node's own starting column. The serializer's raw
 * handler emits the stored value verbatim, and remark-stringify then prefixes the surrounding
 * context's indentation onto every line — so a multi-line raw atom stored with its absolute
 * indentation gained two more spaces per line on every parse→serialize pass. That is not a
 * cosmetic drift: the editor saves what it normalizes, so a page holding an indented unknown
 * component (the starter's <Tile> with a literal <img> inside) grew on every single open —
 * reported as "refreshing this page keeps saving a duplicate of the data". Storing the lines
 * relative to the node's first character makes re-indentation land exactly where the source
 * was: a fixed point. Only spaces are stripped, and at most (column - 1) of them, so a line
 * that was deliberately indented deeper keeps its extra depth.
 */
export function rawSlice(
  source: string,
  // The local position type only declares `offset`; mdast nodes carry `column` too (1-based).
  node: { position?: MdxJsxElement["position"] & { start?: { column?: number } } },
): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return "";
  const sliced = source.slice(start, end);
  const column = node.position?.start?.column ?? 1;
  if (column <= 1 || !sliced.includes("\n")) return sliced;
  const dedent = new RegExp(`^ {1,${column - 1}}`);
  return sliced
    .split("\n")
    .map((line, i) => (i === 0 ? line : line.replace(dedent, "")))
    .join("\n");
}
