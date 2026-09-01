import { NextResponse } from "next/server";
import { getSession, listOrganizations } from "@/lib/session";

/**
 * Who is this token? (SPEC §11.4)
 *
 * The first authenticated JSON endpoint meant for clients outside a browser — `papervine whoami`
 * calls it with the token the device grant handed back, and it is what turns "we stored a
 * string" into "we stored a working credential". An agent that walked the device flow itself
 * uses the same endpoint for the same reason.
 *
 * Deliberately NOT named `/api/cli/*`. The device grant is public (see
 * `/.well-known/oauth-authorization-server`), so our CLI is one client among however many, and
 * a path that says otherwise would have to be renamed the first time something else called it.
 *
 * Authentication is a session — cookie in a browser, `Authorization: Bearer <token>` everywhere
 * else, which the `bearer()` plugin in `src/lib/auth.ts` folds into the same read. No extra
 * gate here: this returns exactly what the signed-in user can already see in the dashboard.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthorized", error_description: "No valid session or bearer token." },
      // RFC 6750 §3: a protected resource refusing a bearer token says which scheme it wants.
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="papervine"' } },
    );
  }

  const orgs = (await listOrganizations()) ?? [];

  return NextResponse.json(
    {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        emailVerified: session.user.emailVerified,
      },
      organizations: orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
