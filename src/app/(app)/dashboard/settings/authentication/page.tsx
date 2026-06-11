import { ChevronRight } from "lucide-react";
import { requireActiveSite } from "@/lib/require-active-site";
import { decryptSecret } from "@/lib/crypto";
import { isAuthMethod, type AuthMethod, type ReaderAuthConfig } from "@/lib/reader-auth";
import { AuthenticationForm } from "./AuthenticationForm";

// Concrete Authentication surface — overrides the settings/[section] placeholder for the
// "authentication" slug. Configures Layer 2 reader-auth (SPEC §11.2): gate the published
// docs behind the customer's own login. The secret is decrypted here (server-only) and
// handed to the form so the site's own owner can read it back, the way the incumbent reveals
// its signing secret. Enforcement (the middleware handshake) is the v2 follow-up.
export default async function AuthenticationSettingsPage() {
  const site = await requireActiveSite();

  // The stored secret is the org owner's own JWT signing secret / OAuth client secret /
  // shared password — safe to reveal on this org-scoped page. Best-effort: if the key is
  // unset (local without PAPERVINE_ENCRYPTION_KEY) we just show it blank rather than 500.
  let secret = "";
  if (site?.authSecretEnc) {
    try {
      secret = decryptSecret(site.authSecretEnc);
    } catch {
      secret = "";
    }
  }

  const method: AuthMethod = isAuthMethod(site?.authMethod) ? site.authMethod : "jwt";

  return (
    <div className="px-8 py-6">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Authentication</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Setup authentication</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Require readers to authenticate before accessing your documentation.
      </p>

      {!site ? (
        <p className="mt-8 text-sm text-[var(--muted)]">
          Connect a site first to set up authentication.
        </p>
      ) : (
        <AuthenticationForm
          enabled={site.authEnabled}
          method={method}
          config={(site.authConfig as ReaderAuthConfig | null) ?? {}}
          secret={secret}
        />
      )}
    </div>
  );
}
