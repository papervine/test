import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { ArrowDown, ArrowUp } from "lucide-react";
import { getSession, listOrganizations } from "@/lib/session";
import { db } from "@/lib/db";
import { site } from "@/lib/db/app-schema";
import { ACTIVE_SITE_COOKIE, resolveActiveSite } from "@/lib/active-site";
import {
  parseRangeKey,
  resolveRange,
  type RangeKey,
} from "@/lib/analytics-range";
import {
  getAnalytics,
  getAgentAnalytics,
  type AnalyticsSource,
  type MetricCard as Card,
} from "@/lib/analytics";
import { ButtonLink } from "@/components/platform/Button";
import { AnalyticsControls } from "@/components/analytics/AnalyticsControls";
import { VisitorsChart } from "@/components/analytics/VisitorsChart";

type Search = { tab?: string; range?: string };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await getSession();
  const orgs = await listOrganizations();
  const activeOrg = orgs?.[0];
  if (!session || !activeOrg) return null;

  // Analytics is per-site, scoped to the active site picked by the top-left switcher
  // (SPEC §10) — the cookie's site if it's one of this org's, else the first.
  const sites = await db
    .select()
    .from(site)
    .where(eq(site.organizationId, activeOrg.id))
    .orderBy(asc(site.createdAt));
  const cookieSlug = (await cookies()).get(ACTIVE_SITE_COOKIE)?.value;
  const activeSite = resolveActiveSite(sites, cookieSlug);

  const sp = await searchParams;
  const tab: "humans" | "agents" = sp.tab === "agents" ? "agents" : "humans";
  const rangeKey: RangeKey = parseRangeKey(sp.range);
  const range = resolveRange(rangeKey, new Date());
  const source: AnalyticsSource = tab === "agents" ? "agent" : "human";

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        {activeSite && (
          <span className="text-sm text-[var(--muted)]">{activeSite.name}</span>
        )}
      </div>

      {!activeSite ? (
        <div className="mt-8 rounded-xl border border-dashed border-white/[0.1] px-6 py-12 text-center">
          <p className="text-sm text-[var(--muted)]">
            No site yet — connect a repository to start collecting analytics.
          </p>
          <ButtonLink href="/dashboard/connect" className="mt-4">
            Connect a repository
          </ButtonLink>
        </div>
      ) : tab === "agents" ? (
        <AgentDashboard
          siteId={activeSite.id}
          tab={tab}
          rangeKey={rangeKey}
          range={range}
        />
      ) : (
        <Dashboard
          siteId={activeSite.id}
          source={source}
          tab={tab}
          rangeKey={rangeKey}
          range={range}
        />
      )}
    </div>
  );
}

async function Dashboard({
  siteId,
  source,
  tab,
  rangeKey,
  range,
}: {
  siteId: string;
  source: AnalyticsSource;
  tab: "humans" | "agents";
  rangeKey: RangeKey;
  range: ReturnType<typeof resolveRange>;
}) {
  const data = await getAnalytics(siteId, source, range);

  return (
    <>
      <div className="mt-6">
        <AnalyticsControls tab={tab} range={rangeKey} rangeLabel={range.label} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {data.cards.map((c) => (
          <MetricCard key={c.key} card={c} />
        ))}
      </div>

      <section className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium">Visitors Over Time</h2>
        <p className="text-xs text-[var(--muted)]">
          Daily visitors count for the selected date range
        </p>
        <div className="mt-6">
          <VisitorsChart data={data.visitors} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RankTable
          title="Top pages"
          rows={data.topPages.map((r) => ({ label: r.path, value: r.views }))}
          empty="No page views yet"
        />
        <RankTable
          title="Referrals"
          rows={data.referrals.map((r) => ({
            label: r.referrer,
            value: r.views,
          }))}
          empty="No referrals yet"
        />
      </div>
    </>
  );
}

// The Agents tab (SPEC §10.1) — a distinct layout, not the human dashboard refiltered.
// Two agent-specific cards, the visitors chart, and a Top *agents* breakdown
// (Claude/ChatGPT/…) beside Top pages.
async function AgentDashboard({
  siteId,
  tab,
  rangeKey,
  range,
}: {
  siteId: string;
  tab: "humans" | "agents";
  rangeKey: RangeKey;
  range: ReturnType<typeof resolveRange>;
}) {
  const data = await getAgentAnalytics(siteId, range);

  return (
    <>
      <div className="mt-6">
        <AnalyticsControls tab={tab} range={rangeKey} rangeLabel={range.label} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricCard card={data.agentVisitors} />
        <MetricCard card={data.mcpSearches} />
      </div>

      <section className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-medium">Agent Visitors Over Time</h2>
        <p className="text-xs text-[var(--muted)]">
          Daily agent visitors count for the selected date range
        </p>
        <div className="mt-6">
          <VisitorsChart data={data.visitors} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RankTable
          title="Top pages"
          rows={data.topPages.map((r) => ({ label: r.path, value: r.views }))}
          empty="No agent page views yet"
        />
        <RankTable
          title="Top agents"
          valueLabel="Visits"
          mono={false}
          rows={data.topAgents.map((r) => ({ label: r.agent, value: r.visits }))}
          empty="No agents yet"
        />
      </div>
    </>
  );
}

function MetricCard({ card }: { card: Card }) {
  const d = card.delta;
  return (
    <div
      data-testid={`metric-${card.key}`}
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
    >
      <p className="text-sm text-[var(--muted)]">{card.label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{card.value}</p>
      <div className="mt-3 text-xs">
        {d === null ? (
          <span className="text-[var(--muted)]">—</span>
        ) : d.dir === "flat" ? (
          <span className="text-[var(--muted)]">0% vs previous</span>
        ) : (
          <span
            className={
              d.dir === "up" ? "text-emerald-400" : "text-red-400"
            }
          >
            <span className="inline-flex items-center gap-0.5">
              {d.dir === "up" ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {Math.abs(d.pct)}%
            </span>{" "}
            <span className="text-[var(--muted)]">vs previous</span>
          </span>
        )}
      </div>
    </div>
  );
}

function RankTable({
  title,
  rows,
  empty,
  valueLabel = "Views",
  mono = true,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  empty: string;
  valueLabel?: string;
  mono?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-[var(--muted)]">{valueLabel}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
            >
              <span
                className={`truncate text-sm text-[var(--fg)]/90 ${
                  mono ? "font-mono" : ""
                }`}
              >
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums text-sm text-[var(--muted)]">
                {r.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
