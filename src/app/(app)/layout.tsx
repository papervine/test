import { redirect } from "next/navigation";
import { getSession, listOrganizations } from "@/lib/session";
import { AppRail } from "@/components/app/AppRail";
import { PlatformShell } from "@/components/platform/PlatformShell";

// Control-plane shell (SPEC §9). Gates every /dashboard, /settings… route on a
// session — the middleware does the cheap cookie check; this is the real one.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0] ?? null;
  if (!activeOrg) redirect("/onboarding");

  // "lite" atmosphere: the soft top glow carries the brand, but no grid/grain behind
  // the data-dense dashboard tables and forms.
  return (
    <PlatformShell variant="lite">
      <div className="flex min-h-screen">
        <AppRail orgName={activeOrg.name} userName={session.user.name} />
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </PlatformShell>
  );
}
