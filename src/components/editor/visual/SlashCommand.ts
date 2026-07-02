import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { filterSlashItems, type SlashItem } from "./menu-items";

// State the extension reports up to React so the palette can render as a CONTROLLED component.
export interface SlashState {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  rect: DOMRect | null;
}

export interface SlashOptions {
  onOpen: (state: SlashState) => void;
  onClose: () => void;
  // React registers the open menu's key handler here so the suggestion can drive arrow/enter nav.
  keyHandlerRef: { current: ((props: SuggestionKeyDownProps) => boolean) | null };
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
      keyHandlerRef: { current: null },
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
          props.command({ editor, range });
        },
        items: ({ query }) => filterSlashItems(query),
        render: () => ({
          // Defer the setState out of the editor's React render phase.
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
              opts.onClose();
              return true;
            }
            return opts.keyHandlerRef.current?.(props) ?? false;
          },
          onExit: () => opts.onClose(),
        }),
      }),
    ];
  },
});
