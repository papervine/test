import { googleOAuthFromEnv } from "@/lib/social-auth";
import { LoginForm } from "./login-form";

// Server shell around the client form: whether Google sign-in is available is a *server*
// fact (credentials in the environment), and reading it here keeps the answer out of the
// browser bundle — no NEXT_PUBLIC_ mirror of a config the server already knows.
export default function LoginPage() {
  return <LoginForm google={googleOAuthFromEnv().enabled} />;
}
