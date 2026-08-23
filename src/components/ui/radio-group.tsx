"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";

// shadcn/ui RadioGroup on @radix-ui/react-radio-group, mapped onto the platform's `.db`
// tokens (brand blue when selected, translucent ink when not) — the same "keep the shadcn
// structure, swap the design language" approach as Button and Switch. Radix supplies the
// accessibility we'd otherwise hand-roll: role=radiogroup/radio, aria-checked, a roving
// tabindex, and arrow-key navigation with selection following focus.
//
// Renders inline (no portal), so it needs no `db-portal` scope.
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} />;
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "aspect-square size-4 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        "border-[rgba(var(--ink-rgb),0.25)] data-[state=checked]:border-[var(--blue)]",
        className,
      )}
      {...props}
    >
      {/* A filled dot rather than lucide's Circle: at 4px the icon's stroke geometry reads
          as a smudge, while a plain rounded span stays crisp at any zoom. */}
      <RadioGroupPrimitive.Indicator className="flex size-full items-center justify-center">
        <span className="block size-2 rounded-full bg-[var(--blue)]" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
