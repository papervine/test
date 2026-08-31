"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

// <Update> in the Visual editor: a changelog entry — a label in the left column, the entry's body
// on the right.
//
// Drawn here rather than by the reader's component, for the reason the tree and the colour
// swatches are: both authored parts (`label`, `description`) are ATTRS, and the reader's `<Update>`
// renders the label as an anchor — there is no slot to type into and nothing that would make an
// `<a>` editable. So the layout is mirrored (same two-column grid, same rule under each entry) and
// the two attrs come back as fields, while the body stays the content hole it already was.
//
// `tags` is a list, and the converter models it (the one expression shape it reads — see
// components.ts), so it has to be visible AND editable here: an attr the model keeps but the editor
// ignores reads as "my tags disappeared". It's one comma-separated field rather than a chip editor,
// because that is exactly how the attr reads in source and it needs no new UI vocabulary. The
// richer control belongs to the component-properties panel when that lands.

export function UpdateNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const label = (node.attrs.label as string | null) ?? "";
  const description = (node.attrs.description as string | null) ?? "";
  const tags = Array.isArray(node.attrs.tags) ? (node.attrs.tags as string[]) : [];

  // Committed per keystroke, like a card's title: an attrs-only change updates the existing node
  // view rather than recreating it, so the field keeps its DOM node and its caret — and the label
  // reaches the autosaved draft even if the page is switched mid-word. Empty commits back to null,
  // so it serializes as `<Update>` and never `description=""`.
  const commitText = (key: string, value: string) =>
    updateAttributes({ [key]: value.trim() === "" ? null : value });

  // Committed on blur/Enter rather than per keystroke: splitting on every character would fight the
  // typist ("api," becoming a tag the moment the comma lands, then re-joining as they keep typing).
  const commitTags = (value: string) => {
    const list = value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    updateAttributes({ tags: list.length ? list : null });
  };

  /** Enter in a field drops into the entry's body — an update is a date, then what changed. */
  const toBody = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    const { doc } = editor.state;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(doc.resolve(Math.min(base + 2, doc.content.size))),
      ),
    );
    editor.view.focus();
  };

  return (
    <NodeViewWrapper className="pv-update">
      <div contentEditable={false} className="pv-update-meta">
        {/* The label is what readers get as the anchor for this entry, so it reads as the link it
            will become — and it's required: an entry with no label has no heading and nothing to
            link to, which the placeholder says rather than leaving an empty box. */}
        <input
          className="pv-update-label"
          value={label}
          placeholder="2026-08-31"
          aria-label="Update label"
          onChange={(e) => commitText("label", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              toBody();
            }
          }}
        />
        <input
          className="pv-update-desc"
          value={description}
          placeholder="Add a description"
          aria-label="Update description"
          onChange={(e) => commitText("description", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              toBody();
            }
          }}
        />
        {/* Keyed on the tag list so retyping it externally (Source mode, the agent) refreshes the
            field — it's uncontrolled, so React would otherwise keep the stale value on screen. */}
        <input
          key={tags.join(",")}
          className="pv-update-tags"
          defaultValue={tags.join(", ")}
          placeholder="Tags, comma separated"
          aria-label="Update tags"
          onBlur={(e) => commitTags(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTags((e.target as HTMLInputElement).value);
              toBody();
            }
          }}
        />
      </div>
      <NodeViewContent className="pv-update-body" />
    </NodeViewWrapper>
  );
}
