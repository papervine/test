import { headers } from "next/headers";
import { Plug } from "lucide-react";
import { supportsSubdomainTenants } from "@/lib/tenant-host";
import { requireSite } from "@/lib/dashboard-context";

// The per-site MCP server surface (SPEC §8.5). The /mcp endpoint already exists and is
// tenant-routed; this dashboard page just tells the owner its URL and how to connect a
// client (Claude, Cursor, …) to it.
export default async function McpPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { site } = await requireSite(orgSlug, siteSlug);

  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const apexBase = host.replace(/^(app|www)\./, "");
  const subdomains = supportsSubdomainTenants(apexBase);

  // The docs host (custom domain wins; else subdomain, else the apex path form), then
  // its /mcp endpoint — the same host resolution the dashboard home uses for live URLs.
  const docsHost =
    site.customDomain ??
    (subdomains ? `${site.slug}.${apexBase}` : `${apexBase}/sites/${site.slug}`);
  const mcpUrl = site.customDomain
    ? `https://${site.customDomain}/mcp`
    : `${proto}://${docsHost}/mcp`;

  return (
    <div className="px-8 py-6">
      <div className="flex items-center gap-2.5">
        <Plug className="h-5 w-5 text-[var(--blue)]" />
        <h1 className="text-xl font-semibold">MCP server</h1>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Your docs are exposed as a Model Context Protocol server, so AI clients like
        Claude and Cursor can search and read them live — the same tools as the in-app
        assistant, over a second transport.
      </p>

      <div className="mt-8 max-w-2xl space-y-6">
        <div>
          <div className="text-sm font-medium">Server URL</div>
          <pre className="db-feature mt-2 overflow-x-auto rounded-lg px-4 py-3 text-sm text-[var(--fg)]">
            <code>{mcpUrl}</code>
          </pre>
        </div>

        <div>
          <div className="text-sm font-medium">Connect a client</div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add it to your client&apos;s MCP config (e.g. Claude Desktop):
          </p>
          <pre className="db-feature mt-2 overflow-x-auto rounded-lg px-4 py-3 text-xs leading-relaxed text-[var(--fg)]">
            <code>{JSON.stringify(
              {
                mcpServers: {
                  [site.slug]: { url: mcpUrl },
                },
              },
              null,
              2,
            )}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
