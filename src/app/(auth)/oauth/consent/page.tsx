import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { oauthApplication } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { ConsentForm } from "./ConsentForm";

/**
 * OAuth consent for the authoring MCP (SPEC §9.2/§11) — the screen where someone approves an
 * AI client's request to read and edit their docs.
 *
 * **Why this page has to exist.** Better Auth's `mcp` plugin only routes to a consent page when
 * the client asks for one (`prompt=consent`); otherwise a signed-in user's authorize request
 * returns a code immediately. Combined with dynamic client registration — anyone may register a
 * client, with any redirect URI — that is a silent token grant: a page that redirects a
 * signed-in user to an authorize URL receives a **write-scoped** token for their docs, and the
 * user never sees a thing. So `/api/auth/mcp/authorize` forces `prompt=consent` (see its route)
 * and every grant lands here first.
 *
 * Kept on the app host at its bare URL: it needs the session cookie, which is host-only there.
 */
export const dynamic = "force-dynamic";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ consent_code?: string; client_id?: string; scope?: string }>;
}) {
  const { consent_code: consentCode, client_id: clientId, scope } = await searchParams;

  // No session → nothing to consent with. The authorize endpoint sends people through /login
  // first, so this is only reachable by someone arriving at the URL directly.
  const session = await getSession();
  if (!session) return <ConsentForm state="signed-out" />;
  if (!consentCode) return <ConsentForm state="invalid" />;

  // The registered client's own name. It's attacker-controlled (dynamic registration lets a
  // client call itself anything), so the form renders it as plain text and says where it came
  // from — a name is a hint about who is asking, never a guarantee.
  const [client] = clientId
    ? await db
        .select({ name: oauthApplication.name })
        .from(oauthApplication)
        .where(eq(oauthApplication.clientId, clientId))
        .limit(1)
    : [];

  if (clientId && !client) return <ConsentForm state="invalid" />;

  return (
    <ConsentForm
      state="ready"
      consentCode={consentCode}
      clientName={client?.name ?? "An unnamed application"}
      scopes={(scope ?? "").split(" ").filter(Boolean)}
      account={session.user.email}
    />
  );
}
