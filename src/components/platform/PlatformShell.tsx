import "@/styles/platform.css";
import { platformFontVars } from "@/lib/fonts";
import { VineField } from "./VineField";
import { SproutField } from "./SproutField";

// The platform's dark, luminous frame (SPEC §2). Wraps every control-plane surface
// — landing, auth, app — in the `.db` scope so the palette, fonts, and atmosphere
// resolve consistently. The docs renderer never uses this.
//
//   "full"  — glow + grid + grain. For sparse, marketing-grade pages (auth).
//   "home"  — glow + ambient seedling field + growing vine + grain. The landing page's
//             living backdrop (SproutField behind VineField), in place of the static grid.
//   "lite"  — glow only. For the data-dense app, so the grid/grain never sit behind
//             tables and forms and hurt legibility.
export function PlatformShell({
  variant = "full",
  className = "",
  children,
}: {
  variant?: "full" | "lite" | "home";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`db ${platformFontVars} ${className}`}>
      <div className="db-glow" />
      {variant === "full" && <div className="db-grid" />}
      {variant === "home" && <SproutField />}
      {variant === "home" && <VineField />}
      {variant !== "lite" && <div className="db-grain" />}
      <div className="db-content">{children}</div>
    </div>
  );
}
