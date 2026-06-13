import * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui Separator, no-dep (a styled <div> with role/aria instead of
// @radix-ui/react-separator). Hairline in the platform `--line` color.
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}) {
  return (
    <div
      data-slot="separator"
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0 bg-[rgba(var(--ink-rgb),0.07)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
