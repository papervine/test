"use client";

import { useState } from "react";
import { ChevronRight, FileText, Settings } from "lucide-react";
import type { NavSection, NavLeaf, NavNode } from "@papervine/renderer/lib/nav";

// The editor's navigation panel (col 2) — the docs.json nav, draft-aware (built from the draft
// overlay server-side). Click a page to load it; hover reveals a cog: pages open Page settings
// (frontmatter), groups open Group settings (docs.json). Nav structure editing beyond that is a
// follow-up.

const hrefToSlug = (href: string) => href.replace(/^\//, "");

interface Handlers {
  activeSlug: string;
  onSelect: (slug: string) => void;
  onPageSettings: (slug: string) => void;
  onGroupSettings: (group: string) => void;
}

function Leaf({ leaf, h }: { leaf: NavLeaf; h: Handlers }) {
  const slug = hrefToSlug(leaf.href);
  const active = slug === h.activeSlug;
  return (
    <div
      title={leaf.hidden ? "Hidden — not shown on the published site" : undefined}
      className={`group flex items-center rounded-md pr-1 ${leaf.hidden ? "opacity-40" : ""} ${
        active ? "bg-neutral-200 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
      }`}
    >
      <button
        type="button"
        onClick={() => h.onSelect(slug)}
        className={`flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm ${
          active ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"
        }`}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="truncate">{leaf.title}</span>
      </button>
      <button
        type="button"
        aria-label="Page settings"
        onClick={() => h.onPageSettings(slug)}
        className="pv-nav-cog shrink-0 rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-700"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Node({ node, h }: { node: NavNode; h: Handlers }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={node.hidden ? "opacity-40" : ""}>
      <div
        className="group flex items-center pr-1"
        title={node.hidden ? "Hidden — not shown on the published site" : undefined}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"
        >
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="truncate">{node.group}</span>
        </button>
        <button
          type="button"
          aria-label="Group settings"
          onClick={() => h.onGroupSettings(node.group)}
          className="pv-nav-cog shrink-0 rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-700"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="ml-2 border-l border-neutral-200 pl-2 dark:border-neutral-800">
          <NodeList nodes={node.items} h={h} />
        </div>
      )}
    </div>
  );
}

function NodeList({ nodes, h }: { nodes: (NavLeaf | NavNode)[]; h: Handlers }) {
  return (
    <div className="space-y-0.5">
      {nodes.map((n, i) => ("href" in n ? <Leaf key={i} leaf={n} h={h} /> : <Node key={i} node={n} h={h} />))}
    </div>
  );
}

export function NavTree({
  sections,
  activeSlug,
  onSelect,
  onPageSettings,
  onGroupSettings,
}: {
  sections: NavSection[];
  activeSlug: string;
  onSelect: (slug: string) => void;
  onPageSettings: (slug: string) => void;
  onGroupSettings: (group: string) => void;
}) {
  const h: Handlers = { activeSlug, onSelect, onPageSettings, onGroupSettings };
  return (
    <nav className="space-y-3 p-2">
      {sections.map((s, i) => (
        <div key={i}>
          {s.tab && <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{s.tab}</div>}
          <NodeList nodes={s.nodes} h={h} />
        </div>
      ))}
    </nav>
  );
}
