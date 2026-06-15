"use client";

import { useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import type { NavSection, NavLeaf, NavNode } from "@papervine/renderer/lib/nav";

// The editor's navigation panel (col 2) — the docs.json nav, draft-aware (built from the
// draft overlay server-side). Clicking a page loads it into the editor pane. Read-only for
// now; editing the nav structure (docs.json drafts) is a follow-up.

const hrefToSlug = (href: string) => href.replace(/^\//, "");

function Leaf({ leaf, activeSlug, onSelect }: { leaf: NavLeaf; activeSlug: string; onSelect: (s: string) => void }) {
  const slug = hrefToSlug(leaf.href);
  const active = slug === activeSlug;
  return (
    <button
      type="button"
      onClick={() => onSelect(slug)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
        active
          ? "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
      }`}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span className="truncate">{leaf.title}</span>
    </button>
  );
}

function Node({ node, activeSlug, onSelect }: { node: NavNode; activeSlug: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="truncate">{node.group}</span>
      </button>
      {open && (
        <div className="ml-2 border-l border-neutral-200 pl-2 dark:border-neutral-800">
          <NodeList nodes={node.items} activeSlug={activeSlug} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}

function NodeList({
  nodes,
  activeSlug,
  onSelect,
}: {
  nodes: (NavLeaf | NavNode)[];
  activeSlug: string;
  onSelect: (s: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((n, i) =>
        "href" in n ? (
          <Leaf key={i} leaf={n} activeSlug={activeSlug} onSelect={onSelect} />
        ) : (
          <Node key={i} node={n} activeSlug={activeSlug} onSelect={onSelect} />
        ),
      )}
    </div>
  );
}

export function NavTree({
  sections,
  activeSlug,
  onSelect,
}: {
  sections: NavSection[];
  activeSlug: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <nav className="space-y-3 p-2">
      {sections.map((s, i) => (
        <div key={i}>
          {s.tab && <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{s.tab}</div>}
          <NodeList nodes={s.nodes} activeSlug={activeSlug} onSelect={onSelect} />
        </div>
      ))}
    </nav>
  );
}
