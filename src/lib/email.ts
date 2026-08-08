import { Resend } from "resend";
import type { EmailBody } from "./email-templates";

// Transactional email (SPEC §10.1). One seam — `sendEmail` — with Resend behind it.
//
// OPTIONAL, exactly like Google sign-in: with no `RESEND_API_KEY` the send is logged to the
// server console instead, including the link. That keeps a bare checkout, CI, the zero-dep
// smoke gate, and `npm run test:e2e` working with no vendor account, and it keeps local dev
// usable — the verification/reset link is right there in the terminal. A *self-hoster* who
// prefers another provider replaces the one `deliver` call below; nothing else in the codebase
// knows Resend exists, which is the same "no vendor baked into the core" rule that picked
// Better Auth over Clerk (SPEC §11.1).

export type EmailConfig = { apiKey: string; from: string };

export type EmailStatus =
  // Two working transports. "console" is a REAL transport, not a failure mode: outside
  // production, writing the message (link included) to the server log is a legitimate way to
  // deliver it — it's how you develop and test these flows without a vendor account. Treating
  // it as "feature off" made /forgot-password unreachable on every dev machine and in the e2e
  // suite, which is how this distinction got found.
  | { enabled: true; transport: "resend"; config: EmailConfig }
  | { enabled: true; transport: "console" }
  // In PRODUCTION an unconfigured provider really is off: promising "check your inbox" for a
  // message that only reaches a log file is a lie to a real user. "missing-from" means a key
  // was supplied without a sender identity, which would fail at send time.
  | { enabled: false; reason: "unconfigured" | "missing-from" };

/**
 * Resolve the transport. Resend wins whenever it's fully configured — including in development,
 * so real delivery can be exercised — and console is the fallback everywhere but production.
 *
 * `allowConsole` is a parameter rather than a `process.env` read so this stays pure.
 */
export function emailStatus(
  rawApiKey: string | undefined,
  rawFrom: string | undefined,
  allowConsole: boolean,
): EmailStatus {
  const apiKey = rawApiKey?.trim();
  // Resend rejects a send whose `from` isn't on a domain you've verified, so there's no safe
  // default we could invent — an operator with a key must say who the mail is from.
  const from = rawFrom?.trim();
  if (apiKey && from) return { enabled: true, transport: "resend", config: { apiKey, from } };
  if (allowConsole) return { enabled: true, transport: "console" };
  return { enabled: false, reason: apiKey ? "missing-from" : "unconfigured" };
}

export function emailStatusFromEnv(): EmailStatus {
  return emailStatus(
    process.env.RESEND_API_KEY,
    process.env.EMAIL_FROM,
    process.env.NODE_ENV !== "production",
  );
}

// One client per process. The SDK is a thin fetch wrapper, but constructing it per send would
// still be wasteful on a hot path like an invite blast.
let client: Resend | null = null;
function resendClient(apiKey: string): Resend {
  if (!client) client = new Resend(apiKey);
  return client;
}

// Better Auth AWAITS our send callbacks — `sendVerificationEmail` runs inside the sign-up
// request — so a slow provider makes signup slow, and a hanging one hangs signup until the
// platform's request timeout. Neither is acceptable for an operation whose real work (creating
// the account) is already done. Cap the wait: past this the send is abandoned and logged, and
// the user still gets their account. Found the hard way — a real key in a dev .env.local turned
// e2e signup into a network-bound call and stalled the suite.
const SEND_TIMEOUT_MS = 5_000;

// Reject after SEND_TIMEOUT_MS. The underlying request is left to finish or die on its own —
// we only stop *waiting* on it, which is the part that holds the user's signup open. The
// rejection lands in sendEmail's catch, so it's logged like any other delivery failure.
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS}ms`)),
        SEND_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Deliver one transactional email.
 *
 * **Never throws.** Every caller is an auth flow — signup, password reset, an invitation — and
 * a provider outage must not turn into a failed signup or a 500. Better Auth awaits these
 * callbacks, so a rejection here would surface to the user as "sign up failed" when their
 * account was in fact created. Delivery problems are logged and the flow continues; the
 * boolean is for callers that want to report "check your inbox" honestly.
 */
export async function sendEmail(to: string, body: EmailBody): Promise<boolean> {
  const status = emailStatusFromEnv();
  if (!status.enabled) {
    console.error(
      `[email] NOT SENT (${status.reason}) to=${to} subject="${body.subject}" — configure RESEND_API_KEY + EMAIL_FROM.`,
    );
    return false;
  }
  if (status.transport === "console") {
    // Dev/CI transport: the whole point is that the link is usable from the terminal.
    console.log(`[email] to=${to} subject="${body.subject}"\n${body.text}`);
    return true;
  }
  try {
    const { error } = await withTimeout(
      resendClient(status.config.apiKey).emails.send({
        from: status.config.from,
        to,
        subject: body.subject,
        html: body.html,
        text: body.text,
      }),
    );
    if (error) {
      // The SDK reports API-level failures in the payload rather than by throwing.
      console.error(`[email] send failed to=${to} subject="${body.subject}":`, error);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[email] send threw to=${to} subject="${body.subject}":`, e);
    return false;
  }
}
