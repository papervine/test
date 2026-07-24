import { describe, it, expect } from "vitest";
import {
  authFieldKeys,
  clearCredentials,
  readCredentials,
  storageKey,
  writeCredentials,
  type CredentialStore,
  type TryItAuth,
} from "@papervine/renderer/lib/try-it-credentials";

// The Try-it playground remembers credentials for the tab so a Basic-auth spec isn't retyped on
// every endpoint page (each one mounts its own modal, so component state alone is lost on
// navigation). This is that store's pure core: which fields belong to a scheme, what round-trips,
// and — the parts that matter for a *credential* store — that clearing really clears, that a
// foreign or corrupt entry can't inject fields into a request, and that broken storage degrades
// to "don't remember" rather than throwing inside the modal.

function fakeStore(initial: Record<string, string> = {}): CredentialStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const basic: TryItAuth = { key: "BasicAuth", type: "basic" };
const SPEC = "openapi.yaml";

describe("authFieldKeys", () => {
  it("gives basic a username and a password", () => {
    expect(authFieldKeys(basic)).toEqual(["BasicAuth.username", "BasicAuth.password"]);
  });

  it("gives apiKey a single value, and token schemes a token", () => {
    expect(authFieldKeys({ key: "k", type: "apiKey", in: "header", name: "X-Api-Key" })).toEqual([
      "k.value",
    ]);
    expect(authFieldKeys({ key: "k", type: "bearer" })).toEqual(["k.token"]);
    expect(authFieldKeys({ key: "k", type: "oauth2" })).toEqual(["k.token"]);
  });
});

describe("credential round-trip", () => {
  it("restores what was written, for the same spec", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], {
      "BasicAuth.username": "ada",
      "BasicAuth.password": "hunter2",
    });
    expect(readCredentials(store, SPEC, [basic])).toEqual({
      "BasicAuth.username": "ada",
      "BasicAuth.password": "hunter2",
    });
  });

  it("scopes by spec, so a second spec (or a co-hosted tenant) doesn't inherit them", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "ada" });
    expect(readCredentials(store, "other/openapi.yaml", [basic])).toEqual({});
    expect(storageKey(SPEC)).not.toBe(storageKey("other/openapi.yaml"));
  });

  it("drops empty values and removes the entry once nothing is left", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], {
      "BasicAuth.username": "ada",
      "BasicAuth.password": "",
    });
    expect(readCredentials(store, SPEC, [basic])).toEqual({ "BasicAuth.username": "ada" });

    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "", "BasicAuth.password": "" });
    expect(store.data.has(storageKey(SPEC))).toBe(false);
    expect(readCredentials(store, SPEC, [basic])).toEqual({});
  });

  it("clears on request", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], { "BasicAuth.username": "ada" });
    clearCredentials(store, SPEC);
    expect(readCredentials(store, SPEC, [basic])).toEqual({});
  });

  it("persists only fields the current schemes declare", () => {
    const store = fakeStore();
    writeCredentials(store, SPEC, [basic], {
      "BasicAuth.username": "ada",
      "OldScheme.token": "leftover",
    });
    expect(JSON.parse(store.data.get(storageKey(SPEC))!)).toEqual({ "BasicAuth.username": "ada" });
  });
});

describe("hostile and unusable storage", () => {
  it("ignores stored keys the schemes don't declare", () => {
    const store = fakeStore({
      [storageKey(SPEC)]: JSON.stringify({ "BasicAuth.username": "ada", "Evil.token": "x" }),
    });
    expect(readCredentials(store, SPEC, [basic])).toEqual({ "BasicAuth.username": "ada" });
  });

  it("ignores non-string values and corrupt or non-object entries", () => {
    expect(
      readCredentials(
        fakeStore({ [storageKey(SPEC)]: JSON.stringify({ "BasicAuth.username": { a: 1 } }) }),
        SPEC,
        [basic],
      ),
    ).toEqual({});
    expect(readCredentials(fakeStore({ [storageKey(SPEC)]: "not json" }), SPEC, [basic])).toEqual({});
    expect(readCredentials(fakeStore({ [storageKey(SPEC)]: "[1,2]" }), SPEC, [basic])).toEqual({});
  });

  it("degrades to not remembering when storage is absent or throws", () => {
    const throwing: CredentialStore = {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("disabled");
      },
    };
    expect(readCredentials(null, SPEC, [basic])).toEqual({});
    expect(readCredentials(throwing, SPEC, [basic])).toEqual({});
    expect(() => writeCredentials(throwing, SPEC, [basic], { "BasicAuth.username": "ada" })).not.toThrow();
    expect(() => writeCredentials(null, SPEC, [basic], {})).not.toThrow();
    expect(() => clearCredentials(throwing, SPEC)).not.toThrow();
  });

  it("reads nothing when the operation declares no security", () => {
    const store = fakeStore({ [storageKey(SPEC)]: JSON.stringify({ "BasicAuth.username": "ada" }) });
    expect(readCredentials(store, SPEC, [])).toEqual({});
  });
});
