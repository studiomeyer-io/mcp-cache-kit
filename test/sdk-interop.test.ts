import { describe, it, expect } from "vitest";
import type { ListToolsResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import {
  withCacheHints,
  cacheSafety,
  McpResultCache,
  CacheScope,
} from "../src/index.js";

/**
 * Proves the helpers work directly on `@modelcontextprotocol/sdk` result types.
 * The SDK (1.29.0) does not yet ship the SEP-2549 fields, so withCacheHints adds
 * them; the result still structurally satisfies our loose MaybeCacheableResult.
 */
describe("works on real @modelcontextprotocol/sdk result shapes", () => {
  it("attaches hints to a ListToolsResult", () => {
    const listResult: ListToolsResult = {
      tools: [{ name: "search", inputSchema: { type: "object" } }],
    };
    const hinted = withCacheHints(listResult, { ttlMs: 30_000, cacheScope: CacheScope.Public });
    expect(hinted.tools).toHaveLength(1);
    expect(hinted.ttlMs).toBe(30_000);
    expect(hinted.cacheScope).toBe("public");

    const decision = cacheSafety(hinted);
    expect(decision.cacheable).toBe(true);
  });

  it("caches a ReadResourceResult under a private scope", () => {
    const cache = new McpResultCache();
    const readResult: ReadResourceResult = {
      contents: [{ uri: "file:///report", text: "tenant-only" }],
    };
    const hinted = withCacheHints(readResult, { ttlMs: 60_000, cacheScope: CacheScope.Private });

    const req = { method: "resources/read", params: { uri: "file:///report" } };
    expect(cache.set(req, hinted, { scopeId: "tenant-42" }).stored).toBe(true);
    expect(cache.get(req, { scopeId: "tenant-42" }).hit).toBe(true);
    expect(cache.get(req, { scopeId: "tenant-99" }).hit).toBe(false);
  });
});
