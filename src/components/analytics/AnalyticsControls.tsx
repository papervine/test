"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import { RANGE_PRESETS, type RangeKey } from "@/lib/analytics-range";

// The Humans/Agents toggle + date-range picker (SPEC §10.1). Pushes its state into
// the URL (?tab=&range=) so the server component re-queries — the page stays a server
// component, this is the only interactive island.
export function AnalyticsControls({
  tab,
  range,
  rangeLabel,
}: {
  tab: "humans" | "agents";
  range: RangeKey;
  rangeLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex items-center justify-between">
      <div className="inline-flex rounded-lg bg-white/[0.04] p-0.5 text-sm">
        {(["humans", "agents"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setParam("tab", t)}
            className={`rounded-md px-3 py-1.5 capitalize transition-colors ${
              tab === t
                ? "bg-white/[0.08] text-[var(--fg)]"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <RangeMenu
        value={range}
        label={rangeLabel}
        onSelect={(k) => setParam("range", k)}
      />
    </div>
  );
}

function RangeMenu({
  value,
  label,
  onSelect,
}: {
  value: RangeKey;
  label: string;
  onSelect: (k: RangeKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="db-ring inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-[var(--fg)] transition-colors hover:bg-white/[0.04]"
      >
        <Calendar className="h-4 w-4 text-[var(--muted)]" />
        {label}
        <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
      </button>
      {open && (
        <div className="db-glass absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.08] p-1">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                onSelect(p.key);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                value === p.key
                  ? "bg-white/[0.08] text-[var(--fg)]"
                  : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--fg)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
