import { githubOAuthFromEnv, googleOAuthFromEnv } from "@/lib/social-auth";
import { SignupForm } from "./signup-form";

// Server shell around the client form — see login/page.tsx for why the Google flag is
// resolved here rather than shipped to the browser as a NEXT_PUBLIC_ variable.
export default function SignupPage() {
  return <SignupForm google={googleOAuthFromEnv().enabled} github={githubOAuthFromEnv().enabled} />;
}
