import { headers } from "next/headers";
import { auth } from "./auth";

// Server-side session read for RSC layouts/pages. Returns null when signed out.
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

// Organizations the current request's user belongs to (tenants).
export async function listOrganizations() {
  return auth.api.listOrganizations({ headers: await headers() });
}
