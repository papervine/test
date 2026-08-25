"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Plus } from "lucide-react";
import { Step, Steps } from "@papervine/renderer/components/mdx/editor-registry";

// <Steps> and <Step> in the Visual editor: the real reader-facing components, plus the two things
// editing them needs — a button to add a step, and a title slot to type into.
//
// Both node views hand a control INTO the real component rather than rebuilding its markup. The
// step badges are absolutely positioned against the rail <Steps> itself draws (`border-l` inset by
// its own margin and padding), and the title is a styled heading — so passing the button in as a
// child and the title as `title` inherits that styling, where a copy of the classes would drift
// the day the component is restyled. `Step`'s `title` prop is typed as ReactNode for exactly this.

/** The `+` on the end of the rail, where the next number would be. */
export function StepsNodeView({ node, editor, getPos }: NodeViewProps) {
  const addStep = () => {
    // undefined once the node view is detached (its node left the document).
    const base = typeof getPos === "function" ? getPos() : undefined;
    const type = editor.schema.nodes.step;
    if (base === undefined || !type) return;

    // Just inside the closing token, so the new step lands last.
    const at = base + node.nodeSize - 1;
    // No `title` attr: it defaults to null and serializes away, so an untitled step round-trips
    // as `<Step>` rather than a `title=""` someone has to clean up. The slot to type it into is
    // rendered regardless — see StepNodeView.
    const fresh = type.create({ mdxName: "Step" }, editor.schema.nodes.paragraph.create());
    editor.view.dispatch(editor.state.tr.insert(at, fresh));

    // Focus the new step's title, so the click is immediately followed by typing — a step starts
    // with its name. nodeDOM(at) addresses the inserted node directly instead of guessing that
    // the last title input on the page is the right one.
    requestAnimationFrame(() => {
      const dom = editor.view.nodeDOM(at);
      const input = dom instanceof HTMLElement ? dom.querySelector("input") : null;
      if (input) input.focus();
    });
  };

  return (
    <NodeViewWrapper className="pv-visual-node">
      <Steps>
        <NodeViewContent />
        {/* contentEditable={false}: chrome, not document content — without it ProseMirror reads
            clicks and keystrokes here as edits to the doc. The row also becomes the container's
            last child, so the last real step stops matching `last:mb-0` and gets its bottom
            margin back, which is the gap you want above the button. */}
        <div contentEditable={false} className="relative h-7">
          <button
            type="button"
            onClick={addStep}
            aria-label="Add step"
            title="Add step"
            className="absolute -left-[2.35rem] flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </Steps>
    </NodeViewWrapper>
  );
}

/** A step: an editable title above its editable body. */
export function StepNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const title = (node.attrs.title as string | null) ?? "";

  // Committed on every keystroke rather than on blur, so the title is in the document — and
  // therefore in the autosaved draft — even if the page is switched mid-word. Safe to do per
  // key: an attrs-only change lets TipTap update the existing node view instead of recreating
  // it, so the input keeps its DOM node and its caret, and setNodeMarkup moves no selection.
  // Empty commits back to null so it serializes as `<Step>`, never `title=""`.
  const commit = (value: string) => updateAttributes({ title: value.trim() === "" ? null : value });

  // Enter in the title moves into the body — a step is a name then a description, and that's the
  // order you write it in.
  const toBody = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    const { doc } = editor.state;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(base + 2, doc.content.size)))),
    );
    editor.view.focus();
  };

  return (
    <NodeViewWrapper className="pv-visual-node">
      <Step
        title={
          // Always rendered, so an untitled step still shows somewhere to put a name. Passing it
          // as `title` puts it inside the component's own <h3>, which is where the styling is.
          <span contentEditable={false} className="block">
            <input
              value={title}
              placeholder="Step title"
              aria-label="Step title"
              onChange={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  toBody();
                }
              }}
              className="w-full bg-transparent outline-none placeholder:font-normal placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </span>
        }
      >
        <NodeViewContent />
      </Step>
    </NodeViewWrapper>
  );
}
