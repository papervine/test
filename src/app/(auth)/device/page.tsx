import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deviceCode as deviceCodeTable } from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { headers } from "next/headers";
import { isPlausibleUserCode, normalizeUserCode } from "@/lib/device-code";
import { DeviceApproval } from "./DeviceApproval";

/**
 * Device-authorization verification page (SPEC §11.4) — where `papervine signup` /
 * `papervine login` sends the browser, and the `verification_uri` advertised by
 * `/.well-known/oauth-authorization-server`.
 *
 * Lives with the other bare-URL app-host pages (`/login`, `/accept-invite`) and keeps its own
 * path through the middleware passthrough. Reachable signed-OUT on purpose: the page then offers
 * "sign in" and "create an account" links that carry `?redirect=` back to here with the code
 * intact, which is what makes `papervine signup` a single uninterrupted flow rather than "now go
 * find that URL again".
 *
 * Load order matters and is not cosmetic. `deviceVerify` is what CLAIMS the row for the signed-in
 * user, and Better Auth refuses to approve an unclaimed row — so the page must call it before it
 * can offer an Approve button. It is also the reason the claim is a page *load* and the approval
 * is a POST: claiming is harmless, granting must never be a GET.
 */
export const dynamic = "force-dynamic";

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const { user_code: raw } = await searchParams;
  const code = normalizeUserCode(raw);

  // No code (someone opened /device by hand, or typed the URL off the terminal without the
  // query) → let them type it. Not an error: this is the RFC 8628 §3.3 "user_code entry" case,
  // and it's the path anyone following a printed `verification_uri` takes.
  if (!code || !isPlausibleUserCode(code)) {
    return <DeviceApproval state={raw ? "invalid" : "prompt"} />;
  }

  const session = await getSession();
  if (!session) return <DeviceApproval state="anon" code={code} />;

  // Claim the row for this user (and read its status back). Any failure here is a bad or
  // expired code — the endpoint doesn't distinguish beyond that, and neither should we: telling
  // an anonymous prober which codes exist is the one thing this page must not do.
  let status: string;
  try {
    const res = await auth.api.deviceVerify({
      query: { user_code: code },
      headers: await headers(),
    });
    status = String(res?.status ?? "pending");
  } catch {
    return <DeviceApproval state="invalid" code={code} />;
  }

  // Who is asking. Read straight from the row because `deviceVerify` returns only the status —
  // and an approval screen that can't name the client is asking the user to consent to nothing
  // in particular.
  const [row] = await db
    .select({ clientId: deviceCodeTable.clientId, scope: deviceCodeTable.scope })
    .from(deviceCodeTable)
    .where(eq(deviceCodeTable.userCode, code))
    .limit(1);

  return (
    <DeviceApproval
      state={status === "approved" ? "approved" : status === "denied" ? "denied" : "confirm"}
      code={code}
      clientId={row?.clientId ?? null}
      scope={row?.scope ?? null}
      email={session.user.email}
    />
  );
}
