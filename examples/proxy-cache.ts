/**
 * Example (client / proxy side): honor SEP-2549 hints without leaking private
 * results across users.
 *
 * Run with: npx tsx examples/proxy-cache.ts
 */
import { McpResultCache, withCacheHints, CacheScope } from "../src/index.js";

const cache = new McpResultCache({ maxEntries: 1000 });

// Pretend these come from an upstream MCP server.
const publicTools = withCacheHints(
  { tools: [{ name: "weather" }] },
  { ttlMs: 60_000, cacheScope: CacheScope.Public },
);
const userAInbox = withCacheHints(
  { contents: [{ uri: "file:///inbox", text: "USER-A PRIVATE" }] },
  { ttlMs: 60_000, cacheScope: CacheScope.Private },
);

const listReq = { method: "tools/list" };
const readReq = { method: "resources/read", params: { uri: "file:///inbox" } };

// --- public: stored once, shared with everyone ---
cache.set(listReq, publicTools, { scopeId: "user-a" });
console.log("user-b sees public tools:", cache.get(listReq, { scopeId: "user-b" }).hit); // true
console.log("anonymous sees public tools:", cache.get(listReq).hit); // true

// --- private: stored for user A only ---
cache.set(readReq, userAInbox, { scopeId: "user-a" });
console.log("user-a reads own inbox:", cache.get(readReq, { scopeId: "user-a" }).hit); // true
console.log("user-b reads inbox (must be MISS):", cache.get(readReq, { scopeId: "user-b" }).hit); // false  ← no leak
console.log("anonymous reads inbox (must be MISS):", cache.get(readReq).hit); // false

// --- fail-safe: a result with no hints is never cached ---
const noHints = cache.set({ method: "prompts/list" }, { prompts: [] });
console.log("uncacheable (no hints) stored?", noHints.stored, "-", noHints.stored ? "" : noHints.reason);

// --- getOrLoad: fetch-through with caching in one call ---
async function main() {
  let fetched = 0;
  const load = () => {
    fetched++;
    return withCacheHints({ tools: [] }, { ttlMs: 30_000, cacheScope: CacheScope.Public });
  };
  await cache.getOrLoad({ method: "tools/list", params: { v: 2 } }, load, { scopeId: "user-a" });
  await cache.getOrLoad({ method: "tools/list", params: { v: 2 } }, load, { scopeId: "user-b" });
  console.log("upstream fetched only once for a shared public result:", fetched === 1);

  console.log("cache stats:", cache.stats());
}
void main();
