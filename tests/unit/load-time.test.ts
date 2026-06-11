import { describe, it, expect } from "vitest";
import { formatLoadTime } from "@/lib/load-time";

describe("formatLoadTime", () => {
  it("formats sub-second loads as whole milliseconds", () => {
    expect(formatLoadTime(131).label).toBe("131ms");
    expect(formatLoadTime(0).label).toBe("0ms");
    expect(formatLoadTime(999.6).label).toBe("1000ms");
  });

  it("formats >=1s loads as one-decimal seconds", () => {
    expect(formatLoadTime(1000).label).toBe("1.0s");
    expect(formatLoadTime(6040).label).toBe("6.0s");
    expect(formatLoadTime(2500).label).toBe("2.5s");
  });

  it("tones by threshold: <1s good, <3s ok, else slow", () => {
    expect(formatLoadTime(800).tone).toBe("good");
    expect(formatLoadTime(1500).tone).toBe("ok");
    expect(formatLoadTime(2999).tone).toBe("ok");
    expect(formatLoadTime(3000).tone).toBe("slow");
    expect(formatLoadTime(9000).tone).toBe("slow");
  });

  it("maps tone to matching dot/text color classes", () => {
    expect(formatLoadTime(800).dotClass).toBe("bg-emerald-400");
    expect(formatLoadTime(800).textClass).toBe("text-emerald-400");
    expect(formatLoadTime(3000).dotClass).toBe("bg-red-400");
    expect(formatLoadTime(3000).textClass).toBe("text-red-400");
  });

  it("clamps negative input (clock skew) to zero", () => {
    expect(formatLoadTime(-50).label).toBe("0ms");
    expect(formatLoadTime(-50).tone).toBe("good");
  });
});
