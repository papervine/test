import * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui Switch skeleton, mapped onto the platform's `.db` tokens (brand blue on,
// translucent white off) — same "keep the shadcn structure, swap the design language"
// approach as Button. Built on a plain <button> rather than @radix-ui/react-switch so it
// adds no dependency.
//
// Robustness note: the thumb is positioned by `border-2 border-transparent` (a 2px inset
// on every side) plus a `translate-x` of exactly track-width − thumb-width, NOT by an
// absolute offset + a magic pixel translate. That makes the geometry structural — the
// thumb can't drift outside the track at any size — which the earlier hand-rolled toggle
// got wrong (thumb floated off the right edge).
function Switch({
  checked = false,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[var(--blue)]" : "bg-[rgba(var(--ink-rgb),0.12)]",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export { Switch };
