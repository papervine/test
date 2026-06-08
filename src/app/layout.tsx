import type { Metadata } from "next";
import "./globals.css";
import { loadConfig } from "@/lib/content";
import { buildNav } from "@/lib/nav";
import { Navbar } from "@/components/Navbar";
import { NavTabs } from "@/components/NavTabs";
import { Sidebar } from "@/components/Sidebar";
import { Assistant } from "@/components/assistant/Assistant";

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadConfig();
  return {
    title: { default: config.name, template: `%s · ${config.name}` },
  };
}

// Set the theme class before paint to avoid a flash of the wrong theme. Default
// is light (the incumbent's default appearance); only an explicit stored choice of
// "dark" opts in — we don't follow the OS preference unless the user toggles.
const themeScript = `
(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();
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
        <NavTabs sections={sections} />
        <div className="mx-auto flex max-w-7xl gap-8 pl-9 pr-6">
          <Sidebar sections={sections} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
        <Assistant />
      </body>
    </html>
  );
}
