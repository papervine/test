import "@/styles/platform.css";
import { platformFontVars } from "@/lib/fonts";

// The platform's dark, luminous frame (SPEC §2). Wraps every control-plane surface
// — landing, auth, app — in the `.db` scope so the palette, fonts, and atmosphere
// resolve consistently. The docs renderer never uses this.
//
//   "full"  — glow + grid + grain. For sparse, marketing-grade pages (landing, auth).
//   "lite"  — glow only. For the data-dense app, so the grid/grain never sit behind
//             tables and forms and hurt legibility.
export function PlatformShell({
  variant = "full",
  className = "",
  children,
}: {
  variant?: "full" | "lite";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`db ${platformFontVars} ${className}`}>
      <div className="db-glow" />
      {variant === "full" && <div className="db-grid" />}
      {variant === "full" && <div className="db-grain" />}
      <div className="db-content">{children}</div>
    </div>
  );
}
