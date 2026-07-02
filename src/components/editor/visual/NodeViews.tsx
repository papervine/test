"use client";

import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { editorComponents, Mermaid } from "@papervine/renderer/components/mdx/editor-registry";
import type { NodeViewOpts } from "./nodes";

// Phase-2b node views: render the SAME components the reader-facing renderer uses, so the
// Visual editor looks like the published page. The component's own markup (card grid, callout
// colour + icon, step rail) wraps an editable content hole (NodeViewContent) — you edit the
// body in place. Props come from the node's attrs (title/icon/href/…); editing those attrs is
// a follow-up (do it in Source mode for now). Tabs/CodeGroup, which pick apart their children
// structurally, fall back to labelled chrome. Unknown MDX renders its raw source, read-only.

function cleanAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "mdxName" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

// Collapsibles hide their children when closed — force them open so the content stays editable.
const FORCE_OPEN = new Set(["Accordion", "Expandable"]);

function attrBadges(attrs: Record<string, unknown>): string[] {
  return Object.entries(attrs)
    .filter(([k, v]) => k !== "mdxName" && v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}=${String(v)}`));
}

/** Labelled editor chrome — for components we don't render live (Tabs, CodeGroup). */
function ChromeNodeView({ node }: NodeViewProps) {
  const name = (node.attrs.mdxName as string) || node.type.name;
  return (
    <NodeViewWrapper className="my-3 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
      <div
        contentEditable={false}
        className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800/60"
      >
        <span className="font-mono text-[11px] font-semibold text-primary">{name}</span>
        {attrBadges(node.attrs).map((b) => (
          <span
            key={b}
            className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
          >
            {b}
          </span>
        ))}
      </div>
      <NodeViewContent className="px-3 py-2 text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
    </NodeViewWrapper>
  );
}

/** Live render of a real MDX component wrapping an editable content hole. */
function ComponentNodeView(props: NodeViewProps) {
  const name = props.node.attrs.mdxName as string;

  // Layout containers apply their grid/flex to their DIRECT children — but ProseMirror's
  // content hole is a single element, so wrapping the real component around it collapses the
  // layout. Put the layout ON the content hole instead so the child nodes become grid items.
  if (name === "CardGroup" || name === "Columns") {
    const cols = Number(props.node.attrs.cols) || 2;
    return (
      <NodeViewWrapper className="my-5">
        <NodeViewContent
          className="pv-cardgrid grid gap-4"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        />
      </NodeViewWrapper>
    );
  }

  const Comp = editorComponents[name];
  if (!Comp) return <ChromeNodeView {...props} />;

  const compProps = cleanAttrs(props.node.attrs);
  if (FORCE_OPEN.has(name)) compProps.defaultOpen = true;
  return (
    <NodeViewWrapper className="pv-visual-node">
      <Comp {...compProps}>
        <NodeViewContent />
      </Comp>
    </NodeViewWrapper>
  );
}

/** Live image: resolve a root-absolute src to the tenant asset URL (mirrors the renderer's
 *  withBase), so `/img/hero.png` actually loads in the editor instead of 404ing on the app host. */
function makeImageNodeView(assetBase: string) {
  return function ImageNodeView({ node }: NodeViewProps) {
    const src = (node.attrs.src as string) || "";
    const resolved = assetBase && src.startsWith("/") && !src.startsWith("//") ? assetBase + src : src;
    return (
      <NodeViewWrapper as="span" className="pv-visual-img">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolved}
          alt={(node.attrs.alt as string) ?? ""}
          title={(node.attrs.title as string) ?? undefined}
          width={(node.attrs.width as string) ?? undefined}
          height={(node.attrs.height as string) ?? undefined}
        />
      </NodeViewWrapper>
    );
  };
}

function BlockAtomView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper className="my-2" contentEditable={false}>
      <pre className="overflow-x-auto rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        {node.attrs.raw as string}
      </pre>
    </NodeViewWrapper>
  );
}

function InlineAtomView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="rounded border border-dashed border-amber-300 bg-amber-50 px-1 font-mono text-[0.85em] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {node.attrs.raw as string}
    </NodeViewWrapper>
  );
}

/** Code block node view: a ```mermaid fence renders the live Mermaid diagram above its editable
 *  source (matching the renderer, which converts the fence to <Mermaid>); other languages render
 *  as a normal editable code block. Keeping the source as a fenced code block means it round-trips
 *  byte-exact — no rewrite to <Mermaid> JSX. */
function CodeBlockNodeView({ node }: NodeViewProps) {
  const language = (node.attrs.language as string) || "";
  const isMermaid = language.toLowerCase() === "mermaid";
  const chart = node.textContent;
  return (
    <NodeViewWrapper className="pv-codeblock">
      {isMermaid && chart.trim() && (
        <div contentEditable={false} className="pv-mermaid-preview">
          <Mermaid chart={chart} />
        </div>
      )}
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export function makeNodeViewOpts(assetBase: string): NodeViewOpts {
  const ImageNodeView = makeImageNodeView(assetBase);
  return {
    componentNodeView: () => ReactNodeViewRenderer(ComponentNodeView),
    atomNodeView: (_type, inline) => ReactNodeViewRenderer(inline ? InlineAtomView : BlockAtomView),
    imageNodeView: () => ReactNodeViewRenderer(ImageNodeView),
    codeBlockNodeView: () => ReactNodeViewRenderer(CodeBlockNodeView),
  };
}
