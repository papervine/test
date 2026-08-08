import Link from "next/link";
import { emailStatusFromEnv } from "@/lib/email";
import { ForgotPasswordForm } from "./forgot-password-form";

// Password reset needs a working mailbox on our end. When no provider is configured the reset
// link is only logged to the server console, so offering the form to an end user would promise
// an email that never arrives — say so instead. (The login page hides its "Forgot password?"
// link under the same condition; this page still has to handle a direct visit.)
export default function ForgotPasswordPage() {
  if (!emailStatusFromEnv().enabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Password reset is unavailable</h1>
        <p className="text-sm text-[var(--muted)]">
          This deployment has no transactional email configured, so we can&apos;t send a reset
          link. Ask an administrator to reset your password directly.
        </p>
        <p className="text-center text-sm text-[var(--muted)]">
          <Link href="/login" className="text-[var(--blue)] hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }
  return <ForgotPasswordForm />;
}
