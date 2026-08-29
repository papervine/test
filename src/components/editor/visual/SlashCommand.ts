import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { filterSlashItems, type RequestInput, type SlashItem } from "./menu-items";

// State the extension reports up to React so the palette can render as a CONTROLLED component.
export interface SlashState {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  rect: DOMRect | null;
}

export interface SlashOptions {
  onOpen: (state: SlashState) => void;
  onClose: () => void;
  /**
   * Arrow/Enter navigation inside the open menu. Returns true when the menu consumed the key, so
   * ProseMirror leaves the caret alone.
   *
   * This is a FUNCTION, and it has to be. It used to be a `{ current }` ref box that React wrote
   * the menu's handler into — which silently never worked: `Extension.configure()` merges options
   * with a deep merge that RECURSES whenever the default and the supplied value are both plain
   * objects. A ref box is a plain object, so it got cloned, and the extension spent its life
   * reading a different object than React was writing to. Arrows fell through to the document,
   * which moved the caret out of the `/query` and closed the menu; Enter fell through too, so
   * items could only be chosen with the mouse. A function value is copied by reference and cannot
   * be re-broken this way — the same reason CollabCarets takes `getAwareness()`.
   */
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  /** Opens the media dialog for items that need a URL first. A function, for the reason above. */
  requestInput: RequestInput;
  /**
   * Which items this editor offers. Defaults to all of them; the marketing home's demo passes
   * NO_MEDIA, since it mounts the editor with no site (and therefore no asset storage) behind it.
   * A function, for the same merge reason as onKeyDown above — a predicate can't be a plain object,
   * so this one is safe by construction, but keep it a function if it ever grows options.
   */
  allowItem: (item: SlashItem) => boolean;
}

// The Notion-style `/` command. We deliberately do NOT use @tiptap/react's ReactRenderer to
// mount the popup: it calls flushSync inside the editor's React update, which React 19 aborts,
// so the menu never appears. Instead the extension only *reports* suggestion state; VisualEditor
// renders the palette as a controlled React popover (the same pattern as the "+" BlockPicker).
export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onOpen: () => {},
      onClose: () => {},
      onKeyDown: () => false,
      requestInput: () => {},
      allowItem: () => true,
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    const toState = (props: SuggestionProps<SlashItem>): SlashState => ({
      items: props.items,
      command: (item) => props.command(item),
      rect: props.clientRect?.() ?? null,
    });
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        allowedPrefixes: null,
        startOfLine: false,
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          props.command({ editor, range, requestInput: opts.requestInput });
        },
        items: ({ query }) => filterSlashItems(query, opts.allowItem),
        render: () => ({
          // Defer the setState out of the editor's React render phase — opens AND closes, or they
          // land out of order: a deferred open applied after a synchronous close re-opens a menu
          // the editor has already dismissed, and leaves it showing whatever list that (possibly
          // still-loading, therefore empty) open carried.
          onStart: (props) => {
            const s = toState(props);
            queueMicrotask(() => opts.onOpen(s));
          },
          onUpdate: (props) => {
            const s = toState(props);
            queueMicrotask(() => opts.onOpen(s));
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              queueMicrotask(() => opts.onClose());
              return true;
            }
            return opts.onKeyDown(props);
          },
          onExit: () => queueMicrotask(() => opts.onClose()),
        }),
      }),
    ];
  },
});
