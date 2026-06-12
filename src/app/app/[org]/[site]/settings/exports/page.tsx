import { headers } from "next/headers";
import { ChevronRight, FileDown } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";

// Concrete Exports surface — overrides the settings/[section] placeholder for the
// "exports" slug. The incumbent's Settings → Exports: download the whole site as one PDF for
// offline viewing (SPEC §10.4). The button opens the print-ready export view on the docs
// host; the browser's "Save as PDF" produces the file (no server-side PDF pipeline).
export default async function ExportsSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { site } = await requireSite(orgSlug, siteSlug);

  // Always link the apex path-mode URL: one route (/sites/{slug}/export) serves the export
  // on every deploy, so the link never depends on wildcard-DNS or custom-domain routing.
  // Same host derivation the dashboard home / MCP surface use for live URLs.
  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const apexBase = host.replace(/^(app|www)\./, "");
  const exportUrl = `${proto}://${apexBase}/sites/${site.slug}/export`;

  // Nothing to export until the repo's content has been synced into object storage
  // (status flips off "draft" on first sync).
  const synced = site.status !== "draft";

  return (
    <div className="px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Exports</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Exports</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Export your content as a single PDF file for offline viewing.
      </p>

      <div className="mt-8 max-w-2xl">
        {synced ? (
          <a
            href={exportUrl}
            target="_blank"
            rel="noreferrer"
            className="db-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            <FileDown className="h-4 w-4" />
            Export all content
          </a>
        ) : (
          <>
            <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-[var(--muted)] opacity-60">
              <FileDown className="h-4 w-4" />
              Export all content
            </span>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Connect and sync a repo first — there’s nothing to export yet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
