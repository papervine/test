"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

// shadcn/ui Command (cmdk) in the platform `.db` language — the filterable list half of a
// combobox, paired with Popover.
//
// Written by hand rather than taken from the shadcn CLI on purpose: the registry's version
// also ships `CommandDialog`, which pulls in `dialog.tsx` and would have overwritten this
// repo's customized one (the `db-portal` scoping). We don't need a command *dialog*, so the
// wrapper stops at the list primitives.
//
// cmdk handles the filtering, roving focus and aria wiring; we only swap the chrome.

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      // Transparent by design: the surface comes from the portalled PopoverContent.
      className={cn("flex w-full flex-col overflow-hidden rounded-xl", className)}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--line)] px-3">
      <Search className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
      <CommandPrimitive.Input
        className={cn(
          // text-base on small screens stops iOS zooming the viewport on focus.
          "flex h-10 w-full bg-transparent py-2 text-base outline-none placeholder:text-[var(--muted)] disabled:opacity-50 sm:text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-64 overflow-y-auto overflow-x-hidden p-1", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className="py-6 text-center text-sm text-[var(--muted)]"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden text-[var(--fg)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none",
        // cmdk marks the active row with data-selected; aria-selected is the a11y mirror.
        "data-[selected=true]:bg-[rgba(var(--ink-rgb),0.06)]",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
