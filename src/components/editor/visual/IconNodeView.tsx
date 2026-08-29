"use client";

import { useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Icon } from "@papervine/renderer/components/mdx/Icon";
import { IconPicker } from "./IconPicker";

// <Icon> in the Visual editor: the published icon, and a click to change which one.
//
// It's an atom — a childless inline node — so it selects, arrows past and deletes as one thing.
// An icon-less `<Icon />` renders nothing at all for readers (LucideIcon returns null), which in
// an editor would be an invisible node you can't fix; here it shows as a chip that says what it
// needs. Inserted from the `/` menu it opens its picker straight away, since choosing the icon IS
// the insertion.

export function IconNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const icon = ((node.attrs.icon as string | null) ?? (node.attrs.src as string | null)) ?? null;
  // Opens on mount only for a freshly inserted one: no icon yet, and the selection is on it.
  // Reading the initial value once (a ref, not state derived per render) keeps a later selection
  // of an icon-less node from re-opening the picker under the cursor.
  const openOnMount = useRef(!icon && selected);
  const [picking, setPicking] = useState(openOnMount.current);
  const button = useRef<HTMLButtonElement>(null);

  const props = {
    icon: (node.attrs.icon as string | null) ?? undefined,
    src: (node.attrs.src as string | null) ?? undefined,
    color: (node.attrs.color as string | null) ?? undefined,
    size: (node.attrs.size as number | null) ?? undefined,
    className: (node.attrs.className as string | null) ?? undefined,
  };

  return (
    <NodeViewWrapper as="span" className="pv-inline-node">
      <button
        ref={button}
        type="button"
        contentEditable={false}
        onClick={() => setPicking(true)}
        aria-label={icon ? `Icon: ${icon}` : "Insert icon"}
        title={icon ? `Icon: ${icon}` : "Insert icon"}
        className={`pv-icon-node${selected ? " is-selected" : ""}${icon ? "" : " is-empty"}`}
      >
        {icon ? <Icon {...props} /> : "Insert icon"}
      </button>
      {picking && (
        <IconPicker
          icon={(node.attrs.icon as string | null) ?? null}
          anchor={button.current}
          onPick={(name) => {
            updateAttributes({ icon: name });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </NodeViewWrapper>
  );
}
