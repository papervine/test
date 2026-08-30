import { requireOrg } from "@/lib/dashboard-context";
import { isPlatformAdminEmail } from "@/lib/platform-admin";
import { getBillingLookup } from "@/lib/billing/store";
import { trialStatus } from "@/lib/billing/core";
import { AppRail } from "@/components/app/AppRail";
import { SiteAssistantWidget } from "@/components/app/SiteAssistantWidget";
import { PlatformAdminBanner } from "@/components/app/PlatformAdminBanner";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Toaster } from "@/components/ui/sonner";
import { LogRocketInit } from "@/components/platform/LogRocketInit";

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
  const { session, org, role, sites, platformAdminView } =
    await requireOrg(orgSlug);
  // A plugin-minted impersonation session carries the operator's user id (SPEC §10.10);
  // it and the read-only bypass are the two cross-tenant states the banner surfaces.
  const impersonating = Boolean(session.session.impersonatedBy);

  // Live-trial flag for the rail's "Trialing" pills (SPEC §10 Billing): the AI items
  // (Workflows · Agent · Assistant) come from the 30-day trial, not the org's plan, so
  // the nav says so. getBillingLookup fails safe ('none'/'error' → no pills).
  const billing = await getBillingLookup(org.id);
  const trialing =
    billing.state === "ok" &&
    trialStatus(billing.sub, new Date()).state === "active";

  // "lite" atmosphere: the soft top glow carries the brand, but no grid/grain behind
  // the data-dense dashboard tables and forms.
  return (
    <PlatformShell variant="lite">
      {impersonating ? (
        <PlatformAdminBanner mode="impersonating" name={session.user.name} />
      ) : platformAdminView ? (
        <PlatformAdminBanner mode="view" name={org.name} />
      ) : null}
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
          trialing={trialing}
          platformAdmin={isPlatformAdminEmail(
            session.user.email,
            process.env.PLATFORM_ADMIN_EMAILS,
          )}
        />
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
        {/* Dashboard-wide action feedback (sonner) — the single mount for every app-host surface,
            the editor included. A second <Toaster/> inside a page renders every toast twice. */}
        <Toaster />
        {/* The owner's OWN assistant widget, for whichever site the rail considers active
            (SPEC §8.7) — the real embed script, not a preview, so enabling it on
            Settings → Widget puts the thing you just enabled in the corner to try. Mounted
            beside the Toaster for the same reason: one mount for every app-host surface,
            the editor included. Renders nothing until a site has the widget enabled. */}
        <SiteAssistantWidget sites={sites} />
        {/* Session replay, control plane ONLY — see LogRocketInit for why it is mounted here and
            not in the root layout (which also renders tenant docs). No-ops without
            NEXT_PUBLIC_LOGROCKET_APP_ID. */}
        <LogRocketInit
          appId={process.env.NEXT_PUBLIC_LOGROCKET_APP_ID}
          user={{
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            // Subscription status (trialing/active/past_due/canceled) is the dimension worth
            // segmenting replays by; getBillingLookup fails safe, so a lookup error is just null.
            plan: billing.state === "ok" ? (billing.sub?.status ?? "free") : null,
          }}
        />
      </div>
    </PlatformShell>
  );
}
