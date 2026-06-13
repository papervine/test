import { cn } from "@/lib/utils";

// shadcn/ui Skeleton — a pulsing placeholder block in the platform surface color.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-[rgba(var(--ink-rgb),0.06)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
