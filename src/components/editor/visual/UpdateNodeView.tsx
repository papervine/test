"use client";

import { useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Columns2 } from "lucide-react";
import { PropertiesButton, PropertiesPanel, type PropertyRow } from "./PropertiesPanel";

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
  const [props, setProps] = useState(false);
  const propsButton = useRef<HTMLSpanElement>(null);

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

  // The same three attrs the inline fields edit, with their names and a sentence each — plus `rss`,
  // which has nowhere to live in the document at all. Written for THIS renderer: an entry's
  // description sits under its title here, not beside the label, so the help says so rather than
  // repeating a description of somebody else's layout.
  const rows: PropertyRow[] = [
    {
      name: "Label",
      required: true,
      help: "Shown to the left of the entry, and its anchor — a reader can link straight to this entry. Keep them unique within a page.",
      field: (
        <input
          className="pv-props-input"
          value={label}
          placeholder="2026-08-31"
          aria-label="Label"
          onChange={(e) => commitText("label", e.target.value)}
        />
      ),
    },
    {
      name: "Tags",
      help: "Small pills under the label. Comma separated.",
      field: (
        <input
          key={tags.join(",")}
          className="pv-props-input"
          defaultValue={tags.join(", ")}
          placeholder="release, api"
          aria-label="Tags"
          onBlur={(e) => commitTags(e.target.value)}
        />
      ),
    },
    {
      name: "Description",
      help: "A line under the entry's title, for a version number or a one-line summary.",
      field: (
        <input
          className="pv-props-input"
          value={description}
          placeholder="v1.2.0"
          aria-label="Description"
          onChange={(e) => commitText("description", e.target.value)}
        />
      ),
    },
    {
      name: "Rss",
      // No field on purpose. `rss={{title, description}}` is an object, which the converter doesn't
      // model — an entry carrying one is kept as raw MDX (byte-exact, editable in Source mode) — and
      // this renderer ignores it anyway, because a feed is a site-level concern rather than
      // something one entry can produce. A box that wrote a prop with no effect, and demoted the
      // block out of the Visual editor while doing it, would be worse than saying so.
      help: "Per-entry feed metadata. Not editable here: it's an object, so it lives in Source mode — and feeds are generated per site, not per entry.",
    },
  ];

  return (
    <NodeViewWrapper className="pv-update">
      {/* Top-right, over the entry rather than inside it: an editor affordance shouldn't become a
          prop on the component readers get. */}
      <span ref={propsButton} className="pv-update-actions">
        <PropertiesButton label="Update properties" onClick={() => setProps((o) => !o)} />
      </span>
      {props && (
        <PropertiesPanel
          title="Update properties"
          icon={Columns2}
          anchor={propsButton.current}
          rows={rows}
          onClose={() => setProps(false)}
        />
      )}
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
        {/* Only the label lives in the document. `description` and `tags` are edited in the ⋯ panel
            instead of here, and that is a deliberate second choice rather than laziness: for readers
            the description sits UNDER THE TITLE (the component splits the author's children around
            their own first heading to place it there), and the title is inside this node's editable
            body — a field cannot sit between two lines of one content hole. The options were a field
            in the wrong place, which is a WYSIWYG editor lying about where the text will appear, or
            a field in the panel, one click away, with a sentence saying where it lands. The panel
            wins. Preview shows the real thing either way. */}
      </div>
      <NodeViewContent className="pv-update-body" />
    </NodeViewWrapper>
  );
}
