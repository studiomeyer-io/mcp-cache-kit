import { describe, it, expect } from "vitest";
import {
  cacheSafety,
  assertCacheSafe,
  deriveScopeKey,
  CacheUnsafeError,
  PUBLIC_SCOPE_KEY,
  CacheScope,
} from "../src/index.js";

describe("deriveScopeKey", () => {
  it("public → shared public key regardless of scopeId", () => {
    expect(deriveScopeKey(CacheScope.Public)).toBe(PUBLIC_SCOPE_KEY);
    expect(deriveScopeKey(CacheScope.Public, "user-a")).toBe(PUBLIC_SCOPE_KEY);
  });

  it("private → undefined without scopeId (must not cache)", () => {
    expect(deriveScopeKey(CacheScope.Private)).toBeUndefined();
    expect(deriveScopeKey(CacheScope.Private, "")).toBeUndefined();
  });

  it("private → distinct keys per scopeId", () => {
    const a = deriveScopeKey(CacheScope.Private, "user-a");
    const b = deriveScopeKey(CacheScope.Private, "user-b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("private key cannot collide with the public bucket even for a tricky scopeId", () => {
    // A scopeId literally equal to the public key must NOT map onto the public bucket.
    const sneaky = deriveScopeKey(CacheScope.Private, PUBLIC_SCOPE_KEY);
    expect(sneaky).not.toBe(PUBLIC_SCOPE_KEY);
  });

  it("length-prefixing prevents prefix-confusion between distinct ids", () => {
    // Without a length prefix, "a" + "bc" and "ab" + "c" could collide; ensure not.
    const k1 = deriveScopeKey(CacheScope.Private, "a:bc");
    const k2 = deriveScopeKey(CacheScope.Private, "ab:c");
    expect(k1).not.toBe(k2);
  });
});

describe("cacheSafety", () => {
  it("public + positive ttl → cacheable under public key", () => {
    const d = cacheSafety({ ttlMs: 1000, cacheScope: "public" });
    expect(d).toMatchObject({ cacheable: true, scopeKey: PUBLIC_SCOPE_KEY });
  });

  it("private + scopeId → cacheable under derived key", () => {
    const d = cacheSafety({ ttlMs: 1000, cacheScope: "private" }, { scopeId: "user-a" });
    expect(d.cacheable).toBe(true);
    if (d.cacheable) expect(d.scopeKey).toContain("user-a");
  });

  it("private WITHOUT scopeId → not cacheable (private-without-scope)", () => {
    const d = cacheSafety({ ttlMs: 1000, cacheScope: "private" });
    expect(d).toMatchObject({ cacheable: false, reason: "private-without-scope" });
  });

  it("0 ttl → not cacheable by default (zero-ttl)", () => {
    const d = cacheSafety({ ttlMs: 0, cacheScope: "public" });
    expect(d).toMatchObject({ cacheable: false, reason: "zero-ttl" });
  });

  it("0 ttl → cacheable when allowZeroTtl", () => {
    const d = cacheSafety({ ttlMs: 0, cacheScope: "public" }, { allowZeroTtl: true });
    expect(d.cacheable).toBe(true);
  });

  it("missing hints → not cacheable (missing-fields)", () => {
    expect(cacheSafety({ tools: [] })).toMatchObject({
      cacheable: false,
      reason: "missing-fields",
    });
  });

  it("invalid scope → not cacheable (invalid-scope)", () => {
    expect(cacheSafety({ ttlMs: 1000, cacheScope: "everyone" })).toMatchObject({
      cacheable: false,
      reason: "invalid-scope",
    });
  });
});

describe("assertCacheSafe", () => {
  it("returns hints + scopeKey when safe", () => {
    const out = assertCacheSafe(
      { ttlMs: 1000, cacheScope: "private" },
      { scopeId: "user-a" },
    );
    expect(out.hints.ttlMs).toBe(1000);
    expect(out.scopeKey).toContain("user-a");
  });

  it("throws CacheUnsafeError with reason for private-without-scope", () => {
    try {
      assertCacheSafe({ ttlMs: 1000, cacheScope: "private" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CacheUnsafeError);
      expect((err as CacheUnsafeError).reason).toBe("private-without-scope");
      expect((err as CacheUnsafeError).name).toBe("CacheUnsafeError");
    }
  });
});
