import * as React from "react";
import { ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

// A native <select> styled in the platform `.db` language. Deliberately NOT the Radix
// @radix-ui/react-select listbox: a native control gives the OS picker on mobile (no
// viewport-clipping popovers, real touch scrolling, keyboard + a11y for free) — the
// mobile-friendly choice. We only swap the chrome: `appearance-none` drops the OS arrow,
// our own chevron sits on the right, an optional leading icon overlays the trigger
// (native <option>s can't render icons). `text-base sm:text-sm` avoids iOS focus zoom.
function Select({
  icon,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  icon?: React.ReactNode;
}) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
          {icon}
        </span>
      )}
      <select
        data-slot="select"
        className={cn(
          "db-input h-9 w-full appearance-none rounded-lg pr-9 text-base outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm [&>option]:bg-[var(--option-bg)] [&>option]:text-[var(--fg)]",
          icon ? "pl-9" : "pl-3",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
    </div>
  );
}

export { Select };
