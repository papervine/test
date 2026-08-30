"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Check, Copy, Plus, Trash2, X } from "lucide-react";
import { hiddenCodeRule } from "./tabs-plan";
import { codeTabLabel, withCodeTitle } from "./code-meta";
import { LanguagePicker } from "./LanguagePicker";

// <CodeGroup> in the Visual editor: the tab strip readers get, with the four things editing one
// needs — switch, rename, add, remove — plus the language of the block you're looking at, a copy
// button, and a control to delete the group itself.
//
// It used to fall back to labelled chrome, for the same reason <Tabs> did: a group "picks its
// children apart structurally" and ProseMirror gives a node view exactly ONE content hole. The way
// through is the one the tab strip already proved — render every block into that hole and hide all
// but the active one with a scoped <style>, which survives ProseMirror re-rendering its children
// where toggling a class from an effect would not. Which block is showing is view state and lives
// in React, never in the document.
//
// The chrome deliberately mirrors the reader's CodeGroup (same border, same strip, same
// primary-coloured active tab) rather than inventing editor-only styling — see AccordionNodeView
// for the same call.
//
// A tab's label is the fence's own title (```ts app.ts / ```ts title="app.ts"), read and written
// through `code-meta` so what you type here is exactly what the reader's tab says.

/** NOT useId(): TipTap mounts each node view in its own React root, so useId() collides. */
let nextScopeId = 0;

interface Block {
  /** Index among the group's children — the hidden-pane rule counts these. */
  domIndex: number;
  pos: number;
  size: number;
  label: string;
  language: string;
  meta: string | null;
  text: string;
}

export function CodeGroupNodeView({ node, editor, getPos }: NodeViewProps) {
  const [scopeId] = useState(() => `pvcode${(nextScopeId++).toString(36)}`);
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Recomputed every render: an edit earlier in the document shifts every position, so a cached
  // one is stale the moment anything else changes. undefined once the node view is detached.
  const base = typeof getPos === "function" ? getPos() : undefined;
  const blocks: Block[] = [];
  let childIndex = 0;
  node.forEach((child, offset) => {
    const domIndex = childIndex++;
    if (child.type.name !== "codeBlock" || base === undefined) return;
    const meta = (child.attrs.meta as string | null) ?? null;
    const language = (child.attrs.language as string | null) ?? "";
    blocks.push({
      domIndex,
      pos: base + 1 + offset,
      size: child.nodeSize,
      label: codeTabLabel(meta, language) || `Block ${blocks.length + 1}`,
      language,
      meta,
      text: child.textContent,
    });
  });

  const current = Math.min(active, Math.max(0, blocks.length - 1));
  const showIndex = blocks[current]?.domIndex ?? 0;

  const addBlock = () => {
    if (base === undefined) return;
    const type = editor.schema.nodes.codeBlock;
    if (!type) return;
    // Just inside the closing token, so the new block lands last. It inherits the language of the
    // one you were looking at: a group is usually the same snippet in one language per tab, and
    // "same as the last" is right more often than "none".
    const at = base + node.nodeSize - 1;
    const language = blocks[current]?.language || null;
    // The caret goes INTO the new block, so typing continues there. Without this the selection
    // stayed wherever it was — outside the block you just added — and a click into the empty fence
    // could land between blocks instead (see the pre/code rule in platform.css).
    const tr = editor.state.tr.insert(at, type.create({ language, meta: null }));
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    editor.view.dispatch(tr);
    editor.view.focus();
    setActive(blocks.length);
  };

  const removeBlock = (index: number) => {
    const block = blocks[index];
    // Refuse the last one: a <CodeGroup> with nothing in it renders as nothing and can't be
    // recovered from the strip. Deleting the whole group is what the bin beside the + is for.
    if (!block || blocks.length <= 1) return;
    editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + block.size));
    setActive((a) => (a >= blocks.length - 1 ? Math.max(0, blocks.length - 2) : a));
  };

  const removeGroup = () => {
    if (base === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(base, base + node.nodeSize));
  };

  /** Rewrite one attr on a block, reading its node fresh — `blocks` is a render-time snapshot. */
  const setAttr = (index: number, attrs: Record<string, unknown>) => {
    const block = blocks[index];
    if (!block) return;
    const child = editor.state.doc.nodeAt(block.pos);
    if (!child) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(block.pos, undefined, { ...child.attrs, ...attrs }),
    );
  };

  const renameBlock = (index: number, title: string) => {
    const block = blocks[index];
    if (block) setAttr(index, { meta: withCodeTitle(block.meta, title) });
  };

  const copyBlock = () => {
    const text = blocks[current]?.text ?? "";
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <NodeViewWrapper className="pv-codegroup my-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {/* contentEditable={false}: the strip is chrome, not document content. Without it
          ProseMirror reads clicks and keystrokes in here as edits to the doc. */}
      <div
        contentEditable={false}
        className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <style>{hiddenCodeRule(scopeId, showIndex + 1)}</style>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {blocks.map((block, i) => (
            <span
              key={i}
              // The active tab is the site's `primary`, the same colour the reader's own
              // <CodeGroup> underlines with — this half of the strip is a preview of the published
              // component, so it follows the site's brand. The editor-only controls beside it
              // (+ / ✕ / bin / language) are violet, like every other piece of editor furniture.
              className={`pv-codegroup-tab flex shrink-0 items-center gap-1 border-b-2 px-2 py-1.5 text-xs font-medium ${
                i === current
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {renaming === i ? (
                <input
                  autoFocus
                  defaultValue={block.label}
                  aria-label="File name"
                  size={Math.max(block.label.length, 6)}
                  onBlur={(e) => {
                    renameBlock(i, e.target.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="bg-transparent px-1 outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  onDoubleClick={() => setRenaming(i)}
                  title="Double-click to rename"
                  className="px-1"
                >
                  {block.label}
                </button>
              )}
              {/* Only the active tab offers removal, so a stray click never deletes a block you
                  aren't looking at. Absent entirely when it's the last one — see removeBlock. */}
              {i === current && blocks.length > 1 && renaming !== i && (
                <button
                  type="button"
                  onClick={() => removeBlock(i)}
                  aria-label={`Remove ${block.label}`}
                  title="Remove this block"
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            onClick={addBlock}
            aria-label="Add code block"
            title="Add code block"
            className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          {blocks[current] && (
            <LanguagePicker
              language={blocks[current].language}
              onPick={(id) => setAttr(current, { language: id || null })}
            />
          )}
          <button
            type="button"
            onClick={copyBlock}
            aria-label="Copy code"
            title="Copy code"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={removeGroup}
            aria-label="Delete code group"
            title="Delete code group"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {/* One content hole holding every block; the rule above shows only the active one. The
          flattening mirrors the reader's CodeGroup, which does the same to its <pre>s. */}
      <NodeViewContent
        data-pv-codegroup={scopeId}
        className="pv-codegroup-body [&_pre]:my-0 [&_pre]:rounded-none [&_pre]:border-0"
      />
    </NodeViewWrapper>
  );
}
