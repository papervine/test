"use client";

import { useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

// The "Files" view of the left panel — the raw repo file tree (folders + page files) built
// from every page slug, as an alternative to the docs.json "Navigation" view. Clicking a file
// loads it in the editor, keyed by slug (the same identity NavTree/loadPage use).

interface TreeNode {
  name: string;
  slug: string | null; // full slug for a file (index page = ""); null for a folder
  children: TreeNode[];
}

/** Build a nested folder tree from flat slugs like "internal/team/settings". The index page's
 *  slug is "" (empty) — shown as "index" at the root. */
function buildTree(slugs: string[]): TreeNode[] {
  const root: TreeNode = { name: "", slug: null, children: [] };
  for (const slug of [...slugs].sort()) {
    const parts = slug === "" ? ["index"] : slug.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && (isFile ? c.slug !== null : c.slug === null));
      if (!child) {
        child = { name: part, slug: isFile ? slug : null, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  // Folders first, then files; alphabetical within each.
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.slug === null ? -1 : 1) - (b.slug === null ? -1 : 1) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

function FileNode({
  node,
  depth,
  activeSlug,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activeSlug: string;
  onSelect: (slug: string) => void;
}) {
  const isFolder = node.slug === null;
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (isFolder) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
        >
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />}
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children.map((c) => (
          <FileNode key={c.name + c.slug} node={c} depth={depth + 1} activeSlug={activeSlug} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const active = node.slug === activeSlug;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.slug ?? "")}
      style={pad}
      className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm ${
        active
          ? "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
      }`}
    >
      <span className="w-3 shrink-0" />
      <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTree({
  slugs,
  activeSlug,
  onSelect,
}: {
  slugs: string[];
  activeSlug: string;
  onSelect: (slug: string) => void;
}) {
  const tree = buildTree(slugs);
  return (
    <div className="space-y-0.5 p-2">
      {tree.map((n) => (
        <FileNode key={n.name + n.slug} node={n} depth={0} activeSlug={activeSlug} onSelect={onSelect} />
      ))}
    </div>
  );
}
