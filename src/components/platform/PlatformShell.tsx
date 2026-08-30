import "@/styles/platform.css";
import { platformFontVars } from "@/lib/fonts";
import { VineField } from "./VineField";
import { SproutField } from "./SproutField";
import { InteractiveGrid } from "./InteractiveGrid";

// The platform's dark, luminous frame (SPEC §2). Wraps every control-plane surface
// — landing, auth, app — in the `.db` scope so the palette, fonts, and atmosphere
// resolve consistently. The docs renderer never uses this.
//
//   "full"  — glow + grid + grain. For sparse, marketing-grade pages.
//   "auth"  — the same, with the grid made interactive (cells light under the cursor). Auth is
//             the one place someone sits and waits on a form, so it can afford a backdrop that
//             rewards a moved cursor; nowhere else has that dead time.
//   "home"  — glow + ambient seedling field + growing vine + grain. The landing page's
//             living backdrop (SproutField behind VineField), in place of the static grid.
//   "lite"  — glow only. For the data-dense app, so the grid/grain never sit behind
//             tables and forms and hurt legibility.
export function PlatformShell({
  variant = "full",
  className = "",
  children,
}: {
  variant?: "full" | "auth" | "lite" | "home";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`db ${platformFontVars} ${className}`}>
      <div className="db-glow" />
      {variant === "full" && <div className="db-grid" />}
      {variant === "auth" && <InteractiveGrid />}
      {variant === "home" && <SproutField />}
      {variant === "home" && <VineField />}
      {variant !== "lite" && <div className="db-grain" />}
      {/* The auth variant makes the content LAYER transparent to the pointer, not just its
          children: `.db-content` is a full-viewport box at z-index 2, so a `pointer-events-none`
          on what it wraps still leaves the layer itself swallowing every hover before the grid
          underneath sees one. The auth layout puts `pointer-events-auto` back on the two things
          you can click. Nowhere else wants this, which is why it hangs off the variant. */}
      <div className={`db-content${variant === "auth" ? " pointer-events-none" : ""}`}>
        {children}
      </div>
    </div>
  );
}
