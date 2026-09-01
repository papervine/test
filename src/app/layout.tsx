import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { platformFontVars } from "@/lib/fonts";
import type { DocsConfig } from "@papervine/renderer/lib/config";
import { contentContext, loadConfig } from "@papervine/renderer/lib/content";
import { requestContentSource, requestAssetBase } from "@/lib/request-source";
import { requestOrigin } from "@/lib/request-origin";
import { isAppHost } from "@/lib/tenant-host";
import { resolveTheme, themeCssVars } from "@papervine/renderer/lib/theme";
import { appearanceInitScript } from "@papervine/renderer/lib/appearance";
import { Favicon } from "@papervine/renderer/components/Favicon";
import { PLATFORM_ICONS } from "@/lib/brand";
import { EnvBadge } from "@/components/platform/EnvBadge";
import { LogRocketInit } from "@/components/platform/LogRocketInit";
import { ChatwootWidget } from "@/components/platform/ChatwootWidget";
import { SupportWidget } from "@/components/platform/SupportWidget";

/** Flip back to `true` to restore the Chatwoot inbox and drop <SupportWidget /> above it. */
const CHATWOOT_ENABLED = false;

// The root layout renders for every host, including tenant docs. Read config within
// the request's tenant content source (if any) so the title/theme/favicon — and, crucially,
// the per-request React `cache()` entry for loadConfig — come from the same source the
// page will read, not the default content/ repo. See requestContentSource(). `assetBase`
// comes from the SAME tenant (and only when a source exists), so a tenant favicon path
// resolves through its asset proxy instead of escaping to the apex.
async function loadRequestConfig(): Promise<{
  config: DocsConfig;
  assetBase: string;
  isTenant: boolean;
}> {
  const src = await requestContentSource();
  if (!src) return { config: await loadConfig(), assetBase: "", isTenant: false };
  const config = await contentContext.run(src, () => loadConfig());
  return { config, assetBase: await requestAssetBase(), isTenant: true };
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
  // `metadataBase` is what turns the root-relative `og:image` / canonical URLs each docs page
  // returns into the ABSOLUTE ones crawlers require — X drops a card whose image URL is
  // relative. It has to be the request's own origin: one deployment answers on the apex,
  // every tenant subdomain and every customer vanity domain (see request-origin.ts).
  const origin = await requestOrigin();
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
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
  const { config, assetBase, isTenant } = await loadRequestConfig();

  // The dashboard now mounts the OWNER's own widget (SPEC §8.7, SiteAssistantWidget), and the
  // embed loader is a per-document singleton whose first init() wins — so our support widget
  // and theirs can't both live on the app host: whichever mounted first would take the corner
  // and the other would silently no-op, at worst leaving an owner chatting with OUR docs from
  // inside their dashboard. Ours yields there and keeps the marketing surfaces, where it's the
  // only widget and the one people are looking for.
  const onAppHost = isAppHost((await headers()).get("host"));

  /**
   * Whose icons go in the <head>: ours, or the docs site's own.
   *
   * Ours on the dashboard and on the hosted marketing/auth/legal apex. THEIRS everywhere a docs
   * repo is being rendered — a tenant (`isTenant`), and also single-repo mode, where
   * `PAPERVINE_CONTENT` points at somebody's own repo and there is no tenant record: that's
   * `papervine dev` / `papervine serve`, and stamping the Papervine favicon on a self-hoster's
   * site would be both wrong and rude.
   */
  const platformChrome = onAppHost || (!isTenant && !process.env.PAPERVINE_CONTENT);

  const theme = resolveTheme(config.theme);
  const colors = config.colors;
  const themeVars = `:root{--color-primary:${colors.primary};--color-primary-light:${
    colors.light ?? colors.primary
  };--color-primary-dark:${colors.dark ?? colors.primary};${themeCssVars(theme.tokens)};}`;
  const themeScript = appearanceInitScript(config.appearance);

  // `data-scroll-behavior="smooth"` acknowledges the `scroll-behavior: smooth` we set in
  // globals.css for #anchor links. Without it Next ANIMATES scroll restoration on every
  // route change instead of jumping instantly — so navigating the docs sidebar slid the
  // page around visibly. The attribute keeps smooth scrolling for in-page anchors while
  // letting route transitions land immediately.
  return (
    <html
      lang="en"
      data-theme={theme.name}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* Icons split the same way the analytics below do, and for the same reason: this one
            layout renders the marketing apex, the dashboard AND every tenant's docs site. A
            tenant's icons come from their own `docs.json` (<Favicon>); ours are served from
            /brand/* and emitted only where there's no tenant — which is also why these aren't
            Next's `app/favicon.ico` file convention, since that would inject our icon into
            customers' pages alongside theirs. */}
        {platformChrome ? (
          PLATFORM_ICONS.map((icon) => <link key={icon.href} {...icon} />)
        ) : (
          <Favicon favicon={config.favicon} assetBase={assetBase} />
        )}
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
        {/* Vercel Analytics for OUR OWN surfaces only — marketing, pricing, signup, the
            dashboard. Deliberately NOT on tenant docs, which this same root layout also
            renders (see loadRequestConfig): mounting it there would put a third-party script
            on customers' sites, bill their readers' pageviews to our Vercel quota, and
            double-count against the per-tenant analytics we already collect first-party
            (PageViewBeacon → Insights, SPEC §10.1). `isTenant` is false on the apex and on
            the app host, which is exactly the set of pages we own. */}
        {/* Both are OURS, and both stop at the tenant boundary. Analytics counts pageviews;
            LogRocket records sessions (DOM, network, console) — so on a tenant page it would be
            recording our customers' readers. `isTenant` is false on the apex and the app host,
            i.e. exactly the pages we own: marketing, auth, onboarding, /admin, the dashboard.
            The dashboard layout mounts LogRocketInit again WITH the signed-in user, which is
            the only place a session exists; the init is deduped. */}
        {!isTenant && (
          <>
            <Analytics />
            <LogRocketInit appId={process.env.NEXT_PUBLIC_LOGROCKET_APP_ID} />
            {/* Our support channel. Same gate for a sharper reason: on a tenant's docs site this
                would invite THEIR readers to chat with US, and it would collide with the
                tenant's own assistant launcher in the same corner.

                TEMPORARY: our own assistant widget stands in for the Chatwoot inbox — we sell
                this, so we should be answering with it. Chatwoot is left mounted-but-inert
                right below; putting it back is flipping CHATWOOT_ENABLED and dropping
                <SupportWidget />.

                PRODUCTION ONLY, and not squeamishness: the widget's chat endpoint checks the
                request Origin against the site's allowlist, so from localhost or a preview URL
                every call is refused and the failures land in the console — which the e2e specs
                assert stays clean (editor.spec.ts). There is nothing to see locally anyway,
                since the widget id below is a production row. */}
            {process.env.VERCEL_ENV === "production" && !onAppHost && <SupportWidget />}
            {CHATWOOT_ENABLED && (
              <ChatwootWidget
                websiteToken={process.env.NEXT_PUBLIC_CHATWOOT_TOKEN}
                baseUrl={process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL}
              />
            )}
          </>
        )}
      </body>
    </html>
  );
}
