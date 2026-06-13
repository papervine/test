import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui Button skeleton (cva variants + `data-slot` + `asChild` Slot), but the
// variants speak the platform's `.db` visual language rather than stock shadcn tokens:
// `primary` is the brand blue→violet CTA (.db-cta), not `bg-primary` (which belongs to
// the docs theme). Use inside the `.db` shell. Mirrors how the incumbent keeps the shadcn
// structure and swaps the design tokens. See src/styles/platform.css.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "db-cta text-white",
        danger: "db-danger text-white",
        ghost: "db-ring text-[var(--fg)] hover:bg-[rgba(var(--ink-rgb),0.05)]",
        outline: "border border-border text-[var(--fg)] hover:bg-[rgba(var(--ink-rgb),0.05)]",
        muted: "bg-muted text-[var(--fg)] hover:bg-[rgba(var(--ink-rgb),0.1)]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
