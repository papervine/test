import type { MdxAttr, MdxJsxElement, PMNode } from "./types";

// The Papervine/docs.json MDX component set (mirrors packages/renderer/components/mdx/index.ts).
// Each source JSX tag maps to a ProseMirror node type plus the plain-value props we model as
// typed attrs. Several tags share a node type (Note/Info/... → callout; CardGroup/Columns →
// cardGroup; ParamField/ResponseField/ApiField → apiField); the original tag name is stored
// on the node so serialization round-trips the exact element, aliases included.
type AttrKind = "string" | "boolean" | "number";

interface ComponentSpec {
  node: string;
  attrs: Record<string, AttrKind>;
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
};

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

/** Reads the raw source slice for an mdast node that carries `position` offsets. */
export function rawSlice(source: string, node: { position?: MdxJsxElement["position"] }): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start === "number" && typeof end === "number") return source.slice(start, end);
  return "";
}
