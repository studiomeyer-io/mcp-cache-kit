import { describe, it, expect } from "vitest";
import {
  McpResultCache,
  withCacheHints,
  CacheScope,
  deriveScopeKey,
  cacheSafety,
  parseCacheHints,
} from "../src/index.js";

function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, set: (v: number) => (now = v) };
}

// Regressions for the adversarial review of 2026-06-20.

describe("CRITICAL: non-string scopeId must fail closed (no cross-scope leak)", () => {
  it("deriveScopeKey refuses number / array / object scopeIds (no .length coercion)", () => {
    // (123).length is undefined → the old code produced "private:undefined:123",
    // voiding the length-prefix collision defense. Must be undefined now.
    expect(deriveScopeKey(CacheScope.Private, 7 as unknown as string)).toBeUndefined();
    expect(deriveScopeKey(CacheScope.Private, ["a"] as unknown as string)).toBeUndefined();
    expect(
      deriveScopeKey(CacheScope.Private, { toString: () => "a" } as unknown as string),
    ).toBeUndefined();
    expect(deriveScopeKey(CacheScope.Private, "a")).toBe("private:1:a");
  });

  it("an array scopeId cannot collide with a same-length string scopeId", () => {
    // ["a"].length === "a".length === 1 — old code collided both to "private:1:a".
    expect(deriveScopeKey(CacheScope.Private, ["a"] as unknown as string)).toBeUndefined();
    expect(deriveScopeKey(CacheScope.Private, "a")).toBe("private:1:a");
  });

  it("cacheSafety refuses a private result with a non-string scopeId", () => {
    const d = cacheSafety(
      { ttlMs: 1000, cacheScope: "private" },
      { scopeId: 7 as unknown as string },
    );
    expect(d.cacheable).toBe(false);
  });

  it("the cache never stores or serves a private entry under a numeric scopeId", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const req = { method: "resources/read", params: { uri: "x" } };
    const secret = withCacheHints(
      { contents: [{ text: "TENANT-7-SECRET" }] },
      { ttlMs: 60_000, cacheScope: CacheScope.Private },
    );
    const r = cache.set(req, secret, { scopeId: 7 as unknown as string });
    expect(r.stored).toBe(false); // refused: a number is not a valid identity
    // and nobody — string "7" or number 7 — can read it back
    expect(cache.get(req, { scopeId: "7" }).hit).toBe(false);
    expect(cache.get(req, { scopeId: 7 as unknown as string }).hit).toBe(false);
  });
});

describe("LOW: parseCacheHints never throws", () => {
  it("returns ok:false for a result whose field is a throwing getter", () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "ttlMs", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    let res: ReturnType<typeof parseCacheHints> | undefined;
    expect(() => {
      res = parseCacheHints(hostile);
    }).not.toThrow();
    expect(res?.ok).toBe(false);
  });
});

describe("LOW: a caller's own private entry wins over a shadowing public one", () => {
  it("get() returns the private value for the owner, public for everyone else", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const req = { method: "tools/list" };
    cache.set(
      req,
      withCacheHints({ tools: ["public"] }, { ttlMs: 60_000, cacheScope: CacheScope.Public }),
    );
    cache.set(
      req,
      withCacheHints({ tools: ["private-a"] }, { ttlMs: 60_000, cacheScope: CacheScope.Private }),
      { scopeId: "user-a" },
    );
    const a = cache.get<{ tools: string[] }>(req, { scopeId: "user-a" });
    expect(a.hit).toBe(true);
    if (a.hit) expect(a.value.tools).toEqual(["private-a"]);
    const b = cache.get<{ tools: string[] }>(req, { scopeId: "user-b" });
    expect(b.hit).toBe(true);
    if (b.hit) expect(b.value.tools).toEqual(["public"]);
  });
});
