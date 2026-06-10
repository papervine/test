import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui Badge skeleton (cva + `data-slot`). The `local`/`preview` variants are
// self-contained (solid, concrete colors — no `.db` vars) so the badge stays legible
// on ANY background, including the light docs renderer where the env marker also shows.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-white/10 text-white",
        outline: "border-border text-[var(--fg)]",
        success: "border-transparent bg-emerald-500/15 text-emerald-300",
        local: "border-transparent bg-amber-400 text-amber-950 shadow-sm",
        preview: "border-transparent bg-violet-500 text-white shadow-sm",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
