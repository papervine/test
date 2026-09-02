import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyNangoSignature, parseNangoDelivery } from "../../src/lib/integrations/nango-webhook";
import {
  findConnector,
  isConnectableProvider,
  connectorByProviderConfigKey,
  CONNECTORS,
} from "../../src/lib/integrations/catalog";

// The two guards on connections arriving from Nango (SPEC §10.2): the HMAC over the raw
// body, and the classifier that decides what we act on. Pure — the route is a thin shell,
// the same split as github-webhook.ts and slack-events.ts.

const KEY = "nango-webhook-signing-key";
const sign = (body: string, key = KEY) =>
  createHmac("sha256", key).update(body).digest("hex");

describe("verifyNangoSignature", () => {
  it("accepts a correctly signed body", () => {
    const body = '{"type":"auth"}';
    expect(verifyNangoSignature(body, sign(body), KEY)).toBe(true);
  });

  it("rejects a body that changed after signing", () => {
    expect(verifyNangoSignature('{"tampered":true}', sign('{"type":"auth"}'), KEY)).toBe(false);
  });

  it("rejects the wrong signing key", () => {
    const body = "{}";
    expect(verifyNangoSignature(body, sign(body, "someone-elses-key"), KEY)).toBe(false);
  });

  it("rejects missing pieces and short signatures without throwing", () => {
    const body = "{}";
    expect(verifyNangoSignature(body, null, KEY)).toBe(false);
    expect(verifyNangoSignature(body, sign(body), undefined)).toBe(false);
    // A short/garbage signature must be a clean false, not a timingSafeEqual throw.
    expect(verifyNangoSignature(body, "abc", KEY)).toBe(false);
  });
});

describe("parseNangoDelivery", () => {
  const creation = {
    type: "auth",
    operation: "creation",
    success: true,
    connectionId: "conn_123",
    providerConfigKey: "google-drive",
    tags: { organization_id: "org_1", end_user_id: "user_1" },
  };

  it("parses a connection creation, carrying the org back from the connect session", () => {
    expect(parseNangoDelivery(creation)).toEqual({
      kind: "connection_created",
      connectionId: "conn_123",
      providerConfigKey: "google-drive",
      organizationId: "org_1",
    });
  });

  it("reads the org from the endUser shape their docs also show", () => {
    const alt = { ...creation, tags: undefined, endUser: { organizationId: "org_2" } };
    expect(parseNangoDelivery(alt)).toMatchObject({ organizationId: "org_2" });
  });

  it("parses a deletion", () => {
    expect(parseNangoDelivery({ type: "auth", operation: "deletion", connectionId: "c1" })).toEqual({
      kind: "connection_deleted",
      connectionId: "c1",
    });
  });

  it("ignores a FAILED authorization — it reports the same type and operation", () => {
    // Recording this would create a connection row for an authorization that never
    // completed, and the agent would then offer tools that 401 on every call.
    expect(parseNangoDelivery({ ...creation, success: false })).toBeNull();
  });

  it("ignores a creation it can't attribute to a tenant", () => {
    expect(parseNangoDelivery({ ...creation, tags: {} })).toBeNull();
    expect(parseNangoDelivery({ ...creation, providerConfigKey: undefined })).toBeNull();
    expect(parseNangoDelivery({ ...creation, connectionId: undefined })).toBeNull();
  });

  it("returns null rather than throwing on other webhook types and malformed input", () => {
    expect(parseNangoDelivery({ type: "sync", operation: "success" })).toBeNull();
    expect(parseNangoDelivery({ type: "forward", payload: {} })).toBeNull();
    expect(parseNangoDelivery(null)).toBeNull();
    expect(parseNangoDelivery({})).toBeNull();
    expect(parseNangoDelivery("nonsense")).toBeNull();
  });
});

describe("connector catalog (the allowlist)", () => {
  it("only offers providers it knows — an unknown one can't open a connect session", () => {
    expect(isConnectableProvider("google-drive")).toBe(true);
    expect(isConnectableProvider("salesforce")).toBe(false);
    expect(isConnectableProvider("../../etc/passwd")).toBe(false);
    expect(isConnectableProvider("")).toBe(false);
  });

  it("maps Nango's integration id back to ours, so renaming there isn't a break here", () => {
    expect(connectorByProviderConfigKey("google-drive")?.id).toBe("google-drive");
    expect(connectorByProviderConfigKey("unknown")).toBeUndefined();
  });

  it("google-drive is connectable and has tools", () => {
    const drive = findConnector("google-drive");
    expect(drive?.hasTools).toBe(true);
    expect(drive?.capability).toBeTruthy();
  });

  it("every catalog entry is internally consistent", () => {
    for (const c of CONNECTORS) {
      expect(c.id).toBeTruthy();
      expect(c.providerConfigKey).toBeTruthy();
      expect(c.capability).toBeTruthy();
      // Ids are used in URLs and as tool-set keys — keep them slug-shaped.
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
