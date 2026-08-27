import { loadFont as loadDisplay } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadBody } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";

// The real Papervine stack: Space Grotesk is the brand display face (`--font-brand`,
// src/app/layout.tsx), Geist is the platform body font and Geist Mono the code face.
// Loaded here rather than per-scene so a font never arrives mid-render.
export const display = loadDisplay("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
}).fontFamily;

export const body = loadBody("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
}).fontFamily;

export const mono = loadMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
}).fontFamily;
