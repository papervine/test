import "server-only";
import { createSign } from "node:crypto";

// GitHub App auth (SPEC §3). The App is how a repo grants Papervine access without a
// pasted PAT: the owner installs it, GitHub delivers `push` webhooks for the install,
// and we mint a short-lived **installation token** to sync. That token plugs into the
// exact same `token` seam as the PAT — `ghHeaders(token?)` in src/lib/github.ts — so
// neither sync.ts nor the render path changes. This module owns only token minting.
//
// Self-host: register your own App and set the env vars below; without them the App
// features are simply off (the PAT path still works). See SPEC §3 / README.

const API = "https://api.github.com";

// The App's numeric id and its RSA private key (PEM). The key is multi-line; env stores
// it with literal "\n" escapes (single-line .env) OR real newlines — normalize both.
export function appConfig(): { appId: string; privateKey: string } | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) return null;
  return { appId, privateKey };
}

// True when the App is configured — gates the install UI / webhook installation events.
export function isGithubAppConfigured(): boolean {
  return appConfig() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// A signed App JWT (RS256), valid ~10 min. `iat` is backdated 60s to tolerate clock
// skew between us and GitHub (GitHub rejects a token whose iat is in their future).
// node:crypto signs RS256 directly, so the App needs no jsonwebtoken/jose dependency.
function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

// Installation tokens last ~1h; cache and reuse them rather than minting per sync (each
// mint is an authenticated round-trip + a fresh JWT). Refresh a few minutes early so an
// in-flight sync never races the expiry. Process-local — fine for our single-token need;
// a multi-instance deploy just mints a little more often.
const tokenCache = new Map<number, { token: string; expiresAt: number }>();
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Mint (or reuse) an installation access token for a GitHub App installation. Returns
 * undefined when the App isn't configured — callers then fall back to the PAT/public
 * path, so a missing App degrades gracefully instead of breaking sync.
 */
export async function getInstallationToken(
  installationId: number,
): Promise<string | undefined> {
  const cfg = appConfig();
  if (!cfg) return undefined;

  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  const jwt = appJwt(cfg.appId, cfg.privateKey);
  const res = await fetch(
    `${API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "user-agent": "papervine",
      },
    },
  );
  if (!res.ok) {
    // A revoked/suspended install (404/403) shouldn't throw here — sync will surface a
    // clean "couldn't read repo" error via the normal path, recorded on the deployment.
    // Log the GitHub response body so the *reason* (suspended, not found, key mismatch)
    // is visible in runtime logs rather than just a bare status.
    const detail = await res.text().catch(() => "");
    console.error(
      `[github-app] installation token mint failed id=${installationId} status=${res.status} ${detail.slice(0, 300)}`,
    );
    return undefined;
  }
  const data = (await res.json()) as { token: string; expires_at: string };
  tokenCache.set(installationId, {
    token: data.token,
    expiresAt: Date.parse(data.expires_at),
  });
  return data.token;
}

// Look up an installation's account (the user/org login it's installed on) via an App
// JWT. Used by the setup callback to label the stored installation. null when the App
// isn't configured or the installation isn't readable (revoked/wrong id).
export async function fetchInstallation(
  installationId: number,
): Promise<{ accountLogin: string } | null> {
  const cfg = appConfig();
  if (!cfg) return null;
  const jwt = appJwt(cfg.appId, cfg.privateKey);
  const res = await fetch(`${API}/app/installations/${installationId}`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "user-agent": "papervine",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { account?: { login?: string } };
  return { accountLogin: data.account?.login ?? "" };
}

export type InstallRepo = { owner: string; name: string; fullName: string };

// The repos an installation can access (Git settings' Repository dropdown + the
// "Installed organizations" tag list). Uses the installation token — the App only ever
// sees repos the owner granted it, which is exactly the set we want to offer. Paginates
// to a cap; returns [] on any failure (no token / suspended install) so the caller shows
// the stored repo rather than an error.
export async function listInstallationRepos(
  installationId: number,
): Promise<InstallRepo[]> {
  const token = await getInstallationToken(installationId);
  if (!token) return [];
  const repos: InstallRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `${API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "papervine",
        },
      },
    );
    if (!res.ok) break;
    const data = (await res.json()) as {
      repositories?: Array<{ name: string; full_name: string; owner: { login: string } }>;
    };
    const batch = data.repositories ?? [];
    repos.push(
      ...batch.map((r) => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
      })),
    );
    if (batch.length < 100) break;
  }
  return repos;
}

// The page we send owners to to install the App (the connect UI's "Install" button).
// `state` round-trips through GitHub back to our callback — see encodeGithubFlowState.
export function installUrl(state: string): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return null;
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}
