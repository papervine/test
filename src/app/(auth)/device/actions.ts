"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { normalizeUserCode } from "@/lib/device-code";

/**
 * Approve / deny a pending device authorization (SPEC §11.4).
 *
 * Thin wrappers over Better Auth's own endpoints, which hold every rule worth holding: the
 * caller must be signed in, the row must still be pending and unexpired, and — the important
 * one — it must already be CLAIMED by this same user. The claim happens when the page loads
 * (`deviceVerify`), which is why approving is a two-request dance and not a single link: a
 * one-click approve URL is a phishing primitive, and there is nowhere in this flow where a GET
 * should be able to hand out an account.
 *
 * Returns a result object rather than throwing so the client can render the reason. `deviceDeny`
 * failing is reported too — silently "denying" a code that is actually still live would leave a
 * waiting terminal to time out while the user believes they refused it.
 */
export async function approveDevice(
  userCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return run("approve", userCode);
}

export async function denyDevice(
  userCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return run("deny", userCode);
}

async function run(
  action: "approve" | "deny",
  userCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = normalizeUserCode(userCode);
  if (!code) return { ok: false, error: "No code to act on." };
  const h = await headers();
  try {
    if (action === "approve") {
      await auth.api.deviceApprove({ body: { userCode: code }, headers: h });
    } else {
      await auth.api.deviceDeny({ body: { userCode: code }, headers: h });
    }
    return { ok: true };
  } catch (e) {
    const message =
      e && typeof e === "object" && "body" in e
        ? ((e as { body?: { error_description?: string } }).body?.error_description ?? null)
        : null;
    return { ok: false, error: message ?? `Couldn’t ${action} this request. Try again.` };
  }
}
