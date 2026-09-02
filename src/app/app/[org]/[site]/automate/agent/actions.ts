"use server";

import { revalidatePath } from "next/cache";
import { findSite } from "@/lib/dashboard-context";
import { siteRoute } from "@/lib/dashboard-nav";
import { disconnectSlackWorkspace } from "@/lib/slack-workspaces";

export type SiteRef = { org: string; site: string };

// Disconnect the org's Slack workspace (SPEC §10.2). findSite is the auth guard
// (session + membership), same as the automations actions; the row's deletion is what
// stops the agent — the events endpoint resolves org by team id through that table.
// Returns void (it's a bare <form action>): an unauthorized call simply no-ops, and
// the revalidated page shows the banner's true state either way.
export async function disconnectSlack(ref: SiteRef): Promise<void> {
  const active = await findSite(ref.org, ref.site);
  if (!active) return;
  await disconnectSlackWorkspace(active.organizationId);
  revalidatePath(siteRoute(ref.org, ref.site, "automate/agent"));
}
