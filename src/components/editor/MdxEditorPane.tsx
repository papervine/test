"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eye, Code2, Diff, Copy } from "lucide-react";
import { toast } from "sonner";
import { VisualEditor } from "./VisualEditor";
import { SourceEditor } from "./SourceEditor";
import { DiffView } from "./visual/DiffView";
import { useCollabDoc } from "./collab/useCollabDoc";
import { PresenceDots } from "./collab/PresenceDots";
import { readBasePageAction } from "@/lib/actions/authoring";

export type Mode = "visual" | "source";

/**
 * The editor pane (SPEC §9.2): two *editable* views over ONE MDX draft — Visual (WYSIWYG,
 * rendered, the default) and Source (raw MDX) — plus a full-pane Diff overlay (working draft
 * vs the published version) and Copy-markdown, mirroring hosted docs platforms' editor toolbar.
 *
 * Visual renders the MDX through @papervine/mdx-prosemirror; components it can't model are
 * preserved verbatim. All views read/write the same `value`; edits debounce-save via `onSave`.
 */
export type MdxEditorHandle = { flush: () => Promise<void> };

type MdxEditorPaneProps = {
  initialMarkdown: string;
  path: string;
  org: string;
  site: string;
  branch: string;
  slug: string;
  onSave: (markdown: string) => void | Promise<void>;
  // Visual ⇄ Source is owned by the parent (EditorShell) so it persists across page switches
  // (this pane is `key`ed by page and would otherwise reset each nav click).
  mode: Mode;
  onModeChange: (mode: Mode) => void;
};

export const MdxEditorPane = forwardRef<MdxEditorHandle, MdxEditorPaneProps>(function MdxEditorPane(
  { initialMarkdown, path, org, site, branch, slug, onSave, mode, onModeChange },
  ref,
) {
  const [value, setValue] = useState(initialMarkdown);
  const [savedAt, setSavedAt] = useState<"idle" | "saving" | "saved">("idle");
  // Full-pane diff overlay (⌘⇧D) — an overlay on top of the current mode, not a mode itself.
  const [diffing, setDiffing] = useState(false);
  const [baseContent, setBaseContent] = useState<string | null>(null);
  const [modKey, setModKey] = useState("⌘");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedValue = useRef(initialMarkdown);

  // Collaboration: the canonical value is a shared Y.Text("mdx") per page-room; `value` mirrors
  // it for rendering, save, diff and copy. Local edits splice into the Y.Text (broadcast to peers);
  // remote edits flow back through onRemoteChange. Text-canonical, so git stays byte-exact.
  const { binding, peers, ready, ytext, awareness } = useCollabDoc({ org, site, branch, path, initialMarkdown });

  // Debounced draft save, shared by local and remote edits (both mutate the draft).
  const scheduleSave = (md: string) => {
    if (md === savedValue.current) return;
    setSavedAt("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onSave(md);
      savedValue.current = md;
      setSavedAt("saved");
    }, 700);
  };

  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (value !== savedValue.current) {
      setSavedAt("saving");
      await onSave(value);
      savedValue.current = value;
      setSavedAt("saved");
    }
  };
  useImperativeHandle(ref, () => ({ flush }));

  // A local edit from either pane: splice into the shared doc, mirror locally, schedule a save.
  const change = (md: string) => {
    binding.setText(md);
    setValue(md);
    scheduleSave(md);
  };

  // Adopt the settled room content once (first tab seeds it; a later tab adopts a peer's state,
  // which may be ahead of the server-provided initialMarkdown).
  useEffect(() => {
    if (ready) setValue(binding.getText());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, path]);

  // A remote edit (another tab / the other pane): mirror it and persist, but don't echo it back
  // into the shared doc — it's already there.
  useEffect(() => {
    return binding.onRemoteChange((text) => {
      setValue(text);
      scheduleSave(text);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Fetch the published (base) content when the diff opens.
  const openDiff = async () => {
    setDiffing(true);
    const res = await readBasePageAction(org, site, slug);
    setBaseContent("error" in res ? "" : res.markdown);
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Markdown copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  // Shortcuts: ⌘⇧M toggles Visual/Source, ⌘⇧D toggles the diff. Set the glyph per OS.
  useEffect(() => {
    setModKey(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl");
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.code === "KeyM") {
        e.preventDefault();
        onModeChange(mode === "visual" ? "source" : "visual");
      } else if (e.code === "KeyD") {
        e.preventDefault();
        if (diffing) setDiffing(false);
        else void openDiff();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, diffing]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        <span className="truncate text-xs text-neutral-500">{path}</span>
        <div className="flex items-center gap-2">
          <PresenceDots peers={peers} />
          <span className="text-[11px] text-neutral-400">
            {savedAt === "saving" ? "Saving…" : savedAt === "saved" ? "Draft saved" : ""}
          </span>
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon={Eye}
              label="Visual mode"
              shortcut={`${modKey}⇧M`}
              active={mode === "visual" && !diffing}
              onClick={() => onModeChange("visual")}
            />
            <ToolbarButton
              icon={Code2}
              label="Source mode"
              shortcut={`${modKey}⇧M`}
              active={mode === "source" && !diffing}
              onClick={() => onModeChange("source")}
            />
            <span className="mx-1 h-5 w-px bg-neutral-300 dark:bg-neutral-700" />
            <ToolbarButton
              icon={Diff}
              label={diffing ? "Exit diff" : "Diff"}
              shortcut={`${modKey}⇧D`}
              active={diffing}
              onClick={() => (diffing ? setDiffing(false) : void openDiff())}
            />
            <ToolbarButton icon={Copy} label="Copy markdown" onClick={copyMarkdown} />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {diffing ? (
          <DiffView base={baseContent ?? ""} draft={value} />
        ) : mode === "source" ? (
          // Collaborative CodeMirror once the shared doc has settled; a plain textarea covers the
          // brief pre-connect window (and the collab-disabled path where ytext/awareness are null).
          ready && ytext && awareness ? (
            <SourceEditor ytext={ytext} awareness={awareness} />
          ) : (
            <textarea
              value={value}
              onChange={(e) => change(e.target.value)}
              spellCheck={false}
              className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-neutral-800 outline-none dark:text-neutral-200"
            />
          )
        ) : (
          <VisualEditor
            value={value}
            onChange={change}
            assetBase={`/api/tenant-asset/${site}`}
            awareness={awareness}
          />
        )}
      </div>
    </div>
  );
});

function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <span className="pv-toolbtn-wrap">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={`pv-toolbtn${active ? " is-active" : ""}`}
      >
        <Icon className="h-4 w-4" />
      </button>
      <span className="pv-tip" role="tooltip">
        {label}
        {shortcut && <kbd className="pv-tip-kbd">{shortcut}</kbd>}
      </span>
    </span>
  );
}
