import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Awareness } from "y-protocols/awareness";

// Remote collaborator carets for the Visual (ProseMirror) editor. The paved-path way
// (y-prosemirror's yCursorPlugin) needs ProseMirror to be the canonical CRDT bound to a
// Y.XmlFragment — which we deliberately don't do (raw MDX text is canonical, Visual is a
// projection). But because EVERY client projects the SAME body to the SAME deterministic PM doc,
// a ProseMirror position means the same place in every Visual editor — so we can broadcast the
// raw selection position through awareness and render it verbatim, no offset mapping required.
//
// Scope: Visual↔Visual. A Source-mode peer's cursor lives in Y.Text-offset space (y-codemirror),
// which doesn't map here without the source-offset bridge — that interop is a deferred follow-up.
// During simultaneous typing a remote caret can lag by the size of not-yet-synced edits; it
// self-corrects on the next projection (accepted — SPEC §9.2 calls Visual cursor accuracy cosmetic).

export const collabCaretsKey = new PluginKey("pv-collab-carets");

export interface CollabCaretsOptions {
  // A STABLE getter (not the awareness value) so the extension's config never changes identity and
  // the TipTap editor is built exactly once — never rebuilt when collaboration connects (a rebuild
  // would reset the doc, cursor and undo history). Awareness starts null and arrives asynchronously
  // (after the room token mints); the plugin binds to it lazily (see the view), and VisualEditor
  // nudges the editor once it appears so the binding + first paint happen without any edit.
  getAwareness: () => Awareness | null;
}

interface RemoteUser {
  name?: string;
  color?: string;
}
interface VisualCursor {
  anchor: number;
  head: number;
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/** A zero-width caret with the collaborator's name label, coloured to their presence colour. */
function caretElement(color: string, name: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "pv-remote-caret";
  span.style.borderColor = color;
  const label = document.createElement("span");
  label.className = "pv-remote-caret-label";
  label.style.backgroundColor = color;
  label.textContent = name;
  span.appendChild(label);
  return span;
}

function buildDecorations(awareness: Awareness | null, state: EditorState): DecorationSet {
  if (!awareness) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const size = state.doc.content.size;
  const clamp = (n: number) => Math.max(0, Math.min(n, size));
  awareness.getStates().forEach((s, clientId) => {
    if (clientId === awareness.clientID) return; // not our own
    const cur = (s as Record<string, unknown>).visualCursor as VisualCursor | null | undefined;
    if (!cur || typeof cur.head !== "number") return;
    const user = ((s as Record<string, unknown>).user as RemoteUser) ?? {};
    const color = user.color ?? "#8b5cf6";
    const name = user.name ?? "Editor";
    const head = clamp(cur.head);
    const anchor = clamp(typeof cur.anchor === "number" ? cur.anchor : cur.head);
    // Selection band (skip when it's just a caret).
    if (anchor !== head) {
      decos.push(
        Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
          class: "pv-remote-selection",
          style: `background-color:${rgba(color, 0.22)}`,
        }),
      );
    }
    // The caret itself — keyed by client so PM reuses the DOM (no flicker) as it moves.
    decos.push(
      Decoration.widget(head, () => caretElement(color, name), {
        side: 1,
        key: `pv-caret-${clientId}`,
        ignoreSelection: true,
      }),
    );
  });
  return DecorationSet.create(state.doc, decos);
}

export const CollabCarets = Extension.create<CollabCaretsOptions>({
  name: "collabCarets",

  addOptions() {
    return { getAwareness: () => null };
  },

  addProseMirrorPlugins() {
    const getAwareness = this.options.getAwareness;
    return [
      new Plugin({
        key: collabCaretsKey,
        state: {
          init: (_config, state) => buildDecorations(getAwareness(), state),
          apply(tr, old, _oldState, newState) {
            // Rebuild on our awareness-refresh signal or when the doc moved (positions shifted).
            if (tr.getMeta(collabCaretsKey) || tr.docChanged) return buildDecorations(getAwareness(), newState);
            return old;
          },
        },
        props: {
          decorations(state) {
            return collabCaretsKey.getState(state);
          },
        },
        view(view) {
          // Awareness starts null and arrives async; bind to it the moment it's available.
          let bound: Awareness | null = null;
          const onChange = () => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(collabCaretsKey, true));
          };
          const writeSelection = () => {
            if (!bound) return;
            const { from, to } = view.state.selection;
            bound.setLocalStateField("visualCursor", { anchor: from, head: to });
          };
          const ensureBound = () => {
            const aw = getAwareness();
            if (aw === bound) return;
            if (bound) bound.off("change", onChange);
            bound = aw;
            if (bound) {
              bound.on("change", onChange);
              writeSelection(); // publish our caret so peers see it immediately on connect
            }
          };
          ensureBound();
          return {
            update(v, prev) {
              ensureBound();
              if (bound && (v.state.selection !== prev.selection || v.state.doc !== prev.doc)) writeSelection();
            },
            destroy() {
              if (bound) {
                bound.off("change", onChange);
                bound.setLocalStateField("visualCursor", null);
              }
            },
          };
        },
      }),
    ];
  },
});
