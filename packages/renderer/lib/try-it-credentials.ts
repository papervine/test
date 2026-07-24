/**
 * Credential persistence for the "Try it" playground.
 *
 * Each endpoint page mounts its own `ApiTryItModal`, so credentials held in component state die
 * on every navigation — a reader with a Basic-auth spec retypes username + password for every
 * single operation. These helpers remember them for the tab instead.
 *
 * `sessionStorage` is the deliberate choice over `localStorage`: it survives navigation between
 * endpoints (the actual pain) but is scoped to the tab and cleared when that tab closes, so a
 * shared machine doesn't keep API credentials around the way a `localStorage` entry would. Note
 * it is *not* a memory-only store — browsers back session storage on disk for crash/tab restore —
 * so this bounds the lifetime, it doesn't make the credential unrecoverable.
 *
 * It is also not an isolation boundary: any script on the origin can read every key here, so the
 * per-spec keying below is about not prefilling the wrong site's credentials, not about defending
 * one site's credentials from another's page code.
 *
 * The store is keyed by **spec path**, not origin: in apex path mode (`/sites/{slug}`) every
 * tenant shares an origin, and a scheme named `BasicAuth` on one site must not prefill another's.
 *
 * Pure by design (the store is injected) so it unit-tests without a browser — see
 * `tests/unit/try-it-credentials.test.ts`.
 */

/** The scheme shape the playground renders inputs for (mirrors `AuthScheme` in `lib/openapi.ts`,
 *  declared here so client components can import it without pulling in a `server-only` module). */
export type TryItAuth = {
  key: string;
  type: "basic" | "bearer" | "apiKey" | "oauth2" | "other";
  in?: "header" | "query" | "cookie";
  name?: string;
  description?: string;
};

/** The slice of `Storage` we need — injected so the logic stays pure and testable. */
export type CredentialStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The field keys a scheme's inputs read and write. Single source of truth for the inputs, the
 *  request builder, and what gets persisted — they must not drift. */
export function authFieldKeys(auth: TryItAuth): string[] {
  if (auth.type === "basic") return [`${auth.key}.username`, `${auth.key}.password`];
  if (auth.type === "apiKey") return [`${auth.key}.value`];
  return [`${auth.key}.token`]; // bearer / oauth2 / other
}

export function storageKey(specPath: string): string {
  return `papervine:try-it-auth:${specPath}`;
}

/** `sessionStorage`, or null when it's unavailable (SSR, or a browser with storage disabled —
 *  Safari private mode throws on access, not just on write). */
export function sessionCredentialStore(): CredentialStore | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Stored credentials for these schemes. Only keys the schemes actually declare are returned, so
 * a stale entry from an earlier version of the spec can't inject fields the playground would then
 * fold into a request.
 */
export function readCredentials(
  store: CredentialStore | null,
  specPath: string,
  schemes: TryItAuth[],
): Record<string, string> {
  if (!store || schemes.length === 0) return {};
  let parsed: unknown;
  try {
    const raw = store.getItem(storageKey(specPath));
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {}; // unreadable storage or corrupt entry — start clean rather than throw
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of schemes.flatMap(authFieldKeys)) {
    const v = record[key];
    if (typeof v === "string" && v !== "") out[key] = v;
  }
  return out;
}

/**
 * Persist the credential fields these schemes declare. Empty values are dropped, and an entry
 * with nothing left in it is removed outright — clearing the fields clears the store, so there's
 * no way to be left with a credential you thought you deleted.
 */
export function writeCredentials(
  store: CredentialStore | null,
  specPath: string,
  schemes: TryItAuth[],
  values: Record<string, string>,
): void {
  if (!store) return;
  const out: Record<string, string> = {};
  for (const key of schemes.flatMap(authFieldKeys)) {
    const v = values[key];
    if (typeof v === "string" && v !== "") out[key] = v;
  }
  try {
    if (Object.keys(out).length === 0) store.removeItem(storageKey(specPath));
    else store.setItem(storageKey(specPath), JSON.stringify(out));
  } catch {
    /* quota or disabled storage — remembering is a convenience, never a hard failure */
  }
}

export function clearCredentials(store: CredentialStore | null, specPath: string): void {
  if (!store) return;
  try {
    store.removeItem(storageKey(specPath));
  } catch {
    /* ignore */
  }
}
