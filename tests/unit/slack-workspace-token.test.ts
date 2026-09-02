import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Regression: `botTokenFor` must never THROW on an unreadable stored token.
//
// Found live (2026-09-02) driving a real signed Slack delivery through the events route
// with a hand-seeded workspace row: the agent-run task calls botTokenFor *before* its
// try/catch, so a `decryptSecret` throw crashed the run unhandled and left the agent_run
// row stuck at `queued` forever — which reads to the user as a bot that silently ignored
// them. Null instead makes it a visible failed run telling them to reconnect.
const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.PAPERVINE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

// The row shape botTokenFor reads; only botTokenEnc matters here.
const row = (botTokenEnc: string) =>
  ({ botTokenEnc }) as Parameters<
    Awaited<ReturnType<typeof loadModule>>["botTokenFor"]
  >[0];

async function loadModule() {
  return import("../../src/lib/slack-workspaces");
}

describe("botTokenFor", () => {
  it("round-trips a token encrypted with the current key", async () => {
    const { encryptSecret } = await import("../../src/lib/crypto");
    const { botTokenFor } = await loadModule();
    expect(botTokenFor(row(encryptSecret("xoxb-real-token")))).toBe("xoxb-real-token");
  });

  it("returns null for a value that isn't an AES-GCM envelope at all", async () => {
    const { botTokenFor } = await loadModule();
    // base64 "fake" — short enough that setAuthTag itself throws.
    expect(botTokenFor(row("ZmFrZQ=="))).toBeNull();
    expect(botTokenFor(row(""))).toBeNull();
    expect(botTokenFor(row("not-base64-at-all!!"))).toBeNull();
  });

  it("returns null when the encryption key has rotated since the token was stored", async () => {
    const { encryptSecret } = await import("../../src/lib/crypto");
    const stored = encryptSecret("xoxb-real-token");
    // A different key must fail the auth tag rather than yield garbage.
    process.env.PAPERVINE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    vi.resetModules();
    const { botTokenFor } = await loadModule();
    expect(botTokenFor(row(stored))).toBeNull();
  });

  it("returns null rather than throwing when no key is configured", async () => {
    delete process.env.PAPERVINE_ENCRYPTION_KEY;
    vi.resetModules();
    const { botTokenFor } = await loadModule();
    expect(botTokenFor(row("ZmFrZQ=="))).toBeNull();
  });
});
