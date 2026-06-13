import * as React from "react";

import { cn } from "@/lib/utils";

// shadcn/ui Input skeleton, mapped onto the platform's `.db-input` (quiet fill, violet
// focus glow — see src/styles/platform.css) instead of stock `border-input` tokens, the
// same "keep the structure, swap the design language" approach as Button. Use inside the
// `.db` shell. `h-9` + `text-base sm:text-sm` keeps the control finger-sized and stops
// iOS from zooming the viewport on focus (inputs < 16px trigger auto-zoom on mobile).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "db-input flex h-9 w-full rounded-lg px-3 py-1 text-base outline-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
