import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SYNC_INFLIGHT_MS,
  feedParam,
  formatDurationMs,
  partOfDay,
  parseFeedTarget,
  pollDelayMs,
  syncInFlight,
  timeAgo,
  triggerDetail,
  triggerLabel,
} from "../../src/lib/overview";

describe("partOfDay", () => {
  it("splits the day into morning / afternoon / evening", () => {
    expect(partOfDay(0)).toBe("morning");
    expect(partOfDay(11)).toBe("morning");
    expect(partOfDay(12)).toBe("afternoon");
    expect(partOfDay(17)).toBe("afternoon");
    expect(partOfDay(18)).toBe("evening");
    expect(partOfDay(23)).toBe("evening");
  });
});

describe("greeting time source", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  // The greeting's part-of-day must come from the reader's clock, not the server's
  // (UTC on Vercel) — else an evening visitor gets "Good morning". The dashboard page
  // is server-rendered, so it must NOT call getHours()/new Date() for the greeting;
  // that belongs in the "use client" <Greeting> component.
  it("does not compute the greeting from server time in the site overview page", () => {
    const page = read("../../src/app/app/[org]/[site]/page.tsx");
    expect(page).not.toMatch(/getHours/);
    expect(page).toContain("<Greeting");
  });

  it("computes part-of-day on the client in <Greeting>", () => {
    const greeting = read("../../src/components/app/Greeting.tsx");
    expect(greeting).toContain('"use client"');
    expect(greeting).toMatch(/partOfDay\(new Date\(\)\.getHours\(\)\)/);
  });
});

describe("parseFeedTarget", () => {
  it("maps the Previews tab to the preview target", () => {
    expect(parseFeedTarget("previews")).toBe("preview");
  });

  it("defaults to Live for missing or unknown params", () => {
    expect(parseFeedTarget(undefined)).toBe("live");
    expect(parseFeedTarget("live")).toBe("live");
    expect(parseFeedTarget("garbage")).toBe("live");
  });
});

describe("feedParam", () => {
  it("is the inverse of parseFeedTarget — round-trips both tabs", () => {
    expect(feedParam("preview")).toBe("previews");
    expect(feedParam("live")).toBe("live");
    expect(parseFeedTarget(feedParam("preview"))).toBe("preview");
    expect(parseFeedTarget(feedParam("live"))).toBe("live");
  });
});

describe("pollDelayMs (live feed cadence)", () => {
  it("polls fast while any row is building (catch building → successful live)", () => {
    expect(pollDelayMs([{ status: "successful" }, { status: "building" }])).toBe(2_500);
  });
  it("idles slowly when everything is settled", () => {
    expect(pollDelayMs([{ status: "successful" }, { status: "failed" }])).toBe(20_000);
    expect(pollDelayMs([])).toBe(20_000);
  });
});

describe("syncInFlight (re-sync concurrency guard)", () => {
  const now = 1_000_000_000_000;
  it("treats a fresh building row as in-flight (blocks a concurrent re-sync)", () => {
    expect(syncInFlight(now - 10_000, now)).toBe(true);
  });
  it("treats a stale building row as an orphan (does NOT block — timed-out run)", () => {
    expect(syncInFlight(now - SYNC_INFLIGHT_MS - 1, now)).toBe(false);
  });
  it("is not in flight when there's no building row", () => {
    expect(syncInFlight(null, now)).toBe(false);
  });
});

describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  it("reads under a minute as 'just now'", () => {
    expect(timeAgo(now - 30_000, now)).toBe("just now");
  });
  it("steps through minutes, hours, days", () => {
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("formatDurationMs", () => {
  it("uses ms under a second", () => {
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(412)).toBe("412ms");
  });
  it("uses one-decimal seconds under a minute, dropping a trailing .0", () => {
    expect(formatDurationMs(1409)).toBe("1.4s");
    expect(formatDurationMs(3000)).toBe("3s");
    expect(formatDurationMs(59_940)).toBe("59.9s");
  });
  it("uses m + zero-padded s from a minute up", () => {
    expect(formatDurationMs(60_000)).toBe("1m 00s");
    expect(formatDurationMs(125_000)).toBe("2m 05s");
  });
});

describe("triggerLabel (feed byline)", () => {
  it("labels webhook syncs as GitHub push, never Manual Update", () => {
    expect(triggerLabel("webhook", null)).toBe("GitHub push");
  });
  it("prefers the actor's name for connect/manual syncs", () => {
    expect(triggerLabel("manual", "Jeff Loiselle")).toBe("Jeff Loiselle");
    expect(triggerLabel("connect", "Jeff Loiselle")).toBe("Jeff Loiselle");
  });
  it("keeps the legacy fallback for pre-column rows", () => {
    expect(triggerLabel(null, null)).toBe("Manual Update");
  });
});

describe("triggerDetail (expanded panel)", () => {
  it("describes each trigger mechanism", () => {
    expect(triggerDetail("webhook")).toBe("GitHub push (auto-sync)");
    expect(triggerDetail("manual")).toBe("Manual re-sync");
    expect(triggerDetail("connect")).toBe("Repository connected");
    expect(triggerDetail(null)).toBe("—");
  });
});
