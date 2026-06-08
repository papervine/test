"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { LucideIcon } from "./LucideIcon";
import type { NavLeaf, NavNode, NavSection } from "@/lib/nav";

function isLeaf(n: NavLeaf | NavNode): n is NavLeaf {
  return "href" in n;
}

function containsHref(nodes: (NavLeaf | NavNode)[], pathname: string): boolean {
  return nodes.some((n) => (isLeaf(n) ? n.href === pathname : containsHref(n.items, pathname)));
}

function Leaf({ node }: { node: NavLeaf }) {
  const pathname = usePathname();
  const active = pathname === node.href;
  return (
    <Link
      href={node.href}
      className={clsx(
        "block rounded-lg px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-zinc-100 font-medium text-primary dark:bg-white/10"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
      )}
    >
      {node.title}
    </Link>
  );
}

/** Top-level group: a static icon + bold header (Introduction, Concepts, …). */
function TopGroup({ node }: { node: NavNode }) {
  return (
    <>
      <p className="mb-2 flex items-center gap-2 px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {node.icon && <LucideIcon name={node.icon} className="h-4 w-4 text-zinc-400" />}
        {node.group}
      </p>
      <NodeList nodes={node.items} depth={1} />
    </>
  );
}

/** Nested group: a collapsible row with a chevron (Projects, Preferences, …). */
function SubGroup({ node, depth }: { node: NavNode; depth: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => containsHref(node.items, pathname));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        <span>{node.group}</span>
        <ChevronRight className={clsx("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-90")} />
      </button>
      {open && <NodeList nodes={node.items} depth={depth + 1} />}
    </>
  );
}

function NodeList({ nodes, depth = 0 }: { nodes: (NavLeaf | NavNode)[]; depth?: number }) {
  return (
    <ul
      className={clsx(
        // Wide gaps between top-level groups; comfortable spacing within a group.
        depth === 0 ? "space-y-7" : "space-y-1",
        // The guide rail only appears for nested sub-groups, not the top-level
        // group's items (matches the incumbent).
        depth >= 2 && "ml-[15px] border-l border-zinc-200 pl-3 dark:border-zinc-800",
      )}
    >
      {nodes.map((node, i) => (
        <li key={i}>
          {isLeaf(node) ? (
            <Leaf node={node} />
          ) : depth === 0 ? (
            <TopGroup node={node} />
          ) : (
            <SubGroup node={node} depth={depth} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  // Show only the active tab's nav (the incumbent scopes the sidebar to one tab).
  // The active tab is the one containing the current page; fall back to the first.
  const active = sections.find((s) => s.hrefs.includes(pathname)) ?? sections[0];

  if (!active) return null;

  // `-ml-3` shifts the whole column left by the items' px-3 so their text/icons
  // line up with the logo and tab nav, while the active pill (which extends to
  // this edge) stays inside the box — overflow-y-auto would otherwise clip it.
  return (
    <nav className="sticky top-28 -ml-3 hidden h-[calc(100vh-7rem)] w-64 shrink-0 overflow-y-auto py-8 pr-4 md:block">
      <NodeList nodes={active.nodes} />
    </nav>
  );
}
