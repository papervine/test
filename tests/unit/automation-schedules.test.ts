import { describe, expect, it } from "vitest";
import { syncAutomationSchedule } from "@/lib/automations/runs";
import type { AutomationExecutor, CronSyncInput } from "@/lib/automations/executor";

// The adapter's convergence contract, faked: register (returning an id) when a
// schedule is wanted, null when not. Mirrors getExecutor().syncCronSchedule.
function fakeSync() {
  const calls: CronSyncInput[] = [];
  const executor: Pick<AutomationExecutor, "syncCronSchedule"> = {
    async syncCronSchedule(input) {
      calls.push(input);
      const wanted =
        input.enabled && input.triggerType === "cron" && !!input.cronExpression?.trim();
      return wanted ? `sched_${input.automationId}` : null;
    },
  };
  return { executor, calls };
}

const CRON_AUTO = {
  id: "a1",
  enabled: true,
  triggerType: "cron",
  cronExpression: "0 13 * * 1",
  executorScheduleId: null as string | null,
};

describe("syncAutomationSchedule", () => {
  it("registers a schedule for an enabled cron automation and persists the handle", async () => {
    const { executor } = fakeSync();
    let persisted: string | null | undefined;
    const res = await syncAutomationSchedule(CRON_AUTO, {
      executor,
      persist: async (id) => void (persisted = id),
    });
    expect(res).toEqual({ ok: true });
    expect(persisted).toBe("sched_a1");
  });

  it("skips the persist write when the handle is unchanged", async () => {
    const { executor } = fakeSync();
    let persistCalls = 0;
    await syncAutomationSchedule(
      { ...CRON_AUTO, executorScheduleId: "sched_a1" },
      { executor, persist: async () => void persistCalls++ },
    );
    expect(persistCalls).toBe(0);
  });

  it("deregisters (persists null) when the automation no longer wants a schedule", async () => {
    const { executor, calls } = fakeSync();
    let persisted: string | null = "unset" as unknown as null;
    // Disabled…
    await syncAutomationSchedule(
      { ...CRON_AUTO, enabled: false, executorScheduleId: "sched_a1" },
      { executor, persist: async (id) => void (persisted = id) },
    );
    expect(persisted).toBeNull();
    // …and trigger-type changes both pass the existing handle so the adapter can delete it.
    await syncAutomationSchedule(
      { ...CRON_AUTO, triggerType: "content_update", executorScheduleId: "sched_a1" },
      { executor, persist: async () => undefined },
    );
    expect(calls.every((c) => c.existingScheduleId === "sched_a1")).toBe(true);
  });

  it("is a no-op without an executor (config still saves; banner covers messaging)", async () => {
    let persistCalls = 0;
    const res = await syncAutomationSchedule(CRON_AUTO, {
      executor: null,
      persist: async () => void persistCalls++,
    });
    expect(res).toEqual({ ok: true });
    expect(persistCalls).toBe(0);
  });

  it("reports executor failures without throwing (caller warns, config stays saved)", async () => {
    const res = await syncAutomationSchedule(CRON_AUTO, {
      executor: {
        syncCronSchedule: () => Promise.reject(new Error("cloud says no")),
      },
      persist: async () => undefined,
    });
    expect(res).toEqual({ ok: false, error: "cloud says no" });
  });
});
