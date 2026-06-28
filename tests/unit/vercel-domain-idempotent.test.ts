import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addProjectDomain } from "@/lib/vercel-domains";

// `addProjectDomain` must be idempotent: re-attaching a host already on OUR Vercel project (which
// Vercel answers with the same `409 domain_already_in_use` it uses for a *different* project) is a
// no-op success, not an error. Without this, re-saving an unchanged domain — e.g. toggling the
// /docs subpath — wrongly fails in prod (SPEC §2). We disambiguate by reading our own project's
// domain list, so these mock the POST attach + the follow-up GET.

type MockRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const res = (status: number, body: unknown = {}): MockRes => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.stubEnv("VERCEL_TOKEN", "tok");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Mock fetch: POSTs (the attach) get `post`, GETs (the ownership re-check) get `get`. */
function mockFetch(post: MockRes, get?: MockRes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST" ? post : (get ?? res(404)),
    ),
  );
}

describe("addProjectDomain idempotency", () => {
  it("returns ok when the attach succeeds outright", async () => {
    mockFetch(res(200));
    expect(await addProjectDomain("docs.acme.com")).toEqual({ ok: true });
  });

  it("treats a 409 for a host already on OUR project as success", async () => {
    mockFetch(res(409, { error: { code: "domain_already_in_use" } }), res(200));
    expect(await addProjectDomain("docs.acme.com")).toEqual({ ok: true });
  });

  it("treats a 409 for a host on ANOTHER project as a real error", async () => {
    mockFetch(res(409, { error: { code: "domain_already_in_use" } }), res(404));
    const result = await addProjectDomain("docs.acme.com");
    expect(result.ok).toBe(false);
    expect("error" in result && result.error).toContain("another project");
  });
});
