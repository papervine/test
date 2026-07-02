// ProseMirror document JSON shapes (structural — not tied to a live EditorState).
// The converter produces/consumes these; TipTap loads them via its schema in the editor.

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

export interface PMDoc {
  type: "doc";
  content: PMNode[];
}

// Minimal structural views of the MDX-specific mdast nodes. We deliberately do NOT
// depend on `mdast-util-mdx-*` type packages — the runtime nodes are produced by
// remark-mdx and we only read a few fields, so local interfaces keep the dep surface small.
export interface MdxAttrValueExpression {
  type: "mdxJsxAttributeValueExpression";
  value: string;
}
export interface MdxJsxAttribute {
  type: "mdxJsxAttribute";
  name: string;
  value: string | null | MdxAttrValueExpression;
}
export interface MdxJsxExpressionAttribute {
  type: "mdxJsxExpressionAttribute";
  value: string;
}
export type MdxAttr = MdxJsxAttribute | MdxJsxExpressionAttribute;

export interface MdxJsxElement {
  type: "mdxJsxFlowElement" | "mdxJsxTextElement";
  name: string | null;
  attributes: MdxAttr[];
  children: unknown[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

// The synthetic mdast node our serializer emits for byte-exact raw passthrough. A custom
// remark-stringify handler (see processor.ts) returns `.value` verbatim, unescaped.
export interface MdxRawNode {
  type: "mdxRaw";
  value: string;
}
