import { describe, it, expect } from "vitest";
import { isNetworkError } from "@/lib/dashboard-error";

// The dashboard error boundary (SPEC §10.4) shows "connection dropped, retry" copy for
// dropped-fetch errors and the generic "something went wrong" otherwise. This guards that
// branch: the cross-browser network-error messages must classify as network, real app
// errors must not (or we'd tell a user with a genuine bug to "just retry").
describe("isNetworkError", () => {
  it("matches the dropped-RSC-fetch messages across browsers", () => {
    expect(isNetworkError("TypeError: Failed to fetch")).toBe(true); // Chrome — the PAPERVINE-4 crash
    expect(isNetworkError("Failed to fetch")).toBe(true);
    expect(isNetworkError("Load failed")).toBe(true); // Safari
    expect(isNetworkError("NetworkError when attempting to fetch resource.")).toBe(true); // Firefox
  });

  it("is case-insensitive", () => {
    expect(isNetworkError("FAILED TO FETCH")).toBe(true);
  });

  it("does not match genuine application errors", () => {
    expect(isNetworkError("Cannot read properties of undefined (reading 'map')")).toBe(false);
    expect(isNetworkError("Hydration failed because the server rendered HTML didn't match")).toBe(false);
  });

  it("is safe on empty/missing messages", () => {
    expect(isNetworkError("")).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
