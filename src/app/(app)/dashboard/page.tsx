import { eq } from "drizzle-orm";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";

export default async function DashboardHome() {
  const session = await getSession();
  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0];
  // The (app) layout redirects org-less users to /onboarding, but the page renders
  // concurrently with the layout in the RSC tree — guard so it never throws first.
  if (!session || !activeOrg) return null;

  const sites = await db.select().from(site).where(eq(site.organizationId, activeOrg.id));

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = session.user.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold">
        Good {partOfDay}, {firstName}
      </h1>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-400">Your sites</h2>
        {sites.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-neutral-800 px-6 py-10 text-center">
            <p className="text-sm text-neutral-300">No docs sites yet.</p>
            <p className="mt-1 text-sm text-neutral-500">
              Connect a Git repo to publish your first site. (Coming next.)
            </p>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3">
            {sites.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-neutral-800 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-neutral-500">
                    {s.customDomain ?? `${s.slug}.docbot.app`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    s.status === "live"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-neutral-800 text-neutral-400"
                  }`}
                >
                  {s.status === "live" ? "Live" : "Draft"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-neutral-400">Activity</h2>
        <div className="mt-3 rounded-lg border border-neutral-800 px-6 py-8 text-center text-sm text-neutral-500">
          No activity yet — syncs will appear here once a repo is connected.
        </div>
      </section>
    </div>
  );
}
