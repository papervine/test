import { desc } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { waitlistEntry } from "@/lib/db/app-schema";
import { timeAgo } from "@/lib/overview";
import { AdminPage, Empty, PageHead, Table, Td, Th } from "../ui";

// Operator › Waitlist (SPEC §10.10). Where the marketing home's signups land. Without this the
// table is only readable over psql, which in practice means nobody reads it — and a waitlist
// nobody reads is a form that quietly discards intent.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export default async function AdminWaitlistPage() {
  // Called here as well as in the layout: Next renders a layout and its page concurrently, so a
  // layout-only gate still lets this query run before the 404 wins.
  await requirePlatformAdmin();

  const rows = await db
    .select()
    .from(waitlistEntry)
    // Oldest first would be the queue order, but the useful question day to day is "who just
    // signed up" — and the created dates are right there for working the queue.
    .orderBy(desc(waitlistEntry.createdAt))
    .limit(PAGE_SIZE);

  return (
    <AdminPage>
      <PageHead
        title="Waitlist"
        desc="Signups from the marketing home. The note is what they said they were looking for, in their own words — it's the most useful column here."
      />

      <Table
        head={
          <tr>
            <Th>Email</Th>
            <Th>What they&apos;re looking for</Th>
            <Th>From</Th>
            <Th right>Joined</Th>
          </tr>
        }
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4}>
              <Empty>Nobody has joined the waitlist yet.</Empty>
            </td>
          </tr>
        ) : (
          rows.map((entry) => (
            <tr key={entry.id} className="hover:bg-[rgba(var(--ink-rgb),0.03)]">
              <Td mono>{entry.email}</Td>
              {/* Not truncated: this column is the reason to open the page, and these are a few
                  sentences at most (WAITLIST_NOTE_MAX). */}
              <Td>
                {entry.note ?? <span className="text-[var(--muted)]">—</span>}
              </Td>
              <Td mono>{entry.source ?? "—"}</Td>
              <Td right>{timeAgo(entry.createdAt.getTime())}</Td>
            </tr>
          ))
        )}
      </Table>
    </AdminPage>
  );
}
