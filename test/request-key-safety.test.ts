import { describe, it, expect } from "vitest";
import {
  McpResultCache,
  withCacheHints,
  CacheScope,
  deriveRequestKey,
  stableStringify,
} from "../src/index.js";

/**
 * Regression for the 2026-06-21 review: the cache hot path (`get` / `set` /
 * `getOrLoad`) must NEVER throw on a hostile or non-serializable request.
 *
 * `mcp-cache-kit` is meant to sit in a gateway/proxy where `deriveRequestKey`
 * runs on every request. Before this fix a crafted request crashed the call:
 *   - circular `params`   → RangeError (stack overflow) in stableStringify
 *   - a `BigInt` in params → TypeError from JSON.stringify
 *   - a throwing getter on `method` / `params` → the getter's error escaped
 * A thrown error out of `cache.get(req)` is a denial-of-service on the proxy.
 * The contract now: such a request is a fail-safe MISS (get) / REJECT (set),
 * counted in stats, never an exception.
 */

function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const hinted = () =>
  withCacheHints({ tools: [] }, { ttlMs: 1_000, cacheScope: CacheScope.Public });

describe("hot path never throws on a non-serializable / hostile request", () => {
  it("get() with a BigInt param is a fail-safe miss, not a throw", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const req = { method: "tools/list", params: { n: 1n } };
    let out: ReturnType<typeof cache.get> | undefined;
    expect(() => {
      out = cache.get(req);
    }).not.toThrow();
    expect(out).toEqual({ hit: false, reason: "unkeyable-request" });
    expect(cache.stats().misses).toBe(1);
  });

  it("set() with a BigInt param is a fail-safe reject, not a throw", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const req = { method: "tools/list", params: { n: 1n } };
    let out: ReturnType<typeof cache.set> | undefined;
    expect(() => {
      out = cache.set(req, hinted());
    }).not.toThrow();
    expect(out?.stored).toBe(false);
    if (out && !out.stored) expect(out.reason).toBe("unkeyable-request");
    expect(cache.stats().rejected).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("get()/set() with a throwing getter on params do not crash the proxy", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const hostile = {
      method: "resources/read",
      get params(): never {
        throw new Error("boom from a hostile request");
      },
    } as unknown as { method: string };

    expect(() => cache.get(hostile)).not.toThrow();
    expect(cache.get(hostile)).toEqual({ hit: false, reason: "unkeyable-request" });

    let setOut: ReturnType<typeof cache.set> | undefined;
    expect(() => {
      setOut = cache.set(hostile, hinted());
    }).not.toThrow();
    expect(setOut?.stored).toBe(false);
  });

  it("circular params are cycle-safe (no RangeError) and round-trip deterministically", () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const circ: { method: string; params: Record<string, unknown> } = {
      method: "resources/read",
      params: { uri: "x" },
    };
    circ.params["self"] = circ.params; // cycle

    let setOut: ReturnType<typeof cache.set> | undefined;
    expect(() => {
      setOut = cache.set(circ, hinted());
    }).not.toThrow();
    expect(setOut?.stored).toBe(true);
    // the same circular request hits its own entry
    expect(cache.get(circ).hit).toBe(true);
  });

  it("getOrLoad() still runs the loader and returns its value when the request is unkeyable", async () => {
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const req = { method: "tools/list", params: { n: 1n } };
    let calls = 0;
    const loader = () => {
      calls++;
      return withCacheHints({ tools: ["v"] }, { ttlMs: 1_000, cacheScope: CacheScope.Public });
    };
    const first = await cache.getOrLoad(req, loader);
    const second = await cache.getOrLoad(req, loader);
    expect(first.tools).toEqual(["v"]);
    // unkeyable → nothing cached → loader runs every time (correct: never serves stale/wrong)
    expect(calls).toBe(2);
    expect(second.tools).toEqual(["v"]);
  });

  it("an unkeyable request can never collide onto another caller's PRIVATE entry", () => {
    // Defense-in-depth: even the failure mode must not leak. A request that
    // cannot be keyed must miss for everyone, never fall through to a stored entry.
    const cache = new McpResultCache({ clock: fakeClock(0).now });
    const goodReq = { method: "resources/read", params: { uri: "inbox" } };
    cache.set(
      goodReq,
      withCacheHints({ contents: [{ text: "A-SECRET" }] }, { ttlMs: 60_000, cacheScope: CacheScope.Private }),
      { scopeId: "user-a" },
    );
    // attacker issues the "same" request but with an unkeyable param payload
    const evilReq = { method: "resources/read", params: { uri: "inbox", n: 2n } };
    expect(cache.get(evilReq, { scopeId: "user-b" })).toEqual({
      hit: false,
      reason: "unkeyable-request",
    });
    expect(cache.get(evilReq, { scopeId: "user-a" })).toEqual({
      hit: false,
      reason: "unkeyable-request",
    });
  });
});

describe("stableStringify cycle / sharing semantics", () => {
  it("renders an ancestor cycle as \"[Circular]\" (deterministic, no overflow)", () => {
    const a: Record<string, unknown> = { x: 1 };
    a["self"] = a;
    expect(stableStringify(a)).toBe('{"self":"[Circular]","x":1}');
  });

  it("serializes a shared (diamond) reference in full — only true cycles are marked", () => {
    const shared = { v: 9 };
    // shared appears twice as siblings (not an ancestor cycle) → both expand fully.
    expect(stableStringify({ a: shared, b: shared })).toBe('{"a":{"v":9},"b":{"v":9}}');
  });

  it("handles a cycle nested in an array without throwing", () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => stableStringify({ arr })).not.toThrow();
    expect(stableStringify({ arr })).toBe('{"arr":[1,"[Circular]"]}');
  });
});

describe("deriveRequestKey public helper contract", () => {
  it("is cycle-safe (the documented hot-path-friendly behavior)", () => {
    const req: { method: string; params: Record<string, unknown> } = {
      method: "m",
      params: {},
    };
    req.params["self"] = req.params;
    expect(() => deriveRequestKey(req)).not.toThrow();
  });

  it("still throws for a value JSON itself cannot represent (BigInt) — documented", () => {
    // The PUBLIC helper preserves JSON's own contract; only the cache wraps it.
    expect(() => deriveRequestKey({ method: "m", params: { n: 1n } })).toThrow(TypeError);
  });
});
