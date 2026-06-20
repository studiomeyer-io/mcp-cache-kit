import { describe, it, expect } from "vitest";
import {
  withCacheHints,
  validateCacheHints,
  parseCacheHints,
  isCacheScope,
  isValidTtlMs,
  publicHints,
  privateHints,
  CacheScope,
} from "../src/index.js";

describe("withCacheHints (server-side)", () => {
  it("attaches ttlMs + cacheScope as top-level fields", () => {
    const result = { tools: [{ name: "ping" }] };
    const out = withCacheHints(result, { ttlMs: 60_000, cacheScope: CacheScope.Public });
    expect(out.ttlMs).toBe(60_000);
    expect(out.cacheScope).toBe("public");
    expect(out.tools).toEqual([{ name: "ping" }]);
  });

  it("does not mutate the input result", () => {
    const result = { contents: [] };
    const out = withCacheHints(result, { ttlMs: 1000, cacheScope: CacheScope.Private });
    expect(result).not.toHaveProperty("ttlMs");
    expect(out).not.toBe(result);
  });

  it("floors fractional ttlMs to integer milliseconds", () => {
    const out = withCacheHints({}, { ttlMs: 1500.9, cacheScope: CacheScope.Public });
    expect(out.ttlMs).toBe(1500);
  });

  it("accepts a 0 TTL (immediately stale is a valid hint)", () => {
    const out = withCacheHints({}, { ttlMs: 0, cacheScope: CacheScope.Public });
    expect(out.ttlMs).toBe(0);
  });

  it("rejects negative ttlMs", () => {
    expect(() => withCacheHints({}, { ttlMs: -1, cacheScope: CacheScope.Public })).toThrow(
      /ttlMs must be a finite number >= 0/,
    );
  });

  it("rejects non-finite ttlMs (NaN, Infinity)", () => {
    expect(() => withCacheHints({}, { ttlMs: NaN, cacheScope: CacheScope.Public })).toThrow(
      TypeError,
    );
    expect(() =>
      withCacheHints({}, { ttlMs: Infinity, cacheScope: CacheScope.Public }),
    ).toThrow(TypeError);
  });

  it("rejects an invalid cacheScope", () => {
    expect(() =>
      // @ts-expect-error intentionally bad value
      withCacheHints({}, { ttlMs: 1000, cacheScope: "per-user" }),
    ).toThrow(/cacheScope must be one of "public" \| "private"/);
  });

  it("rejects a non-object result", () => {
    // @ts-expect-error intentionally bad value
    expect(() => withCacheHints(null, { ttlMs: 1, cacheScope: CacheScope.Public })).toThrow(
      /requires a result object/,
    );
  });
});

describe("validateCacheHints", () => {
  it("returns normalized hints", () => {
    expect(validateCacheHints({ ttlMs: 10.7, cacheScope: "private" })).toEqual({
      ttlMs: 10,
      cacheScope: "private",
    });
  });
});

describe("publicHints / privateHints", () => {
  it("build the right scope", () => {
    expect(publicHints(5000)).toEqual({ ttlMs: 5000, cacheScope: "public" });
    expect(privateHints(5000)).toEqual({ ttlMs: 5000, cacheScope: "private" });
  });
});

describe("type guards", () => {
  it("isCacheScope", () => {
    expect(isCacheScope("public")).toBe(true);
    expect(isCacheScope("private")).toBe(true);
    expect(isCacheScope("per-user")).toBe(false);
    expect(isCacheScope(undefined)).toBe(false);
    expect(isCacheScope(5)).toBe(false);
  });

  it("isValidTtlMs", () => {
    expect(isValidTtlMs(0)).toBe(true);
    expect(isValidTtlMs(1000)).toBe(true);
    expect(isValidTtlMs(-1)).toBe(false);
    expect(isValidTtlMs(NaN)).toBe(false);
    expect(isValidTtlMs(Infinity)).toBe(false);
    expect(isValidTtlMs("1000")).toBe(false);
  });
});

describe("parseCacheHints (client-side, fail-safe)", () => {
  it("parses a well-formed result", () => {
    const parsed = parseCacheHints({ tools: [], ttlMs: 1000, cacheScope: "public" });
    expect(parsed).toEqual({ ok: true, hints: { ttlMs: 1000, cacheScope: "public" } });
  });

  it("non-object → not-an-object", () => {
    expect(parseCacheHints(null)).toMatchObject({ ok: false, reason: "not-an-object" });
    expect(parseCacheHints("x")).toMatchObject({ ok: false, reason: "not-an-object" });
  });

  it("no hints at all → missing-fields", () => {
    expect(parseCacheHints({ tools: [] })).toMatchObject({
      ok: false,
      reason: "missing-fields",
    });
  });

  it("partial hints (only one field) → missing-fields", () => {
    expect(parseCacheHints({ ttlMs: 1000 })).toMatchObject({
      ok: false,
      reason: "missing-fields",
    });
    expect(parseCacheHints({ cacheScope: "public" })).toMatchObject({
      ok: false,
      reason: "missing-fields",
    });
  });

  it("invalid ttl → invalid-ttl", () => {
    expect(parseCacheHints({ ttlMs: -5, cacheScope: "public" })).toMatchObject({
      ok: false,
      reason: "invalid-ttl",
    });
    expect(parseCacheHints({ ttlMs: "1000", cacheScope: "public" })).toMatchObject({
      ok: false,
      reason: "invalid-ttl",
    });
  });

  it("invalid scope → invalid-scope", () => {
    expect(parseCacheHints({ ttlMs: 1000, cacheScope: "per-session" })).toMatchObject({
      ok: false,
      reason: "invalid-scope",
    });
  });

  it("never throws on hostile input", () => {
    expect(() => parseCacheHints(Symbol("x") as unknown)).not.toThrow();
    expect(() => parseCacheHints([1, 2, 3])).not.toThrow();
  });
});
