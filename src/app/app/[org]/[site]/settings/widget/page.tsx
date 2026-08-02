import { headers } from "next/headers";
import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { ensureWidgetId } from "./actions";
import { WidgetForm } from "./WidgetForm";

// Concrete Widget surface — overrides the settings/[section] placeholder for the "widget"
// slug (a static segment wins over the dynamic one). Lets an owner embed the AI assistant
// on any EXTERNAL site they control, gated by an origin allowlist (SPEC §8.7).
export default async function WidgetSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { site } = await requireSite(orgSlug, siteSlug);
  const siteRef = { org: orgSlug, site: siteSlug };

  // A site created before this feature shipped has no widgetId yet — mint one now rather
  // than backfilling every row in the migration.
  const widgetId = site.widgetId ?? (await ensureWidgetId(siteRef)) ?? "";

  // Use the CURRENT request's own host verbatim — it's proven reachable (it's serving
  // this very page) with no redirect in front of it. Stripping to a guessed "bare apex"
  // (the settings/domain page's pattern, copied here originally) is wrong for this case:
  // if the bare domain 308-redirects elsewhere (e.g. a canonical apex→www redirect,
  // common Vercel domain config), that redirect response carries no CORS headers, so a
  // cross-origin `<script type="module">` load of the embed snippet fails outright before
  // ever reaching our route — a real prod bug, not a hypothetical.
  const h = await headers();
  const host = h.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const apiBase = `${scheme}://${host}`;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Widget</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Embed the assistant on any site</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Add a floating AI assistant to your own marketing site, app, or support portal —
        answering from this site&apos;s public documentation only.
      </p>

      <WidgetForm
        siteRef={siteRef}
        widgetId={widgetId}
        initialEnabled={site.widgetEnabled}
        initialOrigins={site.widgetAllowedOrigins}
        apiBase={apiBase}
      />
    </div>
  );
}
