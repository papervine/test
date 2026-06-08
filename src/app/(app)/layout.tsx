import { redirect } from "next/navigation";
import { getSession, listOrganizations } from "@/lib/session";
import { AppRail } from "@/components/app/AppRail";

// Control-plane shell (SPEC §9). Gates every /dashboard, /settings… route on a
// session — the middleware does the cheap cookie check; this is the real one.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0] ?? null;
  if (!activeOrg) redirect("/onboarding");

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <AppRail orgName={activeOrg.name} userName={session.user.name} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
