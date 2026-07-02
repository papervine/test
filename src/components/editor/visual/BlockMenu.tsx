"use client";

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Repeat2, CopyPlus, Trash2, ChevronRight } from "lucide-react";

/**
 * The drag-handle click menu (Notion-style): Turn into / Duplicate / Delete, acting on the
 * block the handle is over. "Turn into" hands off to the block picker in replace mode.
 */
export function BlockMenu({
  editor,
  x,
  y,
  pos,
  node,
  onTurnInto,
  onClose,
}: {
  editor: Editor;
  x: number;
  y: number;
  pos: number;
  node: PMNode;
  onTurnInto: () => void;
  onClose: () => void;
}) {
  const duplicate = () => {
    editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
    onClose();
  };
  const remove = () => {
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    onClose();
  };

  return (
    <>
      <div className="pv-picker-overlay" onClick={onClose} />
      <div className="pv-blockmenu db-portal" style={{ top: y, left: x }}>
        <button type="button" className="pv-blockmenu-item" onClick={onTurnInto}>
          <Repeat2 className="h-4 w-4" />
          <span>Turn into</span>
          <ChevronRight className="ml-auto h-4 w-4 opacity-60" />
        </button>
        <div className="pv-blockmenu-sep" />
        <button type="button" className="pv-blockmenu-item" onClick={duplicate}>
          <CopyPlus className="h-4 w-4" />
          <span>Duplicate</span>
        </button>
        <button type="button" className="pv-blockmenu-item pv-blockmenu-danger" onClick={remove}>
          <Trash2 className="h-4 w-4" />
          <span>Delete</span>
        </button>
      </div>
    </>
  );
}
