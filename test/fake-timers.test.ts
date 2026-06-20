import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpResultCache, withCacheHints, CacheScope } from "../src/index.js";

/**
 * Same TTL-expiry guarantee, verified with vitest's fake timers driving the
 * default `Date.now` clock (rather than an injected clock) — proves the cache
 * works correctly against the real default time source too.
 */
describe("TTL expiry under vitest fake timers (default Date.now clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("entry is fresh before ttl and a miss after", () => {
    const cache = new McpResultCache(); // uses Date.now
    const req = { method: "tools/list" };
    cache.set(req, withCacheHints({ tools: [] }, { ttlMs: 10_000, cacheScope: CacheScope.Public }));

    vi.advanceTimersByTime(9_999);
    expect(cache.get(req).hit).toBe(true);

    vi.advanceTimersByTime(1);
    expect(cache.get(req).hit).toBe(false);
  });
});
