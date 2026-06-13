"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

// Light/dark switch for the control plane (platform theme, not the docs theme). Flips
// `data-db-theme` on <html> — which platform.css reads to swap the `.db` palette — and
// persists the choice to `localStorage['pv-theme']`, the same key the pre-paint script in
// the root layout reads to avoid a flash on the next load. SSR can't know the stored value
// (it's client-only), so the icon resolves on mount; the page itself is already correct from
// the pre-paint script, so only the icon settles, not the colors.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-db-theme");
    setTheme(current === "light" ? "light" : "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-db-theme", next);
    try {
      localStorage.setItem("pv-theme", next);
    } catch {
      // private mode / storage disabled — the toggle still works for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[rgba(var(--ink-rgb),0.06)] hover:text-[var(--fg)]",
        className,
      )}
    >
      {/* Until mounted, render the dark-state icon to match SSR and avoid a hydration mismatch. */}
      {mounted && theme === "light" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </button>
  );
}
