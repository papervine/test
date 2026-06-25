import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import { safeRedirect } from "@/lib/reader-auth";
import { ReaderJwtCallback } from "@/components/reader/ReaderJwtCallback";

// JWT handshake landing (SPEC §11.2). The customer's backend redirects here with the signed
// token in the URL hash; a client component reads it and posts it to the verify action. A
// static segment under /login, so it renders OUTSIDE renderTenantDocs — i.e. it isn't gated
// (no redirect loop). Mirrors sites/[site]/login for both serving modes.
export const dynamic = "force-dynamic";

export default async function JwtCallbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { site: slug } = await params;
  const record = await getSiteBySlug(slug);
  if (!record) notFound();

  // A subdomain host must only address its own slug (same cross-tenant guard as the docs).
  const hostSlug = resolveTenantSlug((await headers()).get("host"));
  if (hostSlug && hostSlug !== slug) notFound();

  const base = hostSlug ? "" : `/sites/${slug}`;
  const redirectTo = safeRedirect((await searchParams).redirect, `${base}/`);

  // Auth off, or not the JWT method → nothing to complete; send them on.
  if (!record.authEnabled || record.authMethod !== "jwt") redirect(redirectTo);

  return <ReaderJwtCallback slug={slug} redirectTo={redirectTo} />;
}
