import type { Metadata } from "next";
import "./globals.css";
import { loadConfig } from "@/lib/content";
import { buildNav } from "@/lib/nav";
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadConfig();
  return {
    title: { default: config.name, template: `%s · ${config.name}` },
  };
}

// Set the theme class before paint to avoid a flash of the wrong theme.
const themeScript = `
(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark');}}catch(e){}})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const config = await loadConfig();
  const sections = await buildNav(config);

  const colors = config.colors;
  const themeVars = `:root{--color-primary:${colors.primary};--color-primary-light:${
    colors.light ?? colors.primary
  };--color-primary-dark:${colors.dark ?? colors.primary};}`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeVars }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Navbar config={config} />
        <div className="mx-auto flex max-w-7xl">
          <Sidebar sections={sections} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
