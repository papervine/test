"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { canonicalLanguageId, filterLanguages, languageLabel } from "./code-meta";

/**
 * The language control on a <CodeGroup>'s strip: what the active fence is written in, and the
 * only way to change it without dropping into Source mode.
 *
 * Searchable rather than a plain <select> because the list is long enough that scanning it is
 * slower than typing two letters — and because a fence can carry a language we don't list, which
 * a select would silently rewrite on the next change. The current value is always shown as
 * written, listed or not.
 *
 * The menu is PORTALED to <body>, like the `/` palette: the group's `overflow-hidden` is what
 * rounds the code block's corners, and it clipped a menu rendered in place down to two rows. That
 * puts it outside the `.db` shell, so it carries `db-portal` to re-resolve the platform tokens.
 */
export function LanguagePicker({
  language,
  onPick,
}: {
  language: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items = filterLanguages(query);
  // ```ts and ```typescript are the same entry, so the tick has to compare canonically.
  const currentId = canonicalLanguageId(language);

  const WIDTH = 200;
  const MAX_HEIGHT = 320;

  // Positioned from the trigger's box, clamped to the viewport: fixed coordinates, measured
  // before paint so the menu never shows up in the wrong place first.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      top: Math.min(rect.bottom + 4, window.innerHeight - MAX_HEIGHT - 8),
      left: Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => setSelected(0), [query]);
  // Keep the highlighted row in view when arrowing past the fold (the `/` menu's lesson).
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".pv-lang-item.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (id: string) => {
    onPick(id);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s + items.length - 1) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selected];
      if (item) choose(item.id);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title="Language"
        aria-label="Language"
        className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        {languageLabel(language) || "Plain Text"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="pv-picker-overlay" onClick={close} />
            <div className="pv-lang-menu db-portal" style={{ top: at.top, left: at.left }}>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search languages"
                aria-label="Search languages"
                className="pv-lang-search"
              />
              <div ref={listRef} className="pv-lang-list">
                {items.length === 0 && <div className="pv-lang-empty">No matching languages</div>}
                {items.map((item, i) => (
                  <button
                    type="button"
                    key={item.id || "plain"}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => choose(item.id)}
                    className={`pv-lang-item${i === selected ? " is-active" : ""}${
                      item.id === currentId ? " is-current" : ""
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
