import * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui Label, but built on a plain <label> (no @radix-ui/react-label dependency —
// same no-dep stance as Switch). `htmlFor` association and click-to-focus come free from
// the native element. Muted platform text so it reads as a quiet field label.
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
