import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { AdminNav } from "@/components/app/AdminNav";

// Operator console shell (SPEC §10.10). The gate lives HERE rather than being repeated on every
// page: `requirePlatformAdmin` 404s anyone not on the PLATFORM_ADMIN_EMAILS allowlist, and a
// layout gate can't be forgotten when a new section is added. Pages still call it when they need
// the session (impersonation compares against the current user id).
//
// Outside the [org] layout on purpose: the console is cross-org, so the org-scoped rail and site
// switcher don't apply — this nav replaces them.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();

  return (
    <PlatformShell variant="lite">
      {/* Column on mobile (AdminNav is a pill strip above the content), row on desktop (it's a
          sidebar beside it). min-w-0 lets the wide tables scroll inside the column instead of
          forcing the page wider than the viewport. */}
      <div className="flex min-h-screen flex-col lg:flex-row">
        <AdminNav />
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      </div>
    </PlatformShell>
  );
}
