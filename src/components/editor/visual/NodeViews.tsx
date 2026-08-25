"use client";

import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { editorComponents, Mermaid } from "@papervine/renderer/components/mdx/editor-registry";
import type { CSSProperties } from "react";
import type { NodeViewOpts } from "./nodes";
import { TabPaneNodeView, TabsNodeView } from "./TabsNodeView";
import { StepNodeView, StepsNodeView } from "./StepsNodeView";
import { parseMediaElement } from "@/lib/media-embed";

// Phase-2b node views: render the SAME components the reader-facing renderer uses, so the
// Visual editor looks like the published page. The component's own markup (card grid, callout
// colour + icon, step rail) wraps an editable content hole (NodeViewContent) — you edit the
// body in place. Props come from the node's attrs (title/icon/href/…), which are generally still
// a Source-mode job — the exceptions are the ones where the attr IS the thing you edit: tab and
// step titles have purpose-built views with real fields (TabsNodeView, StepsNodeView), and Tabs
// gets a whole tab strip. CodeGroup, which also picks its children apart structurally, still
// falls back to labelled chrome. Unknown MDX renders its raw source, read-only.

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

/** Labelled editor chrome — for components we don't render live (CodeGroup, Frame, …). */
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

function hasPaneChildren(node: NodeViewProps["node"]): boolean {
  let found = false;
  node.forEach((child) => {
    if (child.type.name === "tab") found = true;
  });
  return found;
}

/** Live render of a real MDX component wrapping an editable content hole. */
function ComponentNodeView(props: NodeViewProps) {
  const name = props.node.attrs.mdxName as string;

  // Tabs is structural rather than presentational: the strip is chrome that has to know about
  // its siblings, so it owns both halves of the pair — the parent renders the tab bar, the child
  // renders a bare pane the parent can show or hide.
  //
  // Only when the panes are real `tab` NODES, though. MDX parses the compact form —
  // `<Tab title="npm">…</Tab>` with its body on the same line — as inline JSX inside a paragraph,
  // so the converter yields mdxUnknownText atoms and there is nothing for a strip to switch
  // between. Rendering an empty tab bar over them would hide that the content is there; the
  // labelled chrome that has always handled this shape still shows it.
  if (name === "Tabs") {
    return hasPaneChildren(props.node) ? <TabsNodeView {...props} /> : <ChromeNodeView {...props} />;
  }
  if (name === "Tab") return <TabPaneNodeView />;

  // Steps/Step render live from the registry like any other component, but both need a control
  // the generic view can't supply: a button to add a step, and a title slot to type into (the
  // title is an attr, so it can't be part of the editable content hole).
  if (name === "Steps") return <StepsNodeView {...props} />;
  if (name === "Step") return <StepNodeView {...props} />;

  // Layout containers apply their grid/flex to their DIRECT children — but ProseMirror's
  // content hole is a single element, so wrapping the real component around it collapses the
  // layout. Put the layout ON the content hole instead so the child nodes become grid items.
  if (name === "CardGroup" || name === "Columns") {
    const cols = Number(props.node.attrs.cols) || 2;
    return (
      <NodeViewWrapper className="my-5">
        <NodeViewContent
          // Mirrors CardGroup's responsive collapse, so the editor shows what readers get.
          className="pv-cardgrid grid grid-cols-1 gap-4 sm:grid-cols-[repeat(var(--pv-cols),minmax(0,1fr))]"
          style={{ "--pv-cols": cols } as CSSProperties}
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

/** Raw MDX we couldn't map to a node: shown as its own source, read-only — EXCEPT video and
 *  iframe, which are raw HTML on purpose (the schema has no video component) and would otherwise
 *  be the one kind of content you can put on a page and never see. `parseMediaElement` returns
 *  null for anything it can't render faithfully, so the source box stays the fallback. */
function makeBlockAtomView(assetBase: string) {
  return function BlockAtomView({ node }: NodeViewProps) {
    const raw = node.attrs.raw as string;
    const media = parseMediaElement(raw);
    if (media) {
      // Same base resolution as the image node view: a root-relative path belongs to the tenant's
      // assets, and the editor is served from the app host, so it would 404 unresolved.
      const src =
        assetBase && media.src.startsWith("/") && !media.src.startsWith("//")
          ? assetBase + media.src
          : media.src;
      const has = (flag: string) => media.flags.includes(flag);
      return (
        <NodeViewWrapper className="my-4" contentEditable={false}>
          {media.tag === "video" ? (
            <video
              src={src}
              poster={media.poster}
              controls={has("controls")}
              muted={has("muted")}
              loop={has("loop")}
              autoPlay={has("autoplay")}
              playsInline={has("playsinline")}
              className={media.className}
            />
          ) : (
            <iframe
              src={src}
              title={media.title ?? "Embedded content"}
              allowFullScreen={has("allowfullscreen")}
              className={media.className}
            />
          )}
        </NodeViewWrapper>
      );
    }
    return (
      <NodeViewWrapper className="my-2" contentEditable={false}>
        <pre className="overflow-x-auto rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {raw}
        </pre>
      </NodeViewWrapper>
    );
  };
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
  const BlockAtomView = makeBlockAtomView(assetBase);
  return {
    componentNodeView: () => ReactNodeViewRenderer(ComponentNodeView),
    atomNodeView: (_type, inline) => ReactNodeViewRenderer(inline ? InlineAtomView : BlockAtomView),
    imageNodeView: () => ReactNodeViewRenderer(ImageNodeView),
    codeBlockNodeView: () => ReactNodeViewRenderer(CodeBlockNodeView),
  };
}
