import "server-only";
import { encryptSecret, decryptSecret } from "./crypto";

/**
 * GitHub App **user-to-server** auth (SPEC §10.11) — the App acting *as the signed-in
 * person* rather than as an installation.
 *
 * Why this exists at all: creating a repository on a personal account is
 * `POST /user/repos`, which GitHub documents as **Administration: write, UAT only** — a
 * user access token works, an installation access token does not. So the one-click
 * "create the repo for me" step in the hosted→Git hand-over is impossible with the
 * installation tokens `github-app.ts` mints, and possible with these. Everything *after*
 * creation (committing content, syncing) still goes through the normal token seam.
 *
 * The token is deliberately **never persisted**: it can create repositories, we need it
 * for exactly one call, and the whole exchange happens inside a single callback request.
 */

const API = "https://api.github.com";

export function userAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * True when this deployment can create repositories on a user's behalf. Gates the
 * one-click option in the UI — without it the hand-over still works, you just create the
 * empty repo yourself.
 */
export function isUserAuthConfigured(): boolean {
  return userAuthConfig() !== null;
}

/**
 * What we need to remember across the round trip to GitHub.
 *
 * **One format for both flows, deliberately.** A GitHub App has a single Callback URL, and
 * when it requests user authorization during installation GitHub uses that URL for the
 * *install* too — so the same route receives "I just installed the App" and "I authorized
 * you to create a repo", and it can't tell them apart from the URL alone. Two state shapes
 * meant the install arrived carrying a state the create-repo decoder rejected, and the route
 * bailed to `/` with the installation unrecorded. `repo` is therefore optional: present = also
 * create a repository, absent = this was just an install.
 *
 * AES-GCM-encrypted rather than plain: GCM is authenticated, so a tampered state fails to
 * decrypt instead of being acted on. Authorization is still re-derived from the session — the
 * state only stops a crafted link steering the flow at a site or repo name nobody chose.
 */
export type GithubFlowState = {
  org: string;
  site?: string;
  /** Set only for the one-click flow: the repository to create. */
  repo?: string;
  private?: boolean;
  /** Epoch ms; the flow is a few seconds of redirects, so anything old is stale/replayed. */
  at: number;
};

// Generous enough to survive installing the App (picking repositories on GitHub takes a
// while) without leaving a replayable state lying around.
const STATE_TTL_MS = 30 * 60_000;

export function encodeGithubFlowState(state: Omit<GithubFlowState, "at">): string {
  return encryptSecret(JSON.stringify({ ...state, at: Date.now() }));
}

export function decodeGithubFlowState(raw: string | null): GithubFlowState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decryptSecret(raw)) as GithubFlowState;
    if (typeof parsed?.org !== "string" || !parsed.org) return null;
    if (parsed.site !== undefined && typeof parsed.site !== "string") return null;
    if (parsed.repo !== undefined && (typeof parsed.repo !== "string" || !parsed.repo)) return null;
    if (typeof parsed?.at !== "number" || Date.now() - parsed.at > STATE_TTL_MS) return null;
    // Project only the known fields, so "the state carries identifiers, never a path" stays
    // structurally true and can't be undone by a future caller reading some extra field.
    return {
      org: parsed.org,
      ...(parsed.site === undefined ? {} : { site: parsed.site }),
      ...(parsed.repo === undefined ? {} : { repo: parsed.repo }),
      ...(parsed.private === undefined ? {} : { private: Boolean(parsed.private) }),
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

/**
 * Where to send the browser to authorize. This is the App's own user-authorization
 * endpoint (not a separate OAuth app) — the App must have "Request user authorization
 * (OAuth) during installation" enabled and a Callback URL pointing at our callback route.
 */
export function userAuthorizeUrl(state: string): string | null {
  const config = userAuthConfig();
  if (!config) return null;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Trade the `?code=` GitHub redirected back with for a short-lived user access token. */
export async function exchangeUserCode(code: string): Promise<{ token: string } | { error: string }> {
  const config = userAuthConfig();
  if (!config) return { error: "GitHub user authorization isn't configured for this deployment." };
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });
  if (!res.ok) return { error: `GitHub rejected the authorization (${res.status}).` };
  // GitHub returns 200 with an `error` field on failure, so status alone isn't enough.
  const body = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!body.access_token) {
    return { error: body.error_description ?? body.error ?? "GitHub returned no access token." };
  }
  return { token: body.access_token };
}

export type CreatedRepo = { owner: string; name: string; defaultBranch: string };

/**
 * Create a repository on the authorizing user's account.
 *
 * `auto_init` gives it a README, which means a first commit exists — so the hand-over
 * commits on top of it rather than needing the parentless-initial-commit path, and the
 * repo still counts as empty by `repoEmptiness` (a top-level README is an initializer
 * file, not content).
 */
export async function createUserRepo(
  token: string,
  input: { name: string; private: boolean; description?: string },
): Promise<CreatedRepo | { error: string }> {
  const res = await fetch(`${API}/user/repos`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      name: input.name,
      private: input.private,
      description: input.description,
      auto_init: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // 403 here almost always means the App lacks Administration: write, which is the one
    // permission this whole path depends on — say so rather than echoing a bare status.
    if (res.status === 403) {
      return {
        error:
          "GitHub refused to create the repository. The Papervine GitHub App needs the " +
          "“Administration: write” repository permission to create repos on your behalf.",
      };
    }
    if (res.status === 422 && /already exists/i.test(body)) {
      return { error: `You already have a repository called “${input.name}”. Pick another name.` };
    }
    return { error: `Couldn't create the repository (${res.status}): ${body.slice(0, 200)}` };
  }
  const repo = (await res.json()) as {
    name: string;
    default_branch: string;
    owner: { login: string };
  };
  return { owner: repo.owner.login, name: repo.name, defaultBranch: repo.default_branch };
}
