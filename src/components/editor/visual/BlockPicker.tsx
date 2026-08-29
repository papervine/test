"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { SLASH_CATEGORIES, filterSlashItems, type RequestInput, type SlashItem } from "./menu-items";

/**
 * The "+" block picker — a standalone, searchable popover (hosted docs platforms' "Sections / Type to
 * search"). Unlike the `/` slash menu (which rides TipTap's keyboard-only Suggestion),
 * this is fully controlled, so it can be opened by a button click. Selecting an item inserts
 * that block at `insertPos` (just after the hovered block).
 */
export function BlockPicker({
  editor,
  x,
  y,
  insertPos,
  replaceRange,
  requestInput,
  allowItem,
  onClose,
}: {
  editor: Editor;
  x: number;
  y: number;
  insertPos: number;
  // When set (from the drag handle's "Turn into"), the selected block REPLACES this range
  // instead of being inserted at insertPos.
  replaceRange?: { from: number; to: number };
  // Media items need a URL first; the host owns that dialog (see MediaDialog).
  requestInput: RequestInput;
  // Which blocks to offer. Defaults to all; a host with no asset storage passes NO_MEDIA.
  allowItem?: (item: SlashItem) => boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = filterSlashItems(query, allowItem);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setSelected(0), [query]);

  const insert = (node: object | null) => {
    if (!node) return;
    if (replaceRange) {
      editor.chain().focus().deleteRange(replaceRange).insertContentAt(replaceRange.from, node).run();
    } else {
      editor.chain().focus().insertContentAt(insertPos, node).run();
    }
  };

  const choose = (item: SlashItem) => {
    // Media items need a URL first. Close this popover before the dialog opens — two stacked
    // overlays with the dialog stealing focus reads as the picker having frozen.
    if (item.input) {
      onClose();
      requestInput(item.input, (value) => insert(item.make(value)));
      return;
    }
    insert(item.make());
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s + items.length - 1) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selected]) choose(items[selected]);
    }
  };

  // Keep the popover on-screen (clamp near the right/bottom edges).
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - 420);

  return (
    <>
      <div className="pv-picker-overlay" onClick={onClose} />
      <div className="pv-picker db-portal" style={{ top, left }}>
        <input
          ref={inputRef}
          className="pv-picker-search"
          placeholder="Type to search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="pv-picker-list">
          {items.length === 0 && <div className="pv-slash-empty">No matching blocks</div>}
          {SLASH_CATEGORIES.map((category) => {
            const inCategory = items.filter((it) => it.category === category);
            if (!inCategory.length) return null;
            return (
              <div key={category}>
                <div className="pv-slash-category">{category}</div>
                {inCategory.map((item) => {
                  const i = items.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.title}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => choose(item)}
                      className={`pv-slash-item${i === selected ? " is-active" : ""}`}
                    >
                      <span className="pv-slash-icon">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="pv-slash-text">
                        <span className="pv-slash-title">{item.title}</span>
                        <span className="pv-slash-desc">{item.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
