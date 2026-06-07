import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import type { DocsConfig } from "@/lib/config";

export function Navbar({ config }: { config: DocsConfig }) {
  const links = config.navbar?.links ?? [];
  const primary = config.navbar?.primary;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/80 px-6 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <Link href="/" className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
        {config.name}
      </Link>
      <div className="flex items-center gap-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {link.label}
          </Link>
        ))}
        {primary && (
          <Link
            href={primary.href}
            className="ml-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {primary.label}
          </Link>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
