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
