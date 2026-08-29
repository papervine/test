"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { LucideIcon } from "@papervine/renderer/components/LucideIcon";
import { filterIcons } from "./icon-names";

const WIDTH = 340;
const HEIGHT = 400;

/**
 * The icon chooser behind a `<Card>`'s icon slot: search the Lucide set, click one, or take the
 * one that's there back off.
 *
 * Portaled to <body> for the same reason the language menu is — a card lives inside a grid cell
 * that clips, and the popover is taller than the card. It sits outside the `.db` shell, so it
 * carries `db-portal` and its own dark surface, like the `/` palette.
 */
export function IconPicker({
  icon,
  anchor,
  onPick,
  onClose,
}: {
  icon: string | null;
  /** The button the picker opens from; the popover is measured against its box. */
  anchor: HTMLElement | null;
  onPick: (name: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  const names = filterIcons(query);

  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    // Prefer above the button (the card's body is below it and worth keeping in view), and fall
    // back to below when there isn't room.
    const above = rect.top - HEIGHT - 8;
    setAt({
      top: above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - HEIGHT - 8),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8)),
    });
  }, [anchor]);

  useEffect(() => inputRef.current?.focus(), []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="pv-picker-overlay" onClick={onClose} />
      <div className="pv-iconpicker db-portal" style={{ top: at.top, left: at.left }}>
        <div className="pv-iconpicker-head">
          <span className="pv-iconpicker-tab">Icons</span>
          {/* Only offered when there IS one — "Remove" on a card with no icon is a control that
              does nothing. */}
          {icon && (
            <button type="button" onClick={() => onPick(null)} className="pv-iconpicker-remove">
              Remove
            </button>
          )}
        </div>
        <label className="pv-iconpicker-search">
          <Search className="h-4 w-4 shrink-0 opacity-60" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Search icons…"
            aria-label="Search icons"
          />
        </label>
        <div className="pv-iconpicker-grid">
          {names.length === 0 && <div className="pv-lang-empty">No matching icons</div>}
          {names.map((name) => (
            <button
              type="button"
              key={name}
              title={name}
              aria-label={name}
              onClick={() => onPick(name)}
              className={`pv-iconpicker-item${name === icon ? " is-current" : ""}`}
            >
              <LucideIcon name={name} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
