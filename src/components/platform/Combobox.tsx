"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type ComboboxOption = { value: string; label: string };

/**
 * A searchable single-select in the platform `.db` language — trigger, then a popover with a
 * filter box, a scrolling list, and a check on the current value.
 *
 * **Why this exists alongside `ui/select.tsx`.** That primitive deliberately wraps a *native*
 * `<select>`, and its reasoning holds for most cases: the OS picker on mobile, real touch
 * scrolling, no viewport clipping, a11y for free. What it can't do is **filter** — and a
 * GitHub account with dozens of repositories is exactly where scrolling an unfiltered native
 * list falls apart. So: reach for `Select` by default, reach for this when the list is long
 * enough that typing to narrow it is the point.
 *
 * The popover portals to <body>, and `PopoverContent` carries `db-portal` so the platform
 * tokens still resolve out there.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  icon,
  disabled = false,
  ariaLabel,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Rendered inside the trigger, before the value (a provider mark, typically). */
  icon?: ReactNode;
  disabled?: boolean;
  /** The accessible name — the trigger reports role=combobox, so tests can find it by this. */
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        // role=combobox + aria-expanded is what makes this announce (and be findable) as a
        // select rather than a plain button.
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          "db-input flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-base sm:text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {icon}
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-[var(--muted)]")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
      </PopoverTrigger>
      {/* Radix focuses the content on open, which lands on the filter input (its first
          focusable child) — so no `autoFocus` attribute, which browsers log as a console
          ERROR ("Blocked autofocusing on an <input> element in a cross-origin subframe")
          and which would trip the console-clean e2e assertions for no benefit. */}
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                // cmdk filters on `value`; use the label so typing matches what's shown.
                value={option.label}
                onSelect={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && (
                  <Check className="size-4 shrink-0 text-emerald-400" aria-hidden />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
