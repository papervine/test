import { describe, it, expect } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { inArray, sql } from "drizzle-orm";
import { site } from "@/lib/db/app-schema";

/**
 * Interpolating a JS array into a `sql` template is a trap, and it took the Operator console
 * down in production: `sql\`${site.id} = any(${ids})\`` expands the array to a comma-separated
 * list of placeholders, producing `any(($1, $2))` — a ROW CONSTRUCTOR — which Postgres rejects
 * with "op ANY/ALL (array) requires array on right side".
 *
 * It's a nasty shape to catch by review or by testing: with a single id it renders `any(($1))`,
 * which Postgres happily accepts, so the bug is invisible until real data produces two. And it
 * needs no database to reproduce — the defect is entirely in the SQL that gets generated, which
 * is what this pins.
 */
const qb = new QueryBuilder();

describe("array parameters in generated SQL", () => {
  it("inArray renders a real IN list", () => {
    const { sql: text, params } = qb
      .select({ id: site.id })
      .from(site)
      .where(inArray(site.id, ["a", "b"]))
      .toSQL();

    expect(text).toContain(" in (");
    expect(text).not.toContain("any(");
    expect(params).toEqual(["a", "b"]);
  });

  it("shows why the `any()` template was wrong — the array becomes a row constructor", () => {
    const { sql: text } = qb
      .select({ id: site.id })
      .from(site)
      .where(sql`${site.id} = any(${["a", "b"]})`)
      .toSQL();

    // Documenting the broken rendering rather than asserting a fix: this is the exact string
    // Postgres refused. If drizzle ever changes this, the test tells us the trap is gone.
    expect(text).toContain("any((");
  });

  it("a single id hides the bug, which is why it reached production", () => {
    const { sql: text } = qb
      .select({ id: site.id })
      .from(site)
      .where(sql`${site.id} = any(${["only-one"]})`)
      .toSQL();

    // `any(($1))` — valid SQL, works fine. The failure needs two.
    expect(text).toContain("any((");
    expect(text.match(/\$\d+/g)).toHaveLength(1);
  });
});
