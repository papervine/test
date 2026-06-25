import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSiteByCustomDomain } from "@/lib/tenant";
import { safeRedirect } from "@/lib/reader-auth";
import { ReaderJwtCallback } from "@/components/reader/ReaderJwtCallback";

// JWT handshake landing for a site reached via its vanity host (SPEC §11.2). The token
// rides in the URL hash; a client component reads it and posts it to the verify action.
// Static segment under /login, so it renders outside renderTenantDocs (not self-gated).
// Mirrors custom-domain/login.
export const dynamic = "force-dynamic";

async function host(): Promise<string | null> {
  const h = await headers();
  return h.get("x-papervine-host") ?? h.get("host");
}

export default async function CustomDomainJwtCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const record = await getSiteByCustomDomain((await host()) ?? "");
  if (!record) notFound();

  const redirectTo = safeRedirect((await searchParams).redirect, "/");
  if (!record.authEnabled || record.authMethod !== "jwt") redirect(redirectTo);

  return <ReaderJwtCallback slug={record.slug} redirectTo={redirectTo} />;
}
