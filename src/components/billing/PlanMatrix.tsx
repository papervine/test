import { Fragment, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  MATRIX_TIERS,
  PLAN_MATRIX,
  type PlanCell,
  type PlanKey,
} from "@/lib/billing/plan-content";

// The plan comparison table — shared by the public /pricing page and the in-app Billing
// settings surface (single source of copy). Presentational server component; uses `.db`
// platform tokens so it renders in both the marketing shell and the dashboard shell.
// `renderCta` lets each host put its own action under each tier header (signup links on
// /pricing; nothing, or a current-plan marker, in-app) — omit for a header with no CTAs.

function MatrixCell({ value }: { value: PlanCell }) {
  if (value === true)
    return (
      <span className="inline-flex">
        <Check className="h-4 w-4 text-[var(--blue)]" />
      </span>
    );
  if (value === false) return <span className="text-[var(--line)]">—</span>;
  return <span className="text-xs text-[var(--muted)]">{value}</span>;
}

export function PlanMatrix({
  renderCta,
}: {
  renderCta?: (tierKey: PlanKey) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-1/3" />
            {MATRIX_TIERS.map(({ key, name, icon: Icon }) => (
              <th key={key} className="px-3 pb-6 text-center align-bottom">
                <div className="flex flex-col items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[var(--fg)]">
                    <Icon className="h-4 w-4" />
                    {name}
                  </span>
                  {renderCta?.(key)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLAN_MATRIX.map(({ group, rows }) => (
            <Fragment key={group}>
              <tr>
                <td
                  colSpan={MATRIX_TIERS.length + 1}
                  className="pb-3 pt-10 text-sm font-semibold text-[var(--fg)]"
                >
                  {group}
                </td>
              </tr>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className="border-t border-[rgba(var(--ink-rgb),0.06)]"
                >
                  <td className="py-3 pr-3 text-[var(--muted)]">{row.label}</td>
                  {MATRIX_TIERS.map((t) => (
                    <td key={t.key} className="py-3 text-center">
                      <MatrixCell value={row[t.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
