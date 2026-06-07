"use client";

import clsx from "clsx";
import type { TocItem } from "@/lib/mdx";

export function TableOfContents({ items }: { items: TocItem[] }) {
  if (items.length === 0) return <div className="hidden xl:block xl:w-56 xl:shrink-0" />;
  return (
    <aside className="hidden xl:block xl:w-56 xl:shrink-0">
      <div className="sticky top-24">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          On this page
        </p>
        <ul className="space-y-1.5 text-sm">
          {items.map((item, i) => (
            <li key={i} className={clsx(item.depth === 3 && "ml-3")}>
              <a
                href={`#${item.id}`}
                className="text-zinc-500 hover:text-primary"
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
