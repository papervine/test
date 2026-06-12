import { describe, it, expect } from "vitest";
import { formatElapsed } from "../../src/lib/format-elapsed";

// The Activity feed's live "active counter" on an in-flight sync renders this. It must read
// as a steady ticking clock (m:ss), not a finished-sync duration.
describe("formatElapsed", () => {
  it("formats sub-minute elapsed as 0:ss with a padded seconds field", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_000)).toBe("0:07");
    expect(formatElapsed(59_000)).toBe("0:59");
  });

  it("rolls into minutes", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(102_000)).toBe("1:42");
    expect(formatElapsed(600_000)).toBe("10:00");
  });

  it("floors partial seconds (a ticking clock shouldn't round up early)", () => {
    expect(formatElapsed(7_900)).toBe("0:07");
  });

  it("clamps a negative input (client/server clock skew) to 0:00", () => {
    expect(formatElapsed(-3_000)).toBe("0:00");
  });
});
