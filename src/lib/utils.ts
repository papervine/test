import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The shadcn `cn()` primitive: clsx for conditional joins, tailwind-merge to
// resolve conflicting utilities (later wins). Used by everything under
// src/components/ui/. See components.json.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
