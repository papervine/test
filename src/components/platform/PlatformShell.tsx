import "@/styles/platform.css";
import { platformFontVars } from "@/lib/fonts";
import { VineField } from "./VineField";
import { SproutField } from "./SproutField";
import { PrismaticBurst } from "./PrismaticBurst";
import { GradientWaves } from "./GradientWaves";

// The platform's dark, luminous frame (SPEC §2). Wraps every control-plane surface
// — landing, auth, app — in the `.db` scope so the palette, fonts, and atmosphere
// resolve consistently. The docs renderer never uses this.
//
//   "full"  — glow + grid + grain. For sparse, marketing-grade pages.
//   "auth"  — glow + a prismatic burst (a shader backdrop that turns under the cursor) + grain,
//             in place of the grid. Auth is the one place someone sits and waits on a form, so it
//             can afford a backdrop that rewards a moved cursor; nowhere else has that dead time.
//             It degrades to a static wash under reduced motion or without WebGL2.
//   "home"  — glow + ambient seedling field + growing vine + grain. The landing page's
//             living backdrop (SproutField behind VineField), in place of the static grid.
//   "waves" — glow + a raymarched gradient sea under the masthead + grain, in place of the grid.
//             Pricing is a page people scan and compare on, so the motion is bounded to the top
//             of it and slowed right down; it degrades to a static wash on the same terms as the
//             burst (reduced motion, no WebGL2, no chunk).
//   "lite"  — glow only. For the data-dense app, so the grid/grain never sit behind
//             tables and forms and hurt legibility.
export function PlatformShell({
  variant = "full",
  className = "",
  children,
}: {
  variant?: "full" | "auth" | "lite" | "home" | "waves";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`db ${platformFontVars} ${className}`}>
      <div className="db-glow" />
      {variant === "full" && <div className="db-grid" />}
      {variant === "auth" && (
        <PrismaticBurst
          // Tuned for a page you read, not a demo: the burst turns slowly on its own and leans
          // toward the pointer (`hover`), damped so the motion is a drift rather than a snap.
          animationType="hover"
          intensity={1.6}
          speed={0.35}
          distort={2.2}
          hoverDampness={0.55}
          // The platform's own two brand hues, plus the deep indigo they sit on — so the burst
          // reads as this product's glow rather than a stock rainbow.
          colors={["#261B62", "#5b8cff", "#a974ff", "#BDA4F1"]}
        />
      )}
      {variant === "waves" && (
        <GradientWaves
          // The platform's own two brand hues over the deep indigo they sit on — the same
          // palette as the auth burst, so the two shader surfaces read as one product.
          horizonColor="#261B62"
          waveColor="#5b8cff"
          crestColor="#BDA4F1"
          // Tuned for a page you compare prices on, not a demo: half upstream's speed, the
          // cheapest step count (invisible behind the mask), and held back to two-thirds
          // opacity so the tier cards stay the brightest thing on screen.
          speed={0.18}
          detail="low"
          opacity={0.62}
          brightness={0.95}
          // Parallax stays, damped — it rewards a moved cursor without dragging the eye off
          // the cards. Grain is off here: `.db-grain` already lays a film over the whole shell.
          parallaxStrength={0.25}
          grain={false}
        />
      )}
      {variant === "home" && <SproutField />}
      {variant === "home" && <VineField />}
      {variant !== "lite" && <div className="db-grain" />}
      {/* No pointer-events juggling for the auth variant any more. The interactive grid this
          replaced had to RECEIVE hovers, so `.db-content` (a full-viewport box at z-index 2) was
          made transparent to the pointer and the auth layout put `pointer-events-auto` back on
          each clickable thing — a hack that had to be maintained in two files. The burst tracks
          the pointer from a window listener and takes no hits at all, so the layer stays normal. */}
      <div className="db-content">{children}</div>
    </div>
  );
}
