import { Geist, Geist_Mono } from "next/font/google";

// Platform typeface (SPEC §2 — the SaaS shell, not the docs renderer). Loaded once
// here and shared by every platform surface (landing, auth, app) via PlatformShell
// so the whole control plane speaks the same voice. The docs renderer keeps its own
// per-tenant fonts (globals.css `--db-font-*`) and never imports these.
export const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

// Class string to drop on the platform root so `var(--font-geist)` / `--font-geist-mono`
// resolve for everything beneath it.
export const platformFontVars = `${geist.variable} ${geistMono.variable}`;
