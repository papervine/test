import type { ReactNode } from "react";
import Link from "next/link";
import { icons } from "lucide-react";
import clsx from "clsx";

// the incumbent's `icon` is usually a Lucide/FontAwesome name, but can also be a JSX
// node or a URL — render strings as Lucide icons, pass anything else through.
function LucideIcon({ name, className }: { name?: ReactNode; className?: string }) {
  if (!name) return null;
  if (typeof name !== "string") {
    return <span className={className}>{name}</span>;
  }
  const key = name
    .split(/[-_ ]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("") as keyof typeof icons;
  const Cmp = icons[key];
  return Cmp ? <Cmp className={className} /> : null;
}

export function Card({
  title,
  icon,
  href,
  children,
}: {
  title?: string;
  icon?: ReactNode;
  href?: string;
  children?: ReactNode;
}) {
  const inner = (
    <div
      className={clsx(
        "group h-full rounded-xl border border-zinc-200 bg-white p-5 transition-colors dark:border-zinc-800 dark:bg-zinc-900",
        href && "hover:border-primary hover:shadow-sm",
      )}
    >
      {icon && <LucideIcon name={icon} className="mb-3 h-6 w-6 text-primary" />}
      {title && <h3 className="m-0 text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>}
      {children && <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 [&>p]:my-0">{children}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="no-underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function CardGroup({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div
      className="my-5 grid gap-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}
