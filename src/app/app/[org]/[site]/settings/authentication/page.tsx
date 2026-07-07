import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { decryptSecret } from "@/lib/crypto";
import { isAuthMethod, type AuthMethod, type ReaderAuthConfig } from "@/lib/reader-auth";
import { AuthenticationForm } from "./AuthenticationForm";

// Concrete Authentication surface — overrides the settings/[section] placeholder for the
// "authentication" slug. Configures Layer 2 reader-auth (SPEC §11.2): gate the published
// docs behind the customer's own login. The secret (the JWT method's Ed25519 private key /
// OAuth client secret / shared password) is decrypted here (server-only) and handed to the
// form so the site's own owner can read it back, the way hosted docs platforms reveals its key.
export default async function AuthenticationSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { site } = await requireSite(orgSlug, siteSlug);

  const method: AuthMethod = isAuthMethod(site.authMethod) ? site.authMethod : "jwt";

  // The stored secret is the org owner's own JWT signing secret / OAuth client secret /
  // shared password — safe to reveal on this org-scoped page. Best-effort: if the key is
  // unset (local without PAPERVINE_ENCRYPTION_KEY) we just show it blank rather than 500.
  let secret = "";
  if (site.authSecretEnc) {
    try {
      secret = decryptSecret(site.authSecretEnc);
    } catch {
      secret = "";
    }
  }
  // `authSecretEnc` is one column shared across methods, and a method switch preserves it (so the
  // JWT keypair survives toggling — see setAuthMethod). So a non-JWT method can find a leftover JWT
  // private key here; don't surface it as that method's "secret" (an EdDSA PEM isn't a password /
  // client secret). The field shows empty until the owner saves the method's own value.
  if (method !== "jwt" && secret.startsWith("-----BEGIN")) secret = "";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Authentication</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Setup authentication</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Require readers to authenticate before accessing your documentation.
      </p>

      <AuthenticationForm
        siteRef={{ org: orgSlug, site: siteSlug }}
        enabled={site.authEnabled}
        method={method}
        config={(site.authConfig as ReaderAuthConfig | null) ?? {}}
        secret={secret}
      />
    </div>
  );
}
