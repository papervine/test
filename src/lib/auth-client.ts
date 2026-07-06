import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // adminClient: impersonation controls for platform admins (SPEC §10.10) —
  // authClient.admin.impersonateUser / stopImpersonating.
  plugins: [organizationClient(), adminClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
