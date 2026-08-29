"use client";

import { useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Link2, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Card } from "@papervine/renderer/components/mdx/Card";
import { LucideIcon } from "@papervine/renderer/components/LucideIcon";
import { IconPicker } from "./IconPicker";

// <Card> in the Visual editor: the published card, with its three authored parts handed back as
// controls — the icon is a button that opens the icon set, the title is a field, and the body is
// the content hole it always was.
//
// Everything else about it is the reader's card. That includes staying a real link when it has an
// `href`, which is why clicking one in the editor opens that page in the editor (see followLink in
// VisualEditor) — the guard there also has to let a click on this chrome through to the field
// rather than treating it as following the link.

export function CardNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const icon = (node.attrs.icon as string | null) ?? null;
  const title = (node.attrs.title as string | null) ?? "";
  const href = (node.attrs.href as string | null) ?? null;
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState(false);
  const iconButton = useRef<HTMLButtonElement>(null);

  // Committed per keystroke, like a step's title: an attrs-only change updates the existing node
  // view instead of recreating it, so the field keeps its DOM node and its caret — and the title
  // is in the autosaved draft even if the page is switched mid-word. Empty commits back to null
  // so it serializes as `<Card>`, never `title=""`.
  const commit = (attrs: Record<string, unknown>) => updateAttributes(attrs);
  const commitText = (key: string, value: string) =>
    commit({ [key]: value.trim() === "" ? null : value });

  // Enter in the title drops into the body — a card is a name then a description.
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

  const removeCard = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(base, base + node.nodeSize));
  };

  const empty = node.textContent.trim() === "";

  return (
    <NodeViewWrapper className="pv-card-node relative">
      {/* The card's own controls, over the card rather than inside it: an editor-only affordance
          shouldn't become a prop on the component readers get. */}
      <span contentEditable={false} className="pv-card-actions">
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          aria-label="Card options"
          title="Card options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menu && (
          <>
            <span className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
            <span className="pv-card-menu db-portal">
              <label className="pv-card-menu-field">
                <Link2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <input
                  defaultValue={href ?? ""}
                  placeholder="/page or https://…"
                  aria-label="Card link"
                  onBlur={(e) => commitText("href", e.target.value)}
                  onKeyDown={(e) => {
                    // Enter commits and closes: the field is the whole menu, so leaving it open
                    // afterwards just puts a panel over the card you were looking at.
                    if (e.key === "Enter") {
                      commitText("href", (e.target as HTMLInputElement).value);
                      setMenu(false);
                    }
                    if (e.key === "Escape") setMenu(false);
                  }}
                />
              </label>
              <button type="button" onClick={removeCard} className="pv-card-menu-item">
                <Trash2 className="h-3.5 w-3.5" />
                Remove card
              </button>
            </span>
          </>
        )}
      </span>

      <Card
        href={href ?? undefined}
        icon={
          <span contentEditable={false}>
            <button
              ref={iconButton}
              type="button"
              onClick={() => setPicking(true)}
              aria-label={icon ? `Icon: ${icon}` : "Add an icon"}
              title={icon ? `Icon: ${icon}` : "Add an icon"}
              className="pv-card-icon"
            >
              {icon ? (
                <LucideIcon name={icon} className="h-5 w-5 text-primary" />
              ) : (
                <Sparkles className="h-5 w-5 opacity-50" />
              )}
            </button>
          </span>
        }
        title={
          // Always rendered, so an untitled card still shows somewhere to put a name — the same
          // bargain a step's title slot makes.
          <span contentEditable={false} className="block">
            <input
              value={title}
              placeholder="Card title"
              aria-label="Card title"
              onChange={(e) => commitText("title", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  toBody();
                }
              }}
              className="w-full bg-transparent outline-none placeholder:font-normal placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </span>
        }
      >
        {/* Absolutely positioned, so an empty card says what goes here without moving the caret
            off the first character. */}
        {empty && (
          <span contentEditable={false} className="pv-card-placeholder">
            Enter your card description here
          </span>
        )}
        <NodeViewContent />
      </Card>

      {picking && (
        <IconPicker
          icon={icon}
          anchor={iconButton.current}
          onPick={(name) => {
            commit({ icon: name });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </NodeViewWrapper>
  );
}
