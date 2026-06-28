import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { platformFontVars } from "@/lib/fonts";
import type { DocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, loadConfig } from "@papervine/renderer/lib/content";
import { requestContentSource, requestAssetBase } from "@/lib/request-source";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";
import { appearanceInitScript } from "@papervine/renderer/lib/appearance";
import { Favicon } from "@papervine/renderer/components/Favicon";
import { EnvBadge } from "@/components/platform/EnvBadge";

// The root layout renders for every host, including tenant docs. Read config within
// the request's tenant content source (if any) so the title/theme/favicon — and, crucially,
// the per-request React `cache()` entry for loadConfig — come from the same source the
// page will read, not the default content/ repo. See requestContentSource(). `assetBase`
// comes from the SAME tenant (and only when a source exists), so a tenant favicon path
// resolves through its asset proxy instead of escaping to the apex.
async function loadRequestConfig(): Promise<{ config: DocsConfig; assetBase: string }> {
  const src = await requestContentSource();
  if (!src) return { config: await loadConfig(), assetBase: "" };
  const config = await contentContext.run(src, () => loadConfig());
  return { config, assetBase: await requestAssetBase() };
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
  const { config } = await loadRequestConfig();
  return {
    title: { default: config.name, template: `%s · ${config.name}` },
  };
}

// Platform (control-plane) light/dark, independent of the per-tenant docs theme above. Sets
// `data-db-theme` on <html> before paint from the `pv-theme` preference (`light`|`dark`|
// `system`; default dark, preserving the original look), which `.db`/`.db-portal` read in
// platform.css. Pre-paint so there's no flash; `system` resolves against the OS preference.
function buildPlatformThemeScript() {
  return `(function(){try{var t=localStorage.getItem('pv-theme')||'dark';if(t==='system')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-db-theme',t);}catch(e){document.documentElement.setAttribute('data-db-theme','dark');}})();`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { config, assetBase } = await loadRequestConfig();

  const theme = resolveTheme(config.theme);
  const colors = config.colors;
  const themeVars = `:root{--color-primary:${colors.primary};--color-primary-light:${
    colors.light ?? colors.primary
  };--color-primary-dark:${colors.dark ?? colors.primary};${themeCssVars(theme.tokens)};}`;
  const themeScript = appearanceInitScript(config.appearance);

  return (
    <html lang="en" data-theme={theme.name} suppressHydrationWarning>
      <head>
        <Favicon favicon={config.favicon} assetBase={assetBase} />
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
