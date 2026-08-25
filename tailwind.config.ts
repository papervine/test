import type { Config } from "tailwindcss";

const config: Config = {
  // Two independent dark triggers (SPEC §2 has two theme systems): the per-tenant docs
  // appearance toggles the `.dark` class, while the control-plane platform toggles
  // `data-db-theme` on <html> (read by the `.db` palette in platform.css). Platform chrome
  // — the editor, dashboard — is built with Tailwind `dark:` utilities, so `dark:` must
  // also fire inside the `.db` scope when the platform theme is dark; otherwise those
  // components render their light styles on the dark platform (white boxes). Keeping the
  // `.dark` selector first preserves docs/marketing behavior unchanged.
  darkMode: [
    "variant",
    [
      "&:where(.dark, .dark *)",
      '&:where([data-db-theme="dark"] .db, [data-db-theme="dark"] .db *)',
    ],
  ],
  content: [
    "./src/**/*.{ts,tsx}",
    // The docs renderer is a workspace package; its components (Navbar logo, nav, MDX
    // primitives) emit Tailwind classes too. Without this glob, classes used ONLY here
    // (e.g. the logo's `h-7`) get purged from the docs CSS while shared ones survive via
    // src/** — so the docs render mostly-styled but the logo collapses to 0×0.
    "./packages/renderer/**/*.{ts,tsx}",
    "./node_modules/streamdown/dist/**/*.js", // assistant markdown renderer classes
  ],
  // Classes that only ever appear in a TENANT'S MDX. Their content is fetched from Git or object
  // storage at request time, so the scanner above can never see it — a class used only in
  // someone's docs page is purged, and the page renders unstyled with nothing to indicate why.
  //
  // This isn't solvable in general (a page may use any class), so the list is scoped to what the
  // compatibility target's own guidance tells authors to write — `className="w-full aspect-video
  // rounded-xl"` on a <video>, the same plus `h-96` on an <iframe>. A repo that followed that
  // advice rendered here WITHOUT an aspect ratio, because `aspect-video` appears nowhere in our
  // own source: measured against the served stylesheet, `aspect-video`, `h-96` and `object-cover`
  // were missing while `w-full` and `rounded-xl` happened to survive only because our UI uses
  // them. Which media classes worked was an accident; listing them makes it a guarantee.
  //
  // Some entries here look redundant, and that is the point: `aspect-video` is currently also
  // kept alive by the MEDIA_CLASSES string in src/lib/media-embed.ts, because the scanner reads
  // candidate names out of any string in scanned source. That is the same accidental coverage
  // this list exists to replace — move or rename that constant and the class silently vanishes
  // from the CSS while every page still asks for it. tests/smoke.mjs reads the served stylesheet
  // and fails if any of these are purged, since the page HTML looks identical either way.
  safelist: [
    "aspect-video",
    "aspect-square",
    "object-cover",
    "object-contain",
    "w-full",
    "max-w-full",
    "mx-auto",
    "h-64",
    "h-96",
    "rounded-lg",
    "rounded-xl",
    "rounded-2xl",
    "shadow-lg",
  ],
  theme: {
    extend: {
      colors: {
        // Driven by docs.json colors, injected as CSS variables (SPEC.md §5 theming).
        // NOTE: `primary` belongs to the per-tenant docs theme — do NOT repoint it at
        // the platform palette, or shadcn `bg-primary` would hijack tenant theming.
        primary: {
          DEFAULT: "var(--color-primary)",
          light: "var(--color-primary-light)",
          dark: "var(--color-primary-dark)",
        },
        // Neutral shadcn/ui tokens for the control-plane shell, mapped onto the `.db`
        // platform vars (src/styles/platform.css). These only resolve inside the `.db`
        // scope (PlatformShell), so they can't leak into the light-first docs renderer.
        border: "var(--line)",
        ring: "var(--blue)",
        muted: {
          DEFAULT: "var(--card)",
          foreground: "var(--muted)",
        },
        accent: {
          DEFAULT: "rgba(255, 255, 255, 0.06)",
          foreground: "var(--fg)",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
