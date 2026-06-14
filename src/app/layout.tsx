import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { platformFontVars } from "@/lib/fonts";
import { contentContext, loadConfig } from "@papervine/renderer/lib/content";
import { requestContentSource } from "@/lib/request-source";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";
import { EnvBadge } from "@/components/platform/EnvBadge";

// The root layout renders for every host, including tenant docs. Read config within
// the request's tenant content source (if any) so the title/theme — and, crucially,
// the per-request React `cache()` entry for loadConfig — come from the same source the
// page will read, not the default content/ repo. See requestContentSource().
async function loadRequestConfig() {
  const src = await requestContentSource();
  return src ? contentContext.run(src, () => loadConfig()) : loadConfig();
}

// Modern geometric display face for the Papervine wordmark (see <Wordmark>).
// Exposed as the `--font-brand` CSS var, consumed by the `.font-brand` utility.
const brandFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-brand",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadRequestConfig();
  return {
    title: { default: config.name, template: `%s · ${config.name}` },
  };
}

// Set the dark class before paint to avoid a flash of the wrong appearance. A
// stored user choice wins; otherwise we honor docs.json `appearance.default`
// (light | dark | system) — `system` follows the OS preference.
function buildThemeScript(defaultAppearance: "light" | "dark" | "system") {
  return `(function(){try{var d=${JSON.stringify(defaultAppearance)};var s=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(s?s==='dark':(d==='dark'||(d==='system'&&m)))document.documentElement.classList.add('dark');}catch(e){}})();`;
}

// Platform (control-plane) light/dark, independent of the per-tenant docs theme above. Sets
// `data-db-theme` on <html> before paint from the `pv-theme` preference (`light`|`dark`|
// `system`; default dark, preserving the original look), which `.db`/`.db-portal` read in
// platform.css. Pre-paint so there's no flash; `system` resolves against the OS preference.
function buildPlatformThemeScript() {
  return `(function(){try{var t=localStorage.getItem('pv-theme')||'dark';if(t==='system')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-db-theme',t);}catch(e){document.documentElement.setAttribute('data-db-theme','dark');}})();`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await loadRequestConfig();

  const theme = resolveTheme(config.theme);
  const colors = config.colors;
  const themeVars = `:root{--color-primary:${colors.primary};--color-primary-light:${
    colors.light ?? colors.primary
  };--color-primary-dark:${colors.dark ?? colors.primary};${themeCssVars(theme.tokens)};}`;
  const themeScript = buildThemeScript(config.appearance?.default ?? "light");

  return (
    <html lang="en" data-theme={theme.name} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: buildPlatformThemeScript() }} />
      </head>
      {/* The platform font vars sit on <body> (not just the .db shell) so they also resolve
          for control-plane content Radix portals to <body> — dialogs, the mobile nav drawer,
          menus. Defining the vars here is inert for the docs renderer, which references its
          own `--db-font-*`; only `.db`/`.db-portal` rules consume `--font-geist`. */}
      <body className={`${brandFont.variable} ${platformFontVars}`}>
        {children}
        <EnvBadge />
      </body>
    </html>
  );
}
