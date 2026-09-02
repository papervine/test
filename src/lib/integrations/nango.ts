import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { integrationConnection } from "../db/app-schema";
import { findConnector, connectorByProviderConfigKey } from "./catalog";

/**
 * The Nango seam (SPEC §10.2). Nango is the **keychain**: it holds each org's OAuth
 * grant for a connected service, refreshes it, and proxies calls made with it. It never
 * runs our logic — that's the executor's job — and we never store the token.
 *
 * Configuration is optional in exactly the way every other integration here is: with no
 * NANGO_SECRET_KEY the catalog renders as "not configured" and nothing throws. Env is
 * read per call rather than at module load so a long-lived dev server sees a change
 * without a restart (the collab-secret lesson).
 *
 * Escape hatch (§18): `NANGO_HOST` points the SDK at a self-hosted Nango. Supported from
 * day one so the cloud→self-host move is a config change, not a migration.
 */

export function nangoConfigured(): boolean {
  return !!process.env.NANGO_SECRET_KEY?.trim();
}

/**
 * What actually went wrong, out of an axios-shaped Nango error.
 *
 * `err.message` alone is "Request failed with status code 400" — true, useless, and it
 * cost a real debugging session: the operator saw that while the actual complaint,
 * "Integration does not exist", sat in the response body naming the exact field. Nango
 * reports structured validation errors, so dig them out and say which one.
 *
 * Exported and pure so the shapes are unit-tested rather than discovered in production.
 */
export function nangoErrorMessage(err: unknown, context?: { providerConfigKey?: string }): string {
  const response = (err as { response?: { data?: unknown; status?: number } } | null)?.response;
  const data = response?.data as
    | { error?: { code?: string; message?: string; errors?: { message?: string; path?: unknown[] }[] } }
    | undefined;
  const error = data?.error;
  const detail = error?.errors?.find((e) => e?.message)?.message ?? error?.message;

  // The overwhelmingly common setup mistake, and one nobody can act on from the raw text:
  // the integration has to be created in the Nango dashboard, under this exact key.
  if (detail && /integration does not exist/i.test(detail) && context?.providerConfigKey) {
    return (
      `Nango has no integration with the key "${context.providerConfigKey}". Create it in ` +
      `the Nango dashboard (with your own OAuth client) using exactly that unique key.`
    );
  }
  if (detail) return error?.code ? `${detail} (${error.code})` : detail;
  if (err instanceof Error && err.message) return err.message;
  return "Nango request failed.";
}

async function nangoClient() {
  const secretKey = process.env.NANGO_SECRET_KEY?.trim();
  if (!secretKey) return null;
  // Imported lazily so merely rendering a page that checks configuration never pays for
  // (or crashes on) the SDK in a deployment without it.
  const { Nango } = await import("@nangohq/node");
  const host = process.env.NANGO_HOST?.trim();
  return new Nango({ secretKey, ...(host ? { host } : {}) });
}

export type ConnectionRow = typeof integrationConnection.$inferSelect;

/**
 * Mint a short-lived session token for the browser's Connect UI.
 *
 * `end_user.organization_id` is the whole reconciliation story: Nango echoes it back on
 * the creation webhook, which is how a connection created in a popup becomes a row owned
 * by the right tenant. `allowed_integrations` is the second half of the allowlist (the
 * first being our own catalog check before we get here) — even a tampered client can
 * only authorize the provider we named.
 */
export async function createConnectSession(input: {
  provider: string;
  organizationId: string;
  userId: string;
  userEmail?: string | null;
}): Promise<{ token: string } | { error: string }> {
  const connector = findConnector(input.provider);
  if (!connector) return { error: "Unknown connector." };
  const nango = await nangoClient();
  if (!nango) return { error: "Integrations aren't configured for this deployment." };

  try {
    const res = await nango.createConnectSession({
      end_user: {
        id: input.userId,
        ...(input.userEmail ? { email: input.userEmail } : {}),
      },
      organization: { id: input.organizationId },
      allowed_integrations: [connector.providerConfigKey],
    });
    const token = res?.data?.token;
    return token ? { token } : { error: "Nango returned no session token." };
  } catch (err) {
    return { error: nangoErrorMessage(err, { providerConfigKey: connector.providerConfigKey }) };
  }
}

/**
 * Record a connection Nango has told us about. Upsert on (org, provider): re-connecting
 * re-authorizes in place rather than accumulating rows, and a redelivered webhook writes
 * the same row twice — which is what lets the webhook route be safely non-replay-guarded
 * (see nango-webhook.ts).
 */
export async function recordConnection(input: {
  organizationId: string;
  providerConfigKey: string;
  nangoConnectionId: string;
  connectedByUserId?: string | null;
}): Promise<void> {
  const connector = connectorByProviderConfigKey(input.providerConfigKey);
  if (!connector) return; // not a connector we offer — nothing to attribute it to

  const [existing] = await db
    .select()
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.organizationId, input.organizationId),
        eq(integrationConnection.provider, connector.id),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(integrationConnection)
      .set({
        nangoConnectionId: input.nangoConnectionId,
        status: "active",
        connectedByUserId: input.connectedByUserId ?? existing.connectedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnection.id, existing.id));
    return;
  }
  await db.insert(integrationConnection).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    provider: connector.id,
    nangoConnectionId: input.nangoConnectionId,
    connectedByUserId: input.connectedByUserId ?? null,
  });
}

/** A connection Nango says is gone. Deleted rather than flagged: the row's only purpose
 * is to say "this org can call this provider", which is no longer true. */
export async function forgetConnectionByNangoId(nangoConnectionId: string): Promise<void> {
  await db
    .delete(integrationConnection)
    .where(eq(integrationConnection.nangoConnectionId, nangoConnectionId));
}

export async function listConnections(organizationId: string): Promise<ConnectionRow[]> {
  return db
    .select()
    .from(integrationConnection)
    .where(eq(integrationConnection.organizationId, organizationId));
}

export async function getConnection(
  organizationId: string,
  provider: string,
): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.organizationId, organizationId),
        eq(integrationConnection.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Disconnect: delete Nango's connection (revoking the grant at the source), then drop
 * our row. Nango first, deliberately — if the remote delete fails we keep the row and
 * report it, rather than leaving an orphaned live grant we've forgotten we hold.
 */
export async function disconnectConnection(
  organizationId: string,
  provider: string,
): Promise<{ ok: true } | { error: string }> {
  const row = await getConnection(organizationId, provider);
  if (!row) return { ok: true };
  const connector = findConnector(provider);
  const nango = await nangoClient();

  if (nango && connector) {
    try {
      await nango.deleteConnection(connector.providerConfigKey, row.nangoConnectionId);
    } catch (err) {
      // Already gone on their side is success, not failure: converge, don't bookkeep.
      // Match on the raw message too — a 404 may arrive as the bare axios text with no
      // structured body to read.
      const raw = err instanceof Error ? err.message : String(err);
      const message = nangoErrorMessage(err, { providerConfigKey: connector.providerConfigKey });
      if (!/not.?found|404/i.test(`${raw} ${message}`)) return { error: message };
    }
  }
  await db.delete(integrationConnection).where(eq(integrationConnection.id, row.id));
  return { ok: true };
}

/**
 * Make a provider API call as the org's connected account.
 *
 * The token never reaches us: Nango injects it, refreshes it when due, and applies the
 * provider's rate limits. That's the §10.2 live-access rule in one function — no indexing,
 * no durable copy, and a disconnect takes effect immediately because there's nothing
 * cached here to keep working.
 */
export async function proxy<T = unknown>(input: {
  organizationId: string;
  provider: string;
  method?: "GET" | "POST";
  endpoint: string;
  params?: Record<string, string | number | boolean>;
}): Promise<{ data: T } | { error: string }> {
  const connector = findConnector(input.provider);
  if (!connector) return { error: "Unknown connector." };
  const connection = await getConnection(input.organizationId, input.provider);
  if (!connection) return { error: `${input.provider} isn't connected.` };
  const nango = await nangoClient();
  if (!nango) return { error: "Integrations aren't configured for this deployment." };

  try {
    // Nango's params type takes strings and numbers only, while provider flags read far
    // better as booleans at the call site (`supportsAllDrives: true`). Normalize here so
    // every connector doesn't hand-stringify — a query string is text either way.
    const params = input.params
      ? Object.fromEntries(
          Object.entries(input.params).map(([k, v]) => [
            k,
            typeof v === "boolean" ? String(v) : v,
          ]),
        )
      : undefined;
    const res = await nango.proxy({
      method: input.method ?? "GET",
      endpoint: input.endpoint,
      providerConfigKey: connector.providerConfigKey,
      connectionId: connection.nangoConnectionId,
      ...(params ? { params } : {}),
    });
    return { data: res.data as T };
  } catch (err) {
    return { error: nangoErrorMessage(err, { providerConfigKey: connector.providerConfigKey }) };
  }
}
