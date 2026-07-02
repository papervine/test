"use client";

import { useMemo } from "react";
import { diffLines } from "diff";

// Full-editor split diff (published ⇄ working draft), like the incumbent's diff mode. Left column is
// the live/base content (deletions in red), right is the current draft (additions in green);
// changed regions pair line-by-line. Line-level (not word-level) — enough to review a change.

type Row = {
  type: "same" | "del" | "add" | "mod";
  ln: number | null;
  rn: number | null;
  left: string | null;
  right: string | null;
};

function toLines(value: string): string[] {
  return value.replace(/\n$/, "").split("\n");
}

function buildRows(base: string, draft: string): Row[] {
  const parts = diffLines(base, draft);
  const rows: Row[] = [];
  let ln = 1;
  let rn = 1;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = toLines(p.value);
    if (!p.added && !p.removed) {
      for (const line of lines) rows.push({ type: "same", ln: ln++, rn: rn++, left: line, right: line });
      continue;
    }
    if (p.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        // A modified region — pair removed (left) with added (right) line-by-line.
        const removed = lines;
        const added = toLines(next.value);
        const max = Math.max(removed.length, added.length);
        for (let k = 0; k < max; k++) {
          const l = removed[k] ?? null;
          const r = added[k] ?? null;
          rows.push({
            type: l !== null && r !== null ? "mod" : l !== null ? "del" : "add",
            ln: l !== null ? ln++ : null,
            rn: r !== null ? rn++ : null,
            left: l,
            right: r,
          });
        }
        i++; // consumed the paired `added` part
        continue;
      }
      for (const line of lines) rows.push({ type: "del", ln: ln++, rn: null, left: line, right: null });
      continue;
    }
    // added only
    for (const line of lines) rows.push({ type: "add", ln: null, rn: rn++, left: null, right: line });
  }
  return rows;
}

export function DiffView({ base, draft }: { base: string; draft: string }) {
  const rows = useMemo(() => buildRows(base, draft), [base, draft]);
  const unchanged = base === draft;

  return (
    <div className="pv-diff">
      {unchanged && <div className="pv-diff-empty">No changes vs. the published version.</div>}
      <div className="pv-diff-grid">
        {rows.map((row, i) => (
          <div key={i} className="pv-diff-row">
            <div className={`pv-diff-cell ${row.left !== null ? (row.type === "same" ? "" : "is-del") : "is-empty"}`}>
              <span className="pv-diff-ln">{row.ln ?? ""}</span>
              <span className="pv-diff-code">{row.left ?? ""}</span>
            </div>
            <div className={`pv-diff-cell ${row.right !== null ? (row.type === "same" ? "" : "is-add") : "is-empty"}`}>
              <span className="pv-diff-ln">{row.rn ?? ""}</span>
              <span className="pv-diff-code">{row.right ?? ""}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
