import { describe, it, expect } from "vitest";
import {
  PRESENCE_COLORS,
  anonymousIdentity,
  presenceColor,
  presenceIdentity,
} from "@/components/editor/collab/presence";

// Editor presence identity (SPEC §9.2): who a remote caret and roster avatar say you are. The
// promise worth pinning is stability — the same person is the same colour in every browser, every
// reload and every room — because the alternative (a pseudonym keyed on the Yjs clientID) both hid
// who was typing and let two collaborators land on one name AND colour.

describe("presenceIdentity", () => {
  it("uses the signed-in user's real name", () => {
    expect(presenceIdentity({ id: "u_1", name: "Ada Lovelace" }).name).toBe("Ada Lovelace");
  });

  it("is stable for a user across calls", () => {
    const a = presenceIdentity({ id: "u_1", name: "Ada" });
    const b = presenceIdentity({ id: "u_1", name: "Ada" });
    expect(a).toEqual(b);
  });

  it("keys the colour on the user id, not the name", () => {
    // A rename must not repaint someone's caret — the colour is how you recognize them.
    expect(presenceIdentity({ id: "u_1", name: "Ada" }).color).toBe(
      presenceIdentity({ id: "u_1", name: "Ada L." }).color,
    );
  });

  it("gives two different users different identities", () => {
    const a = presenceIdentity({ id: "u_1", name: "Ada" });
    const b = presenceIdentity({ id: "u_2", name: "Grace" });
    expect(a.name).not.toBe(b.name);
    expect(a.color).not.toBe(b.color);
  });

  it("falls back to a generic label rather than an empty caret bubble", () => {
    expect(presenceIdentity({ id: "u_1", name: "" }).name).toBe("Editor");
    expect(presenceIdentity({ id: "u_1", name: "   " }).name).toBe("Editor");
    expect(presenceIdentity({ id: "u_1", name: null }).name).toBe("Editor");
    expect(presenceIdentity({ id: "u_1" }).name).toBe("Editor");
  });

  it("always resolves to a colour from the palette", () => {
    for (const id of ["u_1", "u_2", "", "a".repeat(200), "🙂", "user|weird:id"]) {
      expect(PRESENCE_COLORS).toContain(presenceIdentity({ id, name: "X" }).color);
    }
  });
});

describe("presenceColor", () => {
  it("is deterministic — the same seed maps to the same colour every time", () => {
    expect(presenceColor("user_abc")).toBe(presenceColor("user_abc"));
  });

  it("spreads real-shaped ids across most of the palette", () => {
    // Not a distribution guarantee, just a smoke check that the hash isn't degenerate (an
    // accidental `h * 16777619` overflow, say, collapses everything onto one or two colours).
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => presenceColor(`cuid_${i}_x8f2`)),
    );
    expect(seen.size).toBeGreaterThan(PRESENCE_COLORS.length / 2);
  });
});

describe("anonymousIdentity", () => {
  it("is stable per client id and stays in the palette", () => {
    expect(anonymousIdentity(7)).toEqual(anonymousIdentity(7));
    expect(PRESENCE_COLORS).toContain(anonymousIdentity(7).color);
  });

  it("handles a negative client id (Yjs ids are arbitrary integers)", () => {
    const id = anonymousIdentity(-3);
    expect(id.name).toBeTruthy();
    expect(PRESENCE_COLORS).toContain(id.color);
  });
});
