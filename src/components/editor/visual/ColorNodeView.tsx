"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Plus, Trash2 } from "lucide-react";

// <Color> in the Visual editor: the swatches, with the two things a swatch is — a colour and a
// name — editable on the swatch itself.
//
// Like the tree, this is drawn here rather than by the reader's component, and for the same
// reason: a `<Color.Item>` has no content hole (its name and value are attrs), so there would be
// nothing to type into. The swatch tiles match the published ones; the "+" and the editor popover
// are the parts readers never see.
//
// A `value={{ light, dark }}` pair is deliberately NOT modeled: it's an expression attr, so the
// converter keeps that swatch as raw source and it shows here as its own MDX — which is the
// passthrough guarantee doing its job rather than a gap. Editing one is a Source-mode job.

export function ColorNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const variant = ((node.attrs.variant as string | null) ?? "compact") as "compact" | "table";

  const addItem = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    const type = editor.schema.nodes.colorItem;
    if (!type) return;
    editor.view.dispatch(
      editor.state.tr.insert(
        base + node.nodeSize - 1,
        type.create({ mdxName: "Color.Item", value: "#e7e5e4", name: "new-color" }),
      ),
    );
  };

  return (
    <NodeViewWrapper className="pv-color">
      <div contentEditable={false} className="pv-color-head">
        <label className="pv-color-variant">
          Variant
          <select
            value={variant}
            aria-label="Colour layout"
            onChange={(e) => updateAttributes({ variant: e.target.value })}
          >
            <option value="compact">Compact</option>
            <option value="table">Table</option>
          </select>
        </label>
      </div>
      <div className={`pv-color-body is-${variant}`}>
        <NodeViewContent className="pv-color-items" />
        {/* Outside the content hole: it's chrome, and ProseMirror owns what's inside. */}
        <button
          type="button"
          contentEditable={false}
          onClick={addItem}
          aria-label="Add a colour"
          title="Add a colour"
          className="pv-color-add"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

/** A row of swatches under a heading — `<Color.Row title="Brand">`. */
export function ColorRowNodeView({ node, updateAttributes }: NodeViewProps) {
  const title = (node.attrs.title as string | null) ?? "";
  return (
    <NodeViewWrapper className="pv-color-row">
      <input
        contentEditable={false}
        value={title}
        placeholder="Group name"
        aria-label="Colour group name"
        onChange={(e) => updateAttributes({ title: e.target.value || null })}
        className="pv-color-row-title"
      />
      <NodeViewContent className="pv-color-items" />
    </NodeViewWrapper>
  );
}

/** One swatch: the tile readers see, and a popover to change what it is. */
export function ColorItemNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const value = (node.attrs.value as string | null) ?? "";
  const name = (node.attrs.name as string | null) ?? "";
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: -9999, left: -9999 });
  const tile = useRef<HTMLButtonElement>(null);

  // Portaled and measured, like the icon and language menus: the palette rounds its corners with
  // `overflow: hidden`, which clipped a popover rendered in place down to a sliver.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = tile.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      top: Math.min(rect.bottom + 6, window.innerHeight - 260),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 258)),
    });
  }, [open]);

  const remove = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(base, base + node.nodeSize));
  };

  // `<input type="color">` needs a 6-digit hex and silently ignores anything else, so the picker
  // falls back to white while the text field keeps whatever CSS colour was authored (`hsl(...)`,
  // `var(--brand)`) — typing one there must not have the picker rewrite it.
  const asHex = /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "#ffffff";

  return (
    <NodeViewWrapper className="pv-color-item">
      <button
        ref={tile}
        type="button"
        contentEditable={false}
        onClick={() => setOpen((o) => !o)}
        aria-label={name ? `Edit ${name}` : "Edit colour"}
        title={name || value}
        className="pv-color-swatch"
        style={{ background: value || "transparent" }}
      />
      <span contentEditable={false} className="pv-color-label">
        {name && <span className="pv-color-name">{name}</span>}
        <span className="pv-color-value">{value}</span>
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="pv-picker-overlay" onClick={() => setOpen(false)} />
            <div
              className="pv-color-edit db-portal"
              style={{ top: at.top, left: at.left }}
              // On the panel, not on each field: Escape has to close it from wherever the focus
              // is, and a field that swallowed the key would leave the overlay covering the page.
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") setOpen(false);
              }}
            >
              <span className="pv-color-edit-head">Edit colour</span>
              <label className="pv-color-field">
                Colour
                <span className="pv-color-input">
                  <input
                    type="color"
                    value={asHex}
                    aria-label="Colour"
                    onChange={(e) => updateAttributes({ value: e.target.value })}
                  />
                  <input
                    value={value}
                    aria-label="Colour value"
                    placeholder="#e7e5e4"
                    onChange={(e) => updateAttributes({ value: e.target.value || null })}
                  />
                </span>
              </label>
              <label className="pv-color-field">
                Name
                <input
                  value={name}
                  aria-label="Colour name"
                  placeholder="gray-200"
                  onChange={(e) => updateAttributes({ name: e.target.value || null })}
                />
              </label>
              <button type="button" onClick={remove} className="pv-color-delete">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </>,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
