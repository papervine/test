"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, GripVertical, Plus } from "lucide-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";
import type { Awareness } from "y-protocols/awareness";
import { toast } from "sonner";
import { mdxToProseMirror, proseMirrorToMdx, splitFrontmatter } from "@papervine/mdx-prosemirror";
import { resolveEditorLink } from "@/lib/editor-link";
import { buildMdxExtensions } from "./visual/nodes";
import { makeNodeViewOpts } from "./visual/NodeViews";
import { CollabCarets, collabCaretsKey } from "./visual/CollabCarets";
import { SlashCommand, type SlashState } from "./visual/SlashCommand";
import { SlashMenu, type SlashMenuHandle } from "./visual/SlashMenu";
import { MediaDialog } from "./visual/MediaDialog";
import type { RequestInput } from "./visual/menu-items";
import type { MediaInputKind } from "@/lib/media-embed";
import { BlockPicker } from "./visual/BlockPicker";
import { BlockMenu } from "./visual/BlockMenu";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";

/** Pull a scalar field out of a YAML frontmatter block. */
function frontmatterField(fm: string, key: string): string {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(fm);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/**
 * Set (or insert) a scalar field in a YAML frontmatter block, preserving all other fields.
 * Creates the block if there is none. JSON.stringify gives a safely double-quoted YAML scalar.
 */
function setFrontmatterField(fm: string, key: string, value: string): string {
  const line = `${key}: ${JSON.stringify(value)}`;
  if (!fm.trim()) return value ? `---\n${line}\n---\n\n` : "";
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(fm)) return fm.replace(re, line);
  return fm.replace(/^---\r?\n/, (open) => `${open}${line}\n`);
}

/**
 * The WYSIWYG surface. Edits the MDX *body* rendered as ProseMirror; the page's frontmatter is
 * held aside and re-prepended on every change. Value in = full MDX file, value out = full MDX
 * file, so it's a drop-in peer of the Source textarea over the same draft string.
 *
 * Notion-style UX on top of the schema: a `/` command palette (SlashCommand), a selection
 * bubble toolbar (BubbleMenu), block drag handles (DragHandle), and empty-line placeholders.
 * Phase 2 is single-user (no Yjs yet); the shared document arrives in Phase 3.
 */
export function VisualEditor({
  value,
  onChange,
  assetBase,
  awareness,
  org,
  site,
  branch,
  slug,
  slugs,
  onNavigate,
}: {
  value: string;
  onChange: (markdown: string) => void;
  assetBase: string;
  // Remote-collaborator carets are rendered from this awareness. Null when collaboration is off or
  // the shared doc hasn't connected yet; the editor rebuilds (see the useEditor deps) once it arrives.
  awareness?: Awareness | null;
  // Addresses for the media dialog's server actions (list / upload into this site's storage).
  org: string;
  site: string;
  branch: string;
  // The page being edited + every page in the site — what a clicked link is resolved against.
  slug: string;
  slugs: string[];
  // Follow an in-site link by loading that page in the editor (same path as a nav click).
  onNavigate: (slug: string) => void;
}) {
  const frontmatter = useRef(splitFrontmatter(value).frontmatter);
  const lastEmitted = useRef<string | null>(null);
  // Awareness (remote carets) is read through a stable getter so the editor is built once and never
  // rebuilt when collaboration connects — the ref always holds the latest value.
  const awarenessRef = useRef<Awareness | null>(awareness ?? null);
  awarenessRef.current = awareness ?? null;
  // The block the drag handle last hovered — the target for the "+" insert button. We keep the
  // last non-null block: moving the mouse onto the handle itself fires onNodeChange(null), and
  // clearing then would leave nothing to insert after when "+" is clicked.
  const hovered = useRef<{ pos: number; node: PMNode } | null>(null);

  // Frontmatter title/description are edited as first-class fields (blinking cursor), kept in
  // the YAML — not the body — so they round-trip like the reader-facing article header.
  const [title, setTitle] = useState(() => frontmatterField(frontmatter.current, "title"));
  const [description, setDescription] = useState(() => frontmatterField(frontmatter.current, "description"));
  // The "+" block picker: where to anchor + where to insert (or a range to replace via "Turn into").
  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    insertPos: number;
    replaceRange?: { from: number; to: number };
  } | null>(null);
  // The drag-handle click menu (Turn into / Duplicate / Delete).
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; pos: number; node: PMNode } | null>(null);
  // The `/` command palette — controlled by suggestion state reported from SlashCommand.
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashKeyRef = useRef<((p: SuggestionKeyDownProps) => boolean) | null>(null);
  // The media dialog (`/image`, `/video`, `/embed`), hosted here because both the slash menu and
  // the "+" picker open it and neither should own a modal.
  const [mediaInput, setMediaInput] = useState<{
    kind: MediaInputKind;
    onSubmit: (value: string) => void;
  } | null>(null);
  const requestInput = useCallback<RequestInput>(
    (kind, onSubmit) => setMediaInput({ kind, onSubmit }),
    [],
  );
  // Stable identity, so React doesn't detach and re-attach the handle on every single render of a
  // menu that re-renders on each keystroke.
  const registerSlashMenu = useCallback((h: SlashMenuHandle | null) => {
    slashKeyRef.current = h ? (p) => h.onKeyDown({ event: p.event }) : null;
  }, []);
  /**
   * MUST be `useCallback`-stable: it is a dependency of DragHandle's effect, and that effect
   * `unregisterPlugin`s + `registerPlugin`s every time it re-runs. Reconfiguring the plugin set
   * makes ProseMirror destroy and rebuild EVERY plugin view — and the `/` palette reports through
   * one. Its `destroy()` fires the suggestion's `onExit` and aborts the in-flight item lookup, so
   * the resolved list never arrives and the menu is stuck on the empty state it opened with
   * ("No matching blocks"). An inline arrow read as a *new* dependency on every render, so every
   * keystroke tore the plugins down; typing inside a React node view (a `<Tab>` pane, a callout)
   * puts that teardown inside the window between the menu opening and its list resolving, which
   * is why the palette worked in a plain paragraph and died inside a component.
   */
  const onDragHandleNode = useCallback((data: { node: PMNode | null; pos: number }) => {
    // Keep the last real block; don't clear when the pointer moves onto the handle.
    if (data.node) hovered.current = { pos: data.pos, node: data.node };
  }, []);

  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR to avoid a hydration mismatch
    extensions: [
      ...buildMdxExtensions(makeNodeViewOpts(assetBase)),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? "Heading" : "Type '/' for commands…",
      }),
      SlashCommand.configure({
        onOpen: (s) => setSlash(s),
        onClose: () => setSlash(null),
        // Read the ref through a function rather than handing the ref itself over: configure()
        // deep-merges options and would clone a `{ current }` box, leaving the extension reading
        // an object React never writes to. See SlashOptions.onKeyDown.
        onKeyDown: (p) => slashKeyRef.current?.(p) ?? false,
        requestInput,
      }),
      CollabCarets.configure({ getAwareness: () => awarenessRef.current }),
    ],
    content: mdxToProseMirror(splitFrontmatter(value).body),
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      const full = frontmatter.current + proseMirrorToMdx(editor.getJSON() as never);
      lastEmitted.current = full;
      onChange(full);
    },
  });

  // Re-seed from an external value change (page switch / source edit) — but not our own emits.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    const { frontmatter: fm, body } = splitFrontmatter(value);
    frontmatter.current = fm;
    setTitle(frontmatterField(fm, "title"));
    setDescription(frontmatterField(fm, "description"));
    // Defer setContent out of React's commit phase: it dispatches a transaction that synchronously
    // renders our React node views (flushSync), which React forbids while it is already rendering.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return;
      editor.commands.setContent(mdxToProseMirror(body), { emitUpdate: false });
    });
    return () => {
      cancelled = true;
    };
  }, [value, editor]);

  // Carets: awareness arrives after the editor is built (async token mint). Nudge the plugin ONCE
  // to bind + paint once it's available — no editor rebuild, so the doc/cursor/undo are untouched.
  // The ref guard is load-bearing: `useEditor` returns a fresh `editor` identity on every render it
  // triggers, so a bare dep on `editor` would re-dispatch → re-render → re-dispatch forever. We only
  // ever need one nudge; the plugin then tracks awareness on its own via its "change" subscription.
  const caretsNudged = useRef(false);
  useEffect(() => {
    if (caretsNudged.current || !editor || !awareness) return;
    caretsNudged.current = true;
    editor.view.dispatch(editor.state.tr.setMeta(collabCaretsKey, true));
  }, [editor, awareness]);

  // Emit the full file (frontmatter + serialized body) after any edit — body or frontmatter.
  const emit = () => {
    const body = editor ? proseMirrorToMdx(editor.getJSON() as never) : "";
    const full = frontmatter.current + body;
    lastEmitted.current = full;
    onChange(full);
  };

  const onTitle = (v: string) => {
    setTitle(v);
    frontmatter.current = setFrontmatterField(frontmatter.current, "title", v);
    emit();
  };
  const onDescription = (v: string) => {
    setDescription(v);
    frontmatter.current = setFrontmatterField(frontmatter.current, "description", v);
    emit();
  };

  // "+" → open the block picker anchored at the button, inserting after the hovered block.
  const addBlock = (e: React.MouseEvent) => {
    if (!editor || !hovered.current) return;
    const insertPos = hovered.current.pos + hovered.current.node.nodeSize;
    setPicker({ x: e.clientX + 8, y: e.clientY, insertPos });
  };

  // ⠿ click → open the block menu (Turn into / Duplicate / Delete) for the hovered block.
  const openBlockMenu = (e: React.MouseEvent) => {
    if (!editor || !hovered.current) return;
    setBlockMenu({ x: e.clientX + 8, y: e.clientY, pos: hovered.current.pos, node: hovered.current.node });
  };

  /**
   * Follow a link the way the *editor* should, never the way the browser would.
   *
   * The editor renders the real MDX components, so a `<Card href="/quickstart">` is a live
   * `next/link` and a markdown link is a live `<a>` — both pointing at a docs path that only
   * exists on the tenant's docs host. Left alone, next/link *soft*-navigates the app host to
   * `/quickstart` (a 404), which is worse than a plain anchor: contenteditable normally
   * suppresses link following, so the router is what actually loses you the editor.
   *
   * So: intercept in the capture phase (before the component's own `<Link>` sees the click) and
   * always `preventDefault()` — next/link bails on a default-prevented click, and the browser
   * won't follow a plain anchor either. Then route it: an in-site page loads in this editor, an
   * external URL opens in a new tab, a dead path says so.
   */
  const followLink = (e: React.MouseEvent, { editable }: { editable: boolean }) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest?.("a[href]");
    if (!anchor) return;
    e.preventDefault();

    // A component node view can wrap editable content in its link — a Card's body text lives
    // inside its <a> — and that text still has to be reachable with the mouse. So a click that
    // lands *in* the content hole places the caret instead of following the link; the rest of
    // the card (padding, title, icon) navigates. ⌘/Ctrl overrides, for the caret's own line.
    const hole = target?.closest?.("[data-node-view-content]");
    if (editable && !e.metaKey && !e.ctrlKey && hole && anchor.contains(hole)) return;
    // Don't hijack the click that ends a drag-selection over a link — the user is selecting text.
    if (!window.getSelection()?.isCollapsed) return;
    e.stopPropagation();

    const dest = resolveEditorLink(anchor.getAttribute("href") ?? "", slug, slugs);
    if (dest.kind === "page") onNavigate(dest.slug);
    else if (dest.kind === "external") window.open(dest.href, "_blank", "noopener,noreferrer");
    else if (dest.kind === "missing") toast.error(`No page ${dest.path} in this site`);
    // "anchor" — a bare #hash on the page you're already editing; nothing to navigate to.
  };

  // "Turn into" → replace the block with a picked type.
  const turnInto = () => {
    if (!blockMenu) return;
    const { x, y, pos, node } = blockMenu;
    setBlockMenu(null);
    setPicker({ x, y, insertPos: pos, replaceRange: { from: pos, to: pos + node.nodeSize } });
  };

  // Extra left padding = gutter for the drag handle + "+" that float left of each block.
  return (
    <div
      className="pv-visual h-full overflow-auto py-6 pl-16 pr-8"
      // Capture phase: this must beat the `<Link>` a component node view renders. Middle-click
      // (auxclick) would open the wrong host in a new tab, so it follows the same route — and
      // unlike a left click it's never an editing gesture, so it never places a caret.
      onClickCapture={(e) => followLink(e, { editable: true })}
      onAuxClickCapture={(e) => e.button === 1 && followLink(e, { editable: false })}
    >
      <header className="pv-doc-header">
        <input
          className="pv-doc-title-input"
          value={title}
          placeholder="Untitled"
          onChange={(e) => onTitle(e.target.value)}
        />
        <textarea
          className="pv-doc-desc-input"
          value={description}
          placeholder="Add a description…"
          rows={1}
          onChange={(e) => onDescription(e.target.value)}
        />
      </header>
      {editor && (
        <BubbleMenu
          editor={editor}
          className="pv-bubble"
          // Not over a table's cell selection. Selecting a column with its handle is a structural
          // act — you're about to delete or move it, not embolden it — and the toolbar pops up
          // across the rows you just selected, hiding the thing you were looking at.
          shouldShow={({ editor: ed, state }) =>
            ed.isEditable && !state.selection.empty && !(state.selection instanceof CellSelection)
          }
        >
          <BubbleButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton
            active={editor.isActive("link")}
            onClick={() => {
              const prev = editor.getAttributes("link").href as string | undefined;
              const href = window.prompt("Link URL", prev ?? "https://");
              if (href === null) return;
              if (href === "") editor.chain().focus().unsetLink().run();
              else editor.chain().focus().toggleLink({ href }).run();
            }}
          >
            <LinkIcon className="h-4 w-4" />
          </BubbleButton>
        </BubbleMenu>
      )}
      {editor && (
        <DragHandle editor={editor} onNodeChange={onDragHandleNode}>
          <div className="pv-block-controls">
            <button
              type="button"
              className="pv-block-add"
              title="Add block"
              // Stop the drag-handle from capturing the press so the click actually fires.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={addBlock}
            >
              <Plus className="h-4 w-4" />
            </button>
            {/* Click opens the block menu; press-and-drag still moves the block (DragHandle). */}
            <div className="pv-drag-handle" title="Click for options, drag to move" onClick={openBlockMenu}>
              <GripVertical className="h-4 w-4" />
            </div>
          </div>
        </DragHandle>
      )}
      <EditorContent editor={editor} />
      {picker && editor && (
        <BlockPicker
          editor={editor}
          x={picker.x}
          y={picker.y}
          insertPos={picker.insertPos}
          replaceRange={picker.replaceRange}
          requestInput={requestInput}
          onClose={() => setPicker(null)}
        />
      )}
      {mediaInput && (
        <MediaDialog
          kind={mediaInput.kind}
          org={org}
          site={site}
          branch={branch}
          onSubmit={(value) => {
            mediaInput.onSubmit(value);
            setMediaInput(null);
          }}
          onClose={() => setMediaInput(null)}
        />
      )}
      {slash && slash.rect && (
        <div
          className="pv-slash-portal"
          style={{ position: "fixed", left: slash.rect.left, top: slash.rect.bottom + 6, zIndex: 60 }}
        >
          <SlashMenu
            ref={registerSlashMenu}
            items={slash.items}
            command={(item) => slash.command(item)}
          />
        </div>
      )}
      {blockMenu && editor && (
        <BlockMenu
          editor={editor}
          x={blockMenu.x}
          y={blockMenu.y}
          pos={blockMenu.pos}
          node={blockMenu.node}
          onTurnInto={turnInto}
          onClose={() => setBlockMenu(null)}
        />
      )}
    </div>
  );
}

function BubbleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={`pv-bubble-btn${active ? " is-active" : ""}`}>
      {children}
    </button>
  );
}
