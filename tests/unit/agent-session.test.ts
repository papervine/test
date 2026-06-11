import { describe, it, expect } from "vitest";
import { agentSessionId, firstForwardedIp } from "@/lib/agent-session";

const claude = {
  agent: "Claude",
  userAgent: "Claude-User/1.0",
  ip: "203.0.113.7",
};

describe("agentSessionId", () => {
  it("collapses one client's repeated calls into a single id (the bug fix)", () => {
    // The reason "Agent Visitors" read 3 for 3 read_page calls: a fresh id per request.
    // Identical client inputs must now yield the SAME id, so distinct() counts 1 visitor.
    const a = agentSessionId(claude);
    const b = agentSessionId(claude);
    const c = agentSessionId(claude);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("honors a client-supplied Mcp-Session-Id verbatim (trimmed)", () => {
    expect(agentSessionId({ ...claude, mcpSessionId: "sess-abc-123" })).toBe("sess-abc-123");
    expect(agentSessionId({ ...claude, mcpSessionId: "  sess-abc-123  " })).toBe("sess-abc-123");
  });

  it("ignores a blank Mcp-Session-Id and falls back to the fingerprint", () => {
    expect(agentSessionId({ ...claude, mcpSessionId: "" })).toBe(agentSessionId(claude));
    expect(agentSessionId({ ...claude, mcpSessionId: "   " })).toBe(agentSessionId(claude));
    expect(agentSessionId({ ...claude, mcpSessionId: null })).toBe(agentSessionId(claude));
  });

  it("keeps distinct clients distinct (so we don't collapse every Claude into one)", () => {
    const byIp = agentSessionId({ ...claude, ip: "198.51.100.2" });
    const byUa = agentSessionId({ ...claude, userAgent: "ChatGPT-User/1.0" });
    const byAgent = agentSessionId({ ...claude, agent: "ChatGPT" });
    expect(byIp).not.toBe(agentSessionId(claude));
    expect(byUa).not.toBe(agentSessionId(claude));
    expect(byAgent).not.toBe(agentSessionId(claude));
  });

  it("is stable with no time component — same client, any later call, same id", () => {
    // No date in the fingerprint, mirroring the human localStorage UUID: a client that
    // returns next week is still one visitor, not a new one each day.
    const id1 = agentSessionId({ ...claude, ip: null, userAgent: null });
    const id2 = agentSessionId({ ...claude, ip: null, userAgent: null });
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^agent_[0-9a-f]{32}$/);
  });
});

describe("firstForwardedIp", () => {
  it("takes the originating client (first hop) and trims it", () => {
    expect(firstForwardedIp("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe("203.0.113.7");
    expect(firstForwardedIp("  203.0.113.7  ")).toBe("203.0.113.7");
    expect(firstForwardedIp("203.0.113.7")).toBe("203.0.113.7");
  });

  it("returns null for missing/empty headers", () => {
    expect(firstForwardedIp(null)).toBeNull();
    expect(firstForwardedIp(undefined)).toBeNull();
    expect(firstForwardedIp("")).toBeNull();
    expect(firstForwardedIp("  ")).toBeNull();
  });
});
