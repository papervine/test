"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

// shadcn/ui Popover on @radix-ui/react-popover. The content is portalled to <body> —
// OUTSIDE the `.db` shell — so it carries the `db-portal` token scope to re-resolve the
// platform palette/fonts (otherwise --fg/--card/etc. are undefined and it renders as
// unstyled light-on-light). Same rule as Dialog/Sheet/DropdownMenu.
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // OPAQUE fill, via the token the palette already reserves for select popups.
          // Two things ruled out first: `--card` is a 2.5% overlay meant to sit on the
          // platform background, so portalled to <body> it's effectively transparent; and
          // `db-glass` (what dropdown-menu uses) is only 60% with a backdrop blur that
          // didn't take effect here, leaving the page legible straight through a list you're
          // supposed to be reading. A short menu tolerates that; 100+ scrolling rows don't.
          "db-portal z-50 w-72 overflow-hidden rounded-xl border border-[rgba(var(--ink-rgb),0.08)] bg-[var(--option-bg)] text-[var(--fg)] shadow-xl shadow-black/40 outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
