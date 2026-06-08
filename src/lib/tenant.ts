import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { site } from "./db/app-schema";

export { resolveTenantSlug } from "./tenant-host";

export const getSiteBySlug = cache(async (slug: string) => {
  const rows = await db.select().from(site).where(eq(site.slug, slug)).limit(1);
  return rows[0] ?? null;
});
