// Drive the authoring MCP's OAuth flow the way a real MCP client does (SPEC §9.2/§11), so the
// write path can be exercised without wiring up an editor — the analogue of
// scripts/sign-reader-jwt.mjs for the other auth layer.
//
// It registers a client dynamically, opens the authorize URL in your browser, captures the
// authorization code on a loopback callback, exchanges it for a token, and then calls the MCP
// with that token so you see the whole chain succeed or fail at the step that broke.
//
//   node scripts/authoring-mcp-login.mjs                                  # local dev, dev-org/starter
//   node scripts/authoring-mcp-login.mjs --site docs
//   node scripts/authoring-mcp-login.mjs --origin https://app.papervine.io --org acme --site docs
//   node scripts/authoring-mcp-login.mjs --write                          # also prove a write lands
//
// Local dev needs the app running (`npm run dev`) and a seeded DB (`npm run db:seed`); pass
// `--origin` matching the port it actually chose if :3000 was busy.
//
// The token is printed at the end. Reuse it directly for one hour:
//
//   curl -X POST <origin>/authoring/mcp \
//     -H "authorization: Bearer <token>" \
//     -H "x-papervine-org: dev-org" -H "x-papervine-site: starter" \
//     -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
//     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const ORIGIN = arg("origin", "http://app.localhost:3000").replace(/\/$/, "");
const ORG = arg("org", "dev-org");
const SITE = arg("site", "starter");
const PORT = Number(arg("port", "9876"));
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

const step = (m) => console.log(`\x1b[36m▶\x1b[0m ${m}`);
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m✗\x1b[0m ${m}`);
  process.exit(1);
};

// Node can't resolve `app.localhost` (browsers can), so API calls go to a resolvable host while
// the browser gets the real one. They're the same server and the flow's state lives in the DB,
// so the split is invisible to the protocol.
const API = ORIGIN.replace("//app.localhost", "//127.0.0.1");

const b64 = (buf) => buf.toString("base64url");
const verifier = b64(randomBytes(32));
const challenge = b64(createHash("sha256").update(verifier).digest());

// --- 1. Register --------------------------------------------------------------
step(`registering a client with ${ORIGIN}`);
const reg = await fetch(`${API}/api/auth/mcp/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "Papervine CLI login",
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
})
  .then((r) => r.json())
  .catch((e) => fail(`could not reach ${API} — is the app running?\n  ${e.message}`));

if (!reg?.client_id) fail(`registration failed: ${JSON.stringify(reg)}`);
ok(`client_id ${reg.client_id}`);

// --- 2. Authorize (browser) ---------------------------------------------------
const authorizeUrl = new URL(`${ORIGIN}/api/auth/mcp/authorize`);
for (const [k, v] of Object.entries({
  response_type: "code",
  client_id: reg.client_id,
  redirect_uri: REDIRECT,
  scope: "openid profile email offline_access",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: b64(randomBytes(8)),
})) {
  authorizeUrl.searchParams.set(k, v);
}

const code = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const error = url.searchParams.get("error");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      `<body style="font:14px system-ui;padding:3rem">${
        error ? `Denied: ${error}. ` : "Authorized. "
      }You can close this tab.</body>`,
    );
    server.close();
    if (error) fail(`authorization denied: ${error}`);
    resolve(url.searchParams.get("code"));
  });
  server.listen(PORT, "127.0.0.1", () => {
    step("opening your browser — sign in if asked, then approve the request");
    console.log(`  ${authorizeUrl}`);
    // `open` on macOS, `xdg-open` elsewhere; if neither works the URL is printed above.
    // `--no-open` is for a headless or remote machine, where launching a browser here would
    // either fail or open one nobody is looking at — paste the URL into your own instead.
    if (!has("no-open")) {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(opener, [authorizeUrl.toString()], { stdio: "ignore" }).on("error", () => {});
    }
  });
});

if (!code) fail("no authorization code came back");
ok("authorization code received");

// --- 3. Exchange --------------------------------------------------------------
step("exchanging the code for a token");
const token = await fetch(`${API}/api/auth/mcp/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: reg.client_id,
    code_verifier: verifier,
  }),
}).then((r) => r.json());

if (!token?.access_token) fail(`token exchange failed: ${JSON.stringify(token)}`);
ok(`access token (expires in ${token.expires_in}s)`);

// --- 4. Call the MCP ----------------------------------------------------------
const call = async (method, params = {}) => {
  const res = await fetch(`${API}/authoring/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token.access_token}`,
      "x-papervine-org": ORG,
      "x-papervine-site": SITE,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

step(`calling the authoring MCP as ${ORG}/${SITE}`);
const tools = await call("tools/list");
if (tools.status !== 200) fail(`tools/list returned ${tools.status}`);
ok(`${tools.body?.result?.tools?.length ?? 0} tools`);

const pages = await call("tools/call", { name: "list_pages", arguments: {} });
const text = pages.body?.result?.content?.[0]?.text ?? "";
// An authorization refusal comes back as a normal tool result carrying `error` — the tools
// mount and refuse, so a 200 here is not by itself success.
if (text.includes('"error"')) fail(`authorized, but refused: ${text.trim()}`);
ok(`list_pages returned ${(JSON.parse(text) ?? []).length} pages`);

if (has("write")) {
  step("writing (an identity edit — proves the draft branch opens, changes nothing)");
  const slug = JSON.parse(text)[1]?.href?.replace(/^\//, "") || "index";
  const page = JSON.parse(
    (await call("tools/call", { name: "read", arguments: { slug } })).body.result.content[0].text,
  );
  const marker = (page.body ?? "").trim().split("\n")[0] || page.title;
  const wrote = await call("tools/call", {
    name: "edit_page",
    arguments: { slug, find: marker, replace: marker },
  });
  const wroteText = wrote.body?.result?.content?.[0]?.text ?? "";
  if (wroteText.includes('"error"')) fail(`write refused: ${wroteText.trim()}`);
  ok(`buffered on ${JSON.parse(wroteText).branch}`);
  console.log("\n  Nothing was published — discard the session in the editor if you like.");
}

console.log(`\n\x1b[32mWorks.\x1b[0m Token, valid for one hour:\n\n  ${token.access_token}\n`);
