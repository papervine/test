import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSiteByCustomDomain } from "@/lib/tenant";
import { safeRedirect } from "@/lib/reader-auth";
import { ReaderLoginCard } from "@/components/reader/ReaderLoginCard";

// Reader sign-in for a gated site reached via its vanity host (docs.acme.com/login,
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

  return (
    <ReaderLoginCard
      siteName={record.name}
      slug={record.slug}
      redirectTo={redirectTo}
      method={record.authMethod}
    />
  );
}
