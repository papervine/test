"use client";

import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// shadcn's sonner wrapper, adapted to Papervine's platform theme. The stock version themes via
// `next-themes`, which this repo doesn't use — we have two bespoke theme systems (the docs `.dark`
// class and the platform `data-db-theme`; see AGENTS.md). Here we follow the *platform* appearance:
// read `data-db-theme` off <html> and re-render on toggle.
//
// Two platform-specific touches:
//  • `db-portal` — sonner renders its container at <body>, outside the `.db` shell, so it carries
//    the `db-portal` token scope to re-resolve the platform palette/fonts (same reason
//    components/ui/dialog.tsx does). Without it, control-plane toasts render unthemed.
//  • `richColors` — gives success/error toasts their green/red treatment (self-contained in sonner,
//    so it doesn't depend on shadcn semantic tokens this repo doesn't define).
function usePlatformTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-db-theme") === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-db-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function Toaster(props: ToasterProps) {
  const theme = usePlatformTheme();
  return <Sonner theme={theme} richColors closeButton className="toaster group db-portal" {...props} />;
}
