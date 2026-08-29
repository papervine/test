"use client";

import { useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChevronRight, File as FileIcon, Folder, Plus, Settings2, Trash2 } from "lucide-react";

// <Tree> in the Visual editor: a file tree you build by adding rows, not by writing JSX.
//
// The reader's component can't be the editing surface here, unlike a card or an accordion. Its
// rows are member-expression tags whose whole content is a `name` ATTR — there is no content hole
// to type into — and its folders collapse with native <details>, which would hide the rows you're
// arranging. So the rows are drawn here, from the same parts: the same icons, the same indent,
// the same hairline rail down a folder's children.
//
// What each row IS stays the document's business: a folder is a container node holding its
// children, a file is an atom. Adding, naming and removing rows are ordinary edits that
// round-trip to `<Tree.Folder>` / `<Tree.File>`.

/** The tag a new row is written with, matched to the tree it's going into (`Tree` / `FileTree`). */
function rowTag(treeName: string | null, kind: "Folder" | "File"): string {
  return `${treeName === "FileTree" ? "FileTree" : "Tree"}.${kind}`;
}

export function TreeNodeView({ node, editor, getPos }: NodeViewProps) {
  const [adding, setAdding] = useState(false);
  const treeName = (node.attrs.mdxName as string | null) ?? "Tree";

  const addRow = (kind: "Folder" | "File") => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    const type = editor.schema.nodes[kind === "Folder" ? "treeFolder" : "treeFile"];
    if (!type) return;
    const attrs = {
      mdxName: rowTag(treeName, kind),
      name: kind === "Folder" ? "untitled folder" : "untitled file",
    };
    // A folder is a container: it needs somewhere for its children to go, and an empty `block+`
    // node is an invalid one (the same trap the other components hit — see the converter).
    const content = kind === "Folder" ? [editor.schema.nodes.paragraph.create()] : undefined;
    const at = base + node.nodeSize - 1;
    editor.view.dispatch(editor.state.tr.insert(at, type.create(attrs, content)));
    setAdding(false);
    focusRowName(at);
  };

  /** Put the caret in the new row's name, selected — you named it by adding it. */
  const focusRowName = (pos: number) => {
    requestAnimationFrame(() => {
      const dom = editor.view.nodeDOM(pos);
      const field = dom instanceof HTMLElement ? dom.querySelector("input") : null;
      field?.focus();
      field?.select();
    });
  };

  return (
    <NodeViewWrapper className="pv-tree">
      <NodeViewContent className="pv-tree-rows" />
      <div contentEditable={false} className="pv-tree-add-wrap">
        <button type="button" className="pv-tree-add" onClick={() => setAdding((a) => !a)}>
          <Plus className="h-3.5 w-3.5" />
          Add file or folder
        </button>
        {adding && (
          <>
            <span className="fixed inset-0 z-40" onClick={() => setAdding(false)} />
            <span className="pv-tree-menu db-portal">
              <button type="button" onClick={() => addRow("Folder")}>
                <Folder className="h-4 w-4 opacity-70" />
                Folder
              </button>
              <button type="button" onClick={() => addRow("File")}>
                <FileIcon className="h-4 w-4 opacity-70" />
                File
              </button>
            </span>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

/** A folder row: its name, its controls, and the rail down its children. */
export function TreeFolderNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const name = (node.attrs.name as string | null) ?? "";
  const defaultOpen = node.attrs.defaultOpen === true;
  const openable = node.attrs.openable !== false;
  const highlight = node.attrs.highlight === true;
  const wrapper = useRef<HTMLDivElement>(null);

  const addRow = (kind: "Folder" | "File") => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    const type = editor.schema.nodes[kind === "Folder" ? "treeFolder" : "treeFile"];
    if (!type) return;
    const treeName = ((node.attrs.mdxName as string) ?? "Tree.Folder").split(".")[0];
    const attrs = {
      mdxName: `${treeName}.${kind}`,
      name: kind === "Folder" ? "untitled folder" : "untitled file",
    };
    const content = kind === "Folder" ? [editor.schema.nodes.paragraph.create()] : undefined;
    editor.view.dispatch(
      editor.state.tr.insert(base + node.nodeSize - 1, type.create(attrs, content)),
    );
    setAdding(false);
  };

  const remove = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(base, base + node.nodeSize));
  };

  return (
    <NodeViewWrapper className="pv-tree-folder" ref={wrapper}>
      <div contentEditable={false} className={`pv-tree-row${highlight ? " is-highlight" : ""}`}>
        {/* Static, not a working disclosure: collapsing a folder in the editor would hide the
            rows you're arranging, and `defaultOpen` is what READERS start with — a setting, not
            a view of the page. */}
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${openable ? "" : "invisible"}`} />
        <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
        <input
          value={name}
          placeholder="untitled folder"
          aria-label="Folder name"
          onChange={(e) => updateAttributes({ name: e.target.value || null })}
          className="pv-tree-name"
        />
        <span className="pv-tree-row-actions">
          <button type="button" onClick={() => setAdding((a) => !a)} aria-label="Add to folder">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setSettings((s) => !s)} aria-label="Folder options">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={remove} aria-label={`Remove ${name || "folder"}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
        {adding && (
          <>
            <span className="fixed inset-0 z-40" onClick={() => setAdding(false)} />
            <span className="pv-tree-menu db-portal">
              <button type="button" onClick={() => addRow("Folder")}>
                <Folder className="h-4 w-4 opacity-70" />
                Folder
              </button>
              <button type="button" onClick={() => addRow("File")}>
                <FileIcon className="h-4 w-4 opacity-70" />
                File
              </button>
            </span>
          </>
        )}
        {settings && (
          <>
            <span className="fixed inset-0 z-40" onClick={() => setSettings(false)} />
            <span className="pv-tree-menu db-portal">
              {/* The three things a folder can be, as the reader sees it — each one an attr. */}
              <label>
                <input
                  type="checkbox"
                  checked={defaultOpen}
                  onChange={(e) => updateAttributes({ defaultOpen: e.target.checked || null })}
                />
                Open by default
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={openable}
                  onChange={(e) => updateAttributes({ openable: e.target.checked ? null : false })}
                />
                Readers can collapse it
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={highlight}
                  onChange={(e) => updateAttributes({ highlight: e.target.checked || null })}
                />
                Highlight
              </label>
            </span>
          </>
        )}
      </div>
      {/* The children, behind the same rail the published tree draws. */}
      <NodeViewContent className="pv-tree-children" />
    </NodeViewWrapper>
  );
}

/** A file row: a name and nothing else, which is exactly what `<Tree.File>` renders. */
export function TreeFileNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const name = (node.attrs.name as string | null) ?? "";
  const highlight = node.attrs.highlight === true;

  const remove = () => {
    const base = typeof getPos === "function" ? getPos() : undefined;
    if (base === undefined) return;
    editor.view.dispatch(editor.state.tr.delete(base, base + node.nodeSize));
  };

  return (
    <NodeViewWrapper className="pv-tree-file">
      <div contentEditable={false} className={`pv-tree-row${highlight ? " is-highlight" : ""}`}>
        {/* Spacer, aligning files with the chevron on the folder rows above them. */}
        <span className="h-3.5 w-3.5 shrink-0" />
        <FileIcon className="h-4 w-4 shrink-0 text-zinc-400" />
        <input
          value={name}
          placeholder="untitled file"
          aria-label="File name"
          onChange={(e) => updateAttributes({ name: e.target.value || null })}
          className="pv-tree-name"
        />
        <span className="pv-tree-row-actions">
          <button
            type="button"
            onClick={() => updateAttributes({ highlight: highlight ? null : true })}
            aria-label={highlight ? "Remove highlight" : "Highlight"}
            className={highlight ? "is-on" : ""}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={remove} aria-label={`Remove ${name || "file"}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </NodeViewWrapper>
  );
}
