import { headers } from "next/headers";
import { Plug } from "lucide-react";
import { CopyButton } from "@/components/platform/CopyButton";
import { supportsSubdomainTenants, tenantHostFor } from "@/lib/tenant-host";
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
  const tenantHost = tenantHostFor(site.slug, host);
  const subdomains = supportsSubdomainTenants(tenantHost.replace(/^[^.]+\./, ""));

  // The docs host (custom domain wins; else the configured tenant subdomain, else the apex
  // path form), then its /mcp endpoint — the same resolution the dashboard home uses. This
  // URL gets pasted into people's MCP client config, so it must be the canonical tenant
  // host, never the legacy one derived from whatever host served the dashboard.
  const docsHost =
    site.customDomain ??
    (subdomains ? tenantHost : `${apexBase}/sites/${site.slug}`);
  const mcpUrl = site.customDomain
    ? `https://${site.customDomain}/mcp`
    : `${proto}://${docsHost}/mcp`;

  // Named because it's used twice now — rendered in the block and handed to the copy button.
  // Copying the on-screen text verbatim is the point: what someone pastes into their client has
  // to be what they were shown, indentation included.
  const clientConfig = JSON.stringify({ mcpServers: { [site.slug]: { url: mcpUrl } } }, null, 2);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
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
          {/* `pr-12` keeps a long URL from sliding under the button as it scrolls; the button sits
              outside the scrolling <pre> so it stays put while the text moves. */}
          <div className="relative mt-2">
            <pre className="db-feature overflow-x-auto rounded-lg py-3 pl-4 pr-12 text-sm text-[var(--fg)]">
              <code>{mcpUrl}</code>
            </pre>
            <div className="absolute right-1.5 top-1.5">
              <CopyButton value={mcpUrl} label="server URL" />
            </div>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Connect a client</div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add it to your client&apos;s MCP config (e.g. Claude Desktop):
          </p>
          <div className="relative mt-2">
            <pre className="db-feature overflow-x-auto rounded-lg py-3 pl-4 pr-12 text-xs leading-relaxed text-[var(--fg)]">
              <code>{clientConfig}</code>
            </pre>
            <div className="absolute right-1.5 top-1.5">
              <CopyButton value={clientConfig} label="client config" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
