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
        primary: {
          DEFAULT: "var(--color-primary)",
          light: "var(--color-primary-light)",
          dark: "var(--color-primary-dark)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
