"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

// A component's PROPERTIES, in a panel: the labelled, explained version of the attrs a node view
// also exposes inline. Opened from a `⋯` button in the block's top-right corner.
//
// Why both. The inline fields are the WYSIWYG half — a label you type where it will appear — but
// they can only carry as much explanation as a placeholder, and some props have nowhere sensible to
// live in the document at all. The panel is where a prop gets its name, a sentence about what it
// does, and a home even when it isn't visible in the entry.
//
// Portaled and measured like the icon, language and colour popovers: a node view is inside the
// editor's scroll container, and a panel rendered in place is clipped by the first ancestor with
// `overflow: hidden`.
//
// Generic on purpose — `<Update>` is the first user, and Badge/Icon/Card want exactly this shape.

export interface PropertyRow {
  /** The prop's name, as authors write it. */
  name: string;
  /** One sentence: what it does, and where it shows up. */
  help: string;
  /** Required props get the marker; a missing one is a broken component, not a default. */
  required?: boolean;
  /** The control. A row with none renders its help alone — for a prop this surface can't edit. */
  field?: ReactNode;
}

export function PropertiesButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      contentEditable={false}
      className="pv-props-button"
      aria-label={label}
      title={label}
      // The block's own drag handle is listening for a press in this corner too; stop it here so
      // the click opens the panel instead of starting a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}

export function PropertiesPanel({
  title,
  icon: Icon,
  anchor,
  rows,
  onClose,
}: {
  title: string;
  icon: LucideIcon;
  /** The button it opened from — the panel is placed against this. */
  anchor: HTMLElement | null;
  rows: PropertyRow[];
  onClose: () => void;
}) {
  const [at, setAt] = useState({ top: -9999, left: -9999 });
  const panel = useRef<HTMLDivElement>(null);

  // Measured after mount so the panel can be kept on screen: a block near the bottom of a long page
  // would otherwise open a panel that runs off it, and one near the right edge would clip.
  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    const height = panel.current?.offsetHeight ?? 360;
    const width = panel.current?.offsetWidth ?? 300;
    setAt({
      top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8)),
    });
  }, [anchor]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="pv-picker-overlay" onClick={onClose} />
      <div
        ref={panel}
        className="pv-props-panel db-portal"
        style={{ top: at.top, left: at.left }}
        // On the panel rather than each field: Escape has to close it from wherever focus is, and a
        // field that swallowed the key would leave the overlay over the page.
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="pv-props-head">
          <Icon className="h-4 w-4 opacity-70" />
          <span>{title}</span>
        </div>
        <div className="pv-props-rows">
          {rows.map((row) => (
            <div key={row.name} className="pv-props-row">
              <span className="pv-props-name">
                {row.name}
                {row.required && <span className="pv-props-required"> *</span>}
              </span>
              <p className="pv-props-help">{row.help}</p>
              {row.field}
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
