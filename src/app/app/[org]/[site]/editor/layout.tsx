import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/dashboard-context";
import { canSeeFeature } from "@/lib/features";

// Real access control for the editor (SPEC §9.2/§10) — the AppRail hides the link, but
// that's cosmetic; this 404s the URL for anyone who can't see the feature. Flip
// "editor.workspace" to "everyone" in src/lib/features.ts to launch.
export default async function EditorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { role } = await requireOrg(orgSlug);
  if (!canSeeFeature("editor.workspace", role)) notFound();
  return <>{children}</>;
}
