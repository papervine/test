import { requireOrg } from "@/lib/dashboard-context";
import { isPlatformAdminEmail } from "@/lib/platform-admin";
import { SettingsNav } from "@/components/app/SettingsNav";

// Adds the Settings subnav as a second sidebar inside the (app) shell. The outer
// layout already supplies the AppRail + session gate; this just splits the content
// pane into [subnav | surface].
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session } = await requireOrg(orgSlug);
  const platformAdmin = isPlatformAdminEmail(session.user.email, process.env.PLATFORM_ADMIN_EMAILS);

  // Column on mobile (SettingsNav is a horizontal pill strip above the surface), row on
  // desktop (SettingsNav is a second sidebar beside it). min-w-0 lets wide settings content
  // shrink instead of overflowing.
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SettingsNav platformAdmin={platformAdmin} />
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
