import { describe, it, expect, beforeEach } from "vitest";
import {
  McpResultCache,
  deriveRequestKey,
  stableStringify,
  withCacheHints,
  CacheScope,
} from "../src/index.js";

/** A controllable clock so TTL math is deterministic (no real time / fake timers needed). */
function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}

const listToolsReq = { method: "tools/list" } as const;

describe("McpResultCache — round-trip & TTL", () => {
  let clock: ReturnType<typeof fakeClock>;
  let cache: McpResultCache;

  beforeEach(() => {
    clock = fakeClock(1_000);
    cache = new McpResultCache({ clock: clock.now });
  });

  it("set/get round-trip for a public result", () => {
    const result = withCacheHints({ tools: [{ name: "ping" }] }, { ttlMs: 5_000, cacheScope: CacheScope.Public });
    const set = cache.set(listToolsReq, result);
    expect(set.stored).toBe(true);

    const got = cache.get<typeof result>(listToolsReq);
    expect(got.hit).toBe(true);
    if (got.hit) expect(got.value.tools).toEqual([{ name: "ping" }]);
  });

  it("honors ttlMs expiry (fresh before, miss after)", () => {
    const result = withCacheHints({ tools: [] }, { ttlMs: 5_000, cacheScope: CacheScope.Public });
    cache.set(listToolsReq, result);

    clock.advance(4_999);
    expect(cache.get(listToolsReq).hit).toBe(true);

    clock.advance(1); // now exactly at expiry (t_received + ttlMs)
    const expired = cache.get(listToolsReq);
    expect(expired.hit).toBe(false);
    expect(cache.stats().expired).toBe(1);
  });

  it("expiry boundary: entry is stale at exactly t + ttlMs (now >= expiresAt)", () => {
    cache.set(listToolsReq, withCacheHints({}, { ttlMs: 1_000, cacheScope: CacheScope.Public }));
    clock.set(1_000 + 1_000); // == expiresAt
    expect(cache.get(listToolsReq).hit).toBe(false);
  });

  it("getOrLoad computes on miss, serves on hit, and does not double-load", async () => {
    let calls = 0;
    const loader = () => {
      calls++;
      return withCacheHints({ tools: [{ name: `v${calls}` }] }, { ttlMs: 5_000, cacheScope: CacheScope.Public });
    };
    const first = await cache.getOrLoad(listToolsReq, loader);
    const second = await cache.getOrLoad(listToolsReq, loader);
    expect(calls).toBe(1);
    expect(first.tools).toEqual(second.tools);
  });

  it("prune removes only expired entries", () => {
    cache.set({ method: "a" }, withCacheHints({}, { ttlMs: 1_000, cacheScope: CacheScope.Public }));
    cache.set({ method: "b" }, withCacheHints({}, { ttlMs: 9_000, cacheScope: CacheScope.Public }));
    clock.advance(2_000);
    expect(cache.prune()).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get({ method: "b" }).hit).toBe(true);
  });
});

describe("McpResultCache — fail-safe (never cache what we can't prove safe)", () => {
  let cache: McpResultCache;
  beforeEach(() => {
    cache = new McpResultCache({ clock: fakeClock(0).now });
  });

  it("result with NO cache hints is not stored → always a miss", () => {
    const set = cache.set(listToolsReq, { tools: [] });
    expect(set.stored).toBe(false);
    if (!set.stored) expect(set.reason).toBe("missing-fields");
    expect(cache.get(listToolsReq).hit).toBe(false);
    expect(cache.stats().rejected).toBe(1);
  });

  it("invalid cacheScope is not stored", () => {
    const set = cache.set(listToolsReq, { tools: [], ttlMs: 1000, cacheScope: "per-user" });
    expect(set.stored).toBe(false);
    if (!set.stored) expect(set.reason).toBe("invalid-scope");
  });

  it("invalid ttl is not stored", () => {
    const set = cache.set(listToolsReq, { tools: [], ttlMs: -1, cacheScope: "public" });
    expect(set.stored).toBe(false);
    if (!set.stored) expect(set.reason).toBe("invalid-ttl");
  });

  it("0 ttl is not stored by default", () => {
    const set = cache.set(listToolsReq, { tools: [], ttlMs: 0, cacheScope: "public" });
    expect(set.stored).toBe(false);
    if (!set.stored) expect(set.reason).toBe("zero-ttl");
  });

  it("private result without scopeId is not stored (refuse to risk a leak)", () => {
    const result = withCacheHints({ contents: [] }, { ttlMs: 5_000, cacheScope: CacheScope.Private });
    const set = cache.set({ method: "resources/read" }, result);
    expect(set.stored).toBe(false);
    if (!set.stored) expect(set.reason).toBe("private-without-scope");
  });

  it("maxEntries <= 0 disables caching entirely", () => {
    const disabled = new McpResultCache({ maxEntries: 0 });
    const set = disabled.set(listToolsReq, withCacheHints({}, { ttlMs: 1000, cacheScope: CacheScope.Public }));
    expect(set.stored).toBe(false);
  });
});

describe("McpResultCache — THE LEAK TEST (cross-scope isolation)", () => {
  let cache: McpResultCache;
  beforeEach(() => {
    cache = new McpResultCache({ clock: fakeClock(0).now });
  });

  const readReq = { method: "resources/read", params: { uri: "file:///me/inbox" } } as const;

  it("a PRIVATE result cached for user A is NOT returned to user B", () => {
    const aSecret = withCacheHints(
      { contents: [{ uri: "file:///me/inbox", text: "USER-A-SECRET" }] },
      { ttlMs: 60_000, cacheScope: CacheScope.Private },
    );

    const set = cache.set(readReq, aSecret, { scopeId: "user-a" });
    expect(set.stored).toBe(true);

    // Same request, different user → must be a MISS (no leak).
    const bLookup = cache.get<typeof aSecret>(readReq, { scopeId: "user-b" });
    expect(bLookup.hit).toBe(false);

    // The owner A still gets a hit.
    const aLookup = cache.get<typeof aSecret>(readReq, { scopeId: "user-a" });
    expect(aLookup.hit).toBe(true);
    if (aLookup.hit) expect(aLookup.value.contents[0]!.text).toBe("USER-A-SECRET");
  });

  it("a private entry is NOT returned to an anonymous lookup (no scopeId)", () => {
    cache.set(
      readReq,
      withCacheHints({ contents: [] }, { ttlMs: 60_000, cacheScope: CacheScope.Private }),
      { scopeId: "user-a" },
    );
    expect(cache.get(readReq).hit).toBe(false);
    expect(cache.get(readReq, { scopeId: "" }).hit).toBe(false);
  });

  it("a PUBLIC result IS shared across users", () => {
    const pub = withCacheHints(
      { tools: [{ name: "weather" }] },
      { ttlMs: 60_000, cacheScope: CacheScope.Public },
    );
    cache.set({ method: "tools/list" }, pub, { scopeId: "user-a" });

    // user B, and an anonymous caller, both get the SAME public result.
    expect(cache.get({ method: "tools/list" }, { scopeId: "user-b" }).hit).toBe(true);
    expect(cache.get({ method: "tools/list" }).hit).toBe(true);
  });

  it("per-SESSION boundary respected (session is just another scope identity)", () => {
    const sessReq = { method: "resources/read", params: { uri: "session://state" } } as const;
    cache.set(
      sessReq,
      withCacheHints({ contents: [{ uri: "session://state", text: "S1-DATA" }] }, { ttlMs: 60_000, cacheScope: CacheScope.Private }),
      { scopeId: "session-1" },
    );

    expect(cache.get(sessReq, { scopeId: "session-2" }).hit).toBe(false);
    const s1 = cache.get<{ contents: { text: string }[] }>(sessReq, { scopeId: "session-1" });
    expect(s1.hit).toBe(true);
    if (s1.hit) expect(s1.value.contents[0]!.text).toBe("S1-DATA");
  });

  it("user A's private entry and a public entry for the SAME request coexist; B sees only public", () => {
    const req = { method: "resources/read", params: { uri: "x" } } as const;
    // Public version (e.g. served to anonymous) ...
    cache.set(req, withCacheHints({ contents: [{ text: "PUBLIC" }] }, { ttlMs: 60_000, cacheScope: CacheScope.Public }));
    // ... and a private version for A.
    cache.set(req, withCacheHints({ contents: [{ text: "A-PRIVATE" }] }, { ttlMs: 60_000, cacheScope: CacheScope.Private }), { scopeId: "user-a" });

    // B (or anonymous) gets the PUBLIC one, never A's private one.
    const b = cache.get<{ contents: { text: string }[] }>(req, { scopeId: "user-b" });
    expect(b.hit).toBe(true);
    if (b.hit) expect(b.value.contents[0]!.text).toBe("PUBLIC");
  });

  it("an expired private entry does not fall through to leak, but a fresh public one can satisfy", () => {
    const clock = fakeClock(0);
    const c = new McpResultCache({ clock: clock.now });
    const req = { method: "resources/read", params: { uri: "y" } } as const;
    c.set(req, withCacheHints({ contents: [{ text: "A-PRIV" }] }, { ttlMs: 1_000, cacheScope: CacheScope.Private }), { scopeId: "user-a" });
    c.set(req, withCacheHints({ contents: [{ text: "PUB" }] }, { ttlMs: 10_000, cacheScope: CacheScope.Public }));

    clock.advance(2_000); // A's private entry now expired, public still fresh
    const a = c.get<{ contents: { text: string }[] }>(req, { scopeId: "user-a" });
    expect(a.hit).toBe(true);
    if (a.hit) expect(a.value.contents[0]!.text).toBe("PUB"); // falls back to the safe public entry
  });
});

describe("McpResultCache — eviction & stats", () => {
  it("evicts oldest-inserted entries beyond maxEntries (FIFO)", () => {
    const cache = new McpResultCache({ maxEntries: 2, clock: fakeClock(0).now });
    cache.set({ method: "a" }, withCacheHints({}, { ttlMs: 9_000, cacheScope: CacheScope.Public }));
    cache.set({ method: "b" }, withCacheHints({}, { ttlMs: 9_000, cacheScope: CacheScope.Public }));
    cache.set({ method: "c" }, withCacheHints({}, { ttlMs: 9_000, cacheScope: CacheScope.Public }));

    expect(cache.size).toBe(2);
    expect(cache.get({ method: "a" }).hit).toBe(false); // evicted
    expect(cache.get({ method: "c" }).hit).toBe(true);
    expect(cache.stats().evictions).toBe(1);
  });

  it("clear empties the store but keeps counters", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    cache.set({ method: "a" }, withCacheHints({}, { ttlMs: 9_000, cacheScope: CacheScope.Public }));
    cache.get({ method: "a" });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.stats().hits).toBe(1);
  });

  it("tracks hits and misses", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    cache.set({ method: "a" }, withCacheHints({}, { ttlMs: 9_000, cacheScope: CacheScope.Public }));
    cache.get({ method: "a" }); // hit
    cache.get({ method: "z" }); // miss
    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.stores).toBe(1);
  });
});

describe("request key derivation", () => {
  it("string passthrough", () => {
    expect(deriveRequestKey("custom-key")).toBe("custom-key");
  });

  it("equal requests with differently-ordered params collide", () => {
    const k1 = deriveRequestKey({ method: "tools/list", params: { a: 1, b: 2 } });
    const k2 = deriveRequestKey({ method: "tools/list", params: { b: 2, a: 1 } });
    expect(k1).toBe(k2);
  });

  it("different params do not collide", () => {
    const k1 = deriveRequestKey({ method: "resources/read", params: { uri: "a" } });
    const k2 = deriveRequestKey({ method: "resources/read", params: { uri: "b" } });
    expect(k1).not.toBe(k2);
  });

  it("stableStringify sorts nested keys", () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });
});
