import { describe, expect, it } from "vitest";
import {
  AUTOMATION_CATALOG,
  CRON_PRESETS,
  CUSTOM_KEY,
  getCatalogEntry,
  isValidCronExpression,
  validateAutomationConfig,
  type AutomationConfig,
} from "@/lib/automations/catalog";

const base = (over: Partial<AutomationConfig> = {}): AutomationConfig => ({
  triggerType: "content_update",
  applyMode: "auto",
  ...over,
});

describe("automation catalog integrity", () => {
  it("has unique keys and never reuses the custom sentinel", () => {
    const keys = AUTOMATION_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(CUSTOM_KEY);
  });

  it("every entry's recommended trigger is one of its allowed triggers", () => {
    for (const e of AUTOMATION_CATALOG) {
      expect(e.allowedTriggers, e.key).toContain(e.recommendedTrigger);
      expect(e.allowedTriggers.length, e.key).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty base prompt and description", () => {
    for (const e of AUTOMATION_CATALOG) {
      expect(e.basePrompt.trim().length, e.key).toBeGreaterThan(50);
      expect(e.desc.trim().length, e.key).toBeGreaterThan(0);
    }
  });

  it("cron presets are structurally valid cron expressions", () => {
    for (const p of CRON_PRESETS) expect(isValidCronExpression(p.cron), p.label).toBe(true);
  });

  it("looks up entries by key", () => {
    expect(getCatalogEntry("fix-broken-links")?.family).toBe("maintenance");
    expect(getCatalogEntry("nope")).toBeUndefined();
  });
});

describe("isValidCronExpression", () => {
  it("accepts 5-field expressions", () => {
    expect(isValidCronExpression("0 13 * * 1")).toBe(true);
    expect(isValidCronExpression("*/15 0-6 1,15 * MON")).toBe(true);
  });

  it("rejects wrong field counts and garbage", () => {
    expect(isValidCronExpression("0 13 * *")).toBe(false);
    expect(isValidCronExpression("0 13 * * * *")).toBe(false);
    expect(isValidCronExpression("every monday")).toBe(false);
    expect(isValidCronExpression("")).toBe(false);
  });
});

describe("validateAutomationConfig", () => {
  it("accepts a valid predefined config", () => {
    expect(validateAutomationConfig("fix-broken-links", base())).toEqual([]);
  });

  it("rejects unknown catalog keys outright", () => {
    expect(validateAutomationConfig("not-a-thing", base())).toEqual([
      'Unknown automation "not-a-thing".',
    ]);
  });

  it("rejects a trigger the automation doesn't offer", () => {
    // fill-gaps is cron-only per the trigger matrix.
    const errors = validateAutomationConfig(
      "fill-gaps-from-assistant-conversations",
      base({ triggerType: "content_update" }),
    );
    expect(errors.some((e) => e.includes("isn't available"))).toBe(true);
  });

  it("requires a valid cron expression for the cron trigger", () => {
    const missing = validateAutomationConfig("fix-broken-links", base({ triggerType: "cron" }));
    expect(missing.some((e) => e.includes("schedule is required"))).toBe(true);

    const bad = validateAutomationConfig(
      "fix-broken-links",
      base({ triggerType: "cron", cronExpression: "whenever" }),
    );
    expect(bad.some((e) => e.includes("5-field cron"))).toBe(true);

    const good = validateAutomationConfig(
      "fix-broken-links",
      base({ triggerType: "cron", cronExpression: "0 13 * * 1" }),
    );
    expect(good).toEqual([]);
  });

  it("requires trigger repos for the code-change trigger", () => {
    const errors = validateAutomationConfig(
      "update-from-code-changes",
      base({ triggerType: "code_change" }),
    );
    expect(errors.some((e) => e.includes("trigger repository"))).toBe(true);

    const ok = validateAutomationConfig(
      "update-from-code-changes",
      base({ triggerType: "code_change", triggerRepos: ["acme/api"] }),
    );
    expect(ok).toEqual([]);
  });

  it("rejects malformed repo references in either repo list", () => {
    const errors = validateAutomationConfig(
      "update-from-code-changes",
      base({
        triggerType: "code_change",
        triggerRepos: ["acme/api"],
        contextRepos: ["not a repo"],
      }),
    );
    expect(errors.some((e) => e.includes('"not a repo"'))).toBe(true);
  });

  it("custom automations need a name but accept any trigger", () => {
    const unnamed = validateAutomationConfig(CUSTOM_KEY, base());
    expect(unnamed.some((e) => e.includes("need a name"))).toBe(true);

    const named = validateAutomationConfig(
      CUSTOM_KEY,
      base({ triggerType: "code_change", triggerRepos: ["acme/api"] }),
      { name: "TV spot redesign" },
    );
    expect(named).toEqual([]);
  });

  it("rejects unknown apply modes", () => {
    const errors = validateAutomationConfig(
      "fix-broken-links",
      base({ applyMode: "yolo" as AutomationConfig["applyMode"] }),
    );
    expect(errors.some((e) => e.includes("apply mode"))).toBe(true);
  });
});
