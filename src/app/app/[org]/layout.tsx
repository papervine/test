import { requireOrg } from "@/lib/dashboard-context";
import { AppRail } from "@/components/app/AppRail";
import { PlatformShell } from "@/components/platform/PlatformShell";

// Control-plane shell (SPEC §9/§10). Wraps every URL-scoped dashboard route
// (/:org/:site/…) — resolves + authorizes the org in the path (redirects signed-out
// users to /login, 404s non-members), then renders the AppRail. The rail derives the
// active site from the URL itself, so this layout doesn't need the [site] param.
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org, role, sites } = await requireOrg(orgSlug);

  // "lite" atmosphere: the soft top glow carries the brand, but no grid/grain behind
  // the data-dense dashboard tables and forms.
  return (
    <PlatformShell variant="lite">
      {/* Column on mobile (AppRail renders a sticky top bar above the content), row on
          desktop (AppRail renders a fixed sidebar beside it). min-w-0 lets wide content
          — analytics tables, code blocks — scroll inside the column instead of forcing
          the whole page wider than the viewport. */}
      <div className="flex min-h-screen flex-col lg:flex-row">
        <AppRail
          orgSlug={org.slug}
          sites={sites}
          userName={session.user.name}
          role={role}
        />
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      </div>
    </PlatformShell>
  );
}
