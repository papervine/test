"use client";

import { useState } from "react";

// Monthly/Annual toggle + price readout for the Pro tier card. Client-side because
// the billing period is a purely presentational choice — there's no billing backend
// yet (SPEC §10 "Billing (later)"), so the toggle just swaps the displayed number.
// Annual is the default, matching the "$450/mo billed annually" anchor price.
export function ProPrice({
  monthly,
  annual,
}: {
  monthly: number;
  annual: number;
}) {
  const [period, setPeriod] = useState<"annual" | "monthly">("annual");
  const price = period === "annual" ? annual : monthly;

  const btn = (value: "monthly" | "annual", label: string) => (
    <button
      type="button"
      onClick={() => setPeriod(value)}
      aria-pressed={period === value}
      className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        period === value
          ? "bg-[rgba(var(--ink-rgb),0.1)] text-[var(--fg)]"
          : "text-[var(--muted)] hover:text-[var(--fg)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div
        className="inline-flex gap-0.5 rounded-lg bg-[rgba(var(--ink-rgb),0.04)] p-0.5"
        role="group"
        aria-label="Billing period"
      >
        {btn("monthly", "Monthly")}
        {btn("annual", "Annual")}
      </div>
      <div className="mt-3 text-4xl font-semibold tracking-tight">
        ${price}
        <span className="text-base font-normal text-[var(--muted)]">/mo</span>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {period === "annual" ? "billed annually" : "billed monthly"}
      </p>
    </div>
  );
}
