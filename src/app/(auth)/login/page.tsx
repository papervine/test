import { googleOAuthFromEnv } from "@/lib/social-auth";
import { emailStatusFromEnv } from "@/lib/email";
import { LoginForm } from "./login-form";

// Server shell around the client form: which sign-in methods exist, and whether password
// reset can deliver an email, are *server* facts (credentials in the environment). Reading
// them here keeps the answers out of the browser bundle — no NEXT_PUBLIC_ mirror of config
// the server already knows.
export default function LoginPage() {
  return (
    <LoginForm
      google={googleOAuthFromEnv().enabled}
      email={emailStatusFromEnv().enabled}
    />
  );
}
