"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { SLASH_CATEGORIES, type SlashItem } from "./menu-items";

export interface SlashMenuHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

// The `/` command palette. Rendered into a tippy popup by SlashCommand; exposes onKeyDown so
// the editor's keymap can drive selection (arrows/enter) while the menu is open.
export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(function SlashMenu(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((s) => (s + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return <div className="pv-slash-empty">No matching blocks</div>;
  }

  // `items` keeps its flat order (keyboard nav indexes into it); we render category headers
  // between groups. `flatIndex` maps each rendered row back to that flat index.
  let flatIndex = -1;
  return (
    <div className="pv-slash-menu">
      {SLASH_CATEGORIES.map((category) => {
        const inCategory = items.filter((it) => it.category === category);
        if (!inCategory.length) return null;
        return (
          <div key={category} className="pv-slash-group">
            <div className="pv-slash-category">{category}</div>
            {inCategory.map((item) => {
              flatIndex = items.indexOf(item);
              const i = flatIndex;
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.title}
                  onClick={() => command(item)}
                  onMouseEnter={() => setSelected(i)}
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
  );
});
