import Link from "next/link";

// Shared chrome for the Operator console's pages, so five surfaces don't drift into five
// different table and header treatments.

export function PageHead({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {desc && <p className="mt-1.5 max-w-2xl text-sm text-[var(--muted)]">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

/** Page padding, shared so every section lines up with the nav. */
export function AdminPage({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </>
  );
  const cls =
    "rounded-xl border border-[rgba(var(--ink-rgb),0.08)] px-4 py-3 transition-colors";
  // A stat that has a page behind it becomes the way in — the old console made you scroll to
  // find the same information.
  return href ? (
    <Link href={href} className={`${cls} hover:bg-[rgba(var(--ink-rgb),0.04)]`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** A horizontally scrollable table shell — wide operator tables must not widen the page. */
export function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[rgba(var(--ink-rgb),0.08)]">
      <table className="w-full min-w-[42rem] text-sm">
        <thead className="border-b border-[rgba(var(--ink-rgb),0.06)] text-left text-xs text-[var(--muted)]">
          {head}
        </thead>
        <tbody className="divide-y divide-[rgba(var(--ink-rgb),0.05)]">{children}</tbody>
      </table>
    </div>
  );
}

// `children` optional: an action column has a header cell with no label.
export function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 font-medium ${right ? "text-right" : ""}`}>{children}</th>
  );
}

export function Td({
  children,
  right,
  mono,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2.5 ${right ? "text-right tabular-nums" : ""} ${
        mono ? "font-mono text-xs" : ""
      }`}
    >
      {children}
    </td>
  );
}

export function StatusPill({ status }: { status: string }) {
  const live = status === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${
        live ? "text-emerald-400" : "text-[var(--muted)]"
      }`}
    >
      <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-[var(--muted)]"}`} />
      {status}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{children}</p>;
}

export const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
