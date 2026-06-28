import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSiteByCustomDomain } from "@/lib/tenant";
import {
  safeRedirect,
  customerLoginUrl,
  type ReaderAuthConfig,
} from "@/lib/reader-auth";
import { ReaderLoginCard } from "@/components/reader/ReaderLoginCard";
import { DevReaderSignIn } from "@/components/reader/DevReaderSignIn";

// Reader sign-in for a gated site reached via its vanity host (docs.example.com/login,
// rewritten here by middleware). Static segment, so it wins over the custom-domain
// [[...path]] catch-all and renders outside renderTenantDocs (not self-gated). Root
// hosting only for now — subpath mode ({domain}/docs) login is a follow-up.
export const dynamic = "force-dynamic";

async function host(): Promise<string | null> {
  const h = await headers();
  return h.get("x-papervine-host") ?? h.get("host");
}

export default async function CustomDomainLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const record = await getSiteByCustomDomain((await host()) ?? "");
  if (!record) notFound();

  const redirectTo = safeRedirect((await searchParams).redirect, "/");
  if (!record.authEnabled) redirect(redirectTo);

  // JWT method: bounce to the customer's own login flow (SPEC §11.2); no Papervine form. In
  // DEV, offer the dev sign-in (pick groups, no IdP) — hard-gated to non-production.
  const config = (record.authConfig as ReaderAuthConfig | null) ?? {};
  if (record.authMethod === "jwt") {
    if (process.env.NODE_ENV !== "production") {
      return <DevReaderSignIn siteName={record.name} slug={record.slug} redirectTo={redirectTo} />;
    }
    if (config.loginUrl) redirect(customerLoginUrl(config.loginUrl, redirectTo));
  }

  return (
    <ReaderLoginCard
      siteName={record.name}
      slug={record.slug}
      redirectTo={redirectTo}
      method={record.authMethod}
    />
  );
}
