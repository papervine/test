import * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui Textarea, mapped onto the platform `.db-input` (matching Input). `text-base
// sm:text-sm` avoids iOS focus zoom on mobile.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "db-input flex min-h-16 w-full rounded-lg px-3 py-2 text-base outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
