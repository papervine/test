import { asc, eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { s3Source } from "@/lib/s3-source";
import { contentVersion, liveContentPrefix } from "@/lib/revisions";
import { loadSkills } from "@/lib/skills-source";
import { timeAgo } from "@/lib/overview";
import { AdminPage, Empty, PageHead, Table, Td, Th } from "../ui";
import { RegenerateButton } from "./RegenerateButton";

// Operator › Skills (SPEC §9.1, §10.10). What every live site is publishing at /skill.md, and
// whether it wrote that itself or we generated it.
//
// The column that earns the page is "source": a site shipping its own skill.md is one we never
// touch, and knowing which is which is the difference between "the generator is broken" and
// "the generator was never asked".
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AdminSkillsPage() {
  // Called here as well as in the layout: Next renders a layout and its page concurrently, so a
  // layout-only gate still lets these queries run before the 404 wins.
  await requirePlatformAdmin();

  const rows = await db
    .select()
    .from(site)
    .where(eq(site.status, "live"))
    .orderBy(asc(site.name))
    .limit(PAGE_SIZE);

  // Whether each site ships its OWN skill file. Read per site through its content source, which
  // is the same path the serving endpoints take — so this table can't disagree with what an
  // agent actually gets. Bounded by PAGE_SIZE and cached per site version, so it's a handful of
  // cache hits rather than a fan-out of reads.
  const authored = new Map<string, number>();
  for (const row of rows) {
    const src = s3Source(row.id, contentVersion(row), liveContentPrefix(row));
    // Explicit source, not the ambient one: this loop is a single request over many sites, and
    // the package's cached readers are keyed by argument alone (see loadSkills).
    const skills = await loadSkills(src).catch(() => []);
    authored.set(row.id, skills.length);
  }

  return (
    <AdminPage>
      <PageHead
        title="Skills"
        desc="What each live site publishes at /skill.md. Sites that ship their own file are never regenerated; the rest are generated from their documentation and refreshed when their structure changes."
      />

      <Table
        head={
          <tr>
            <Th>Site</Th>
            <Th>Source</Th>
            <Th>State</Th>
            <Th>Generated</Th>
            <Th right>Actions</Th>
          </tr>
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5}>
              <Empty>No live sites yet.</Empty>
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const own = (authored.get(row.id) ?? 0) > 0;
            return (
              <tr key={row.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
                <Td>
                  <span className="font-medium">{row.name}</span>{" "}
                  <span className="font-mono text-xs text-[var(--muted)]">{row.slug}</span>
                </Td>
                <Td>
                  {own ? (
                    <span>authored ({authored.get(row.id)})</span>
                  ) : row.skillGeneratedAt ? (
                    "generated"
                  ) : (
                    <span className="text-[var(--muted)]">none yet</span>
                  )}
                </Td>
                <Td>
                  {own ? (
                    <span className="text-[var(--muted)]">—</span>
                  ) : row.skillStaleAt ? (
                    // Published since the last generation. NOT the same as "will regenerate":
                    // the sweep still checks whether the capability surface actually moved.
                    <span title="Published since the last generation — the sweep will re-check it">
                      due
                    </span>
                  ) : (
                    <span className="text-[var(--muted)]">current</span>
                  )}
                </Td>
                <Td mono>
                  {row.skillGeneratedAt ? timeAgo(row.skillGeneratedAt.getTime()) : "—"}
                </Td>
                <Td right>
                  <RegenerateButton siteId={row.id} authored={own} />
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </AdminPage>
  );
}
