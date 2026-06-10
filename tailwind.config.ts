import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{ts,tsx}",
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
