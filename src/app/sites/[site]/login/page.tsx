import { isDevLike } from "@/lib/env";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSiteBySlug, resolveTenantSlug } from "@/lib/tenant";
import {
  safeRedirect,
  customerLoginUrl,
  type ReaderAuthConfig,
} from "@/lib/reader-auth";
import { ReaderLoginCard } from "@/components/reader/ReaderLoginCard";
import { DevReaderSignIn } from "@/components/reader/DevReaderSignIn";

// Reader sign-in for a gated site in subdomain mode ({slug}.host/login, rewritten here)
// and apex path mode (/sites/{slug}/login). A static segment, so it wins over the docs
// [[...path]] catch-all and renders OUTSIDE renderTenantDocs — i.e. it isn't itself gated.
export const dynamic = "force-dynamic";

export default async function ReaderLoginPage({
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

  // Auth off → nothing to sign into; send them on.
  if (!record.authEnabled) redirect(redirectTo);

  // JWT method: there's no Papervine sign-in form — bounce the reader to the customer's own
  // login flow (SPEC §11.2). Their backend signs a token and redirects to /login/jwt-callback.
  // In DEV, offer a dev sign-in (pick groups, no IdP) so a gated site is verifiable locally —
  // it forges a session and is hard-gated to non-production (here AND in the server action).
  const config = (record.authConfig as ReaderAuthConfig | null) ?? {};
  if (record.authMethod === "jwt") {
    if (isDevLike()) {
      return <DevReaderSignIn siteName={record.name} slug={slug} redirectTo={redirectTo} />;
    }
    if (config.loginUrl) redirect(customerLoginUrl(config.loginUrl, redirectTo));
  }

  return (
    <ReaderLoginCard
      siteName={record.name}
      slug={slug}
      redirectTo={redirectTo}
      method={record.authMethod}
    />
  );
}
