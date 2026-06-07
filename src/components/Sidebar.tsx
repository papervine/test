"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { NavLeaf, NavNode, NavSection } from "@/lib/nav";

function isLeaf(n: NavLeaf | NavNode): n is NavLeaf {
  return "href" in n;
}

function NodeList({ nodes, depth = 0 }: { nodes: (NavLeaf | NavNode)[]; depth?: number }) {
  const pathname = usePathname();
  return (
    <ul className={clsx("space-y-0.5", depth > 0 && "ml-3 mt-1 border-l border-zinc-200 pl-3 dark:border-zinc-800")}>
      {nodes.map((node, i) => {
        if (isLeaf(node)) {
          const active = pathname === node.href;
          return (
            <li key={i}>
              <Link
                href={node.href}
                className={clsx(
                  "block rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                )}
              >
                {node.title}
              </Link>
            </li>
          );
        }
        return (
          <li key={i} className="mt-4 first:mt-0">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {node.group}
            </p>
            <NodeList nodes={node.items} depth={depth + 1} />
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({ sections }: { sections: NavSection[] }) {
  return (
    <nav className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 px-4 py-8 dark:border-zinc-800">
      {sections.map((section, i) => (
        <div key={i} className="mb-6">
          {section.tab && (
            <p className="mb-2 px-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">{section.tab}</p>
          )}
          <NodeList nodes={section.nodes} />
        </div>
      ))}
    </nav>
  );
}
