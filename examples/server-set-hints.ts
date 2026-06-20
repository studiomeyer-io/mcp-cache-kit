/**
 * Example (server side): attach SEP-2549 cache hints to MCP results.
 *
 * Run with: npx tsx examples/server-set-hints.ts
 *
 * `withCacheHints` works on plain result objects, so this example needs no MCP SDK.
 * In a real server you'd return these from your request handlers.
 */
import { withCacheHints, publicHints, privateHints, CacheScope } from "../src/index.js";

// --- tools/list: usually the same for everyone → public, cache 5 min ---
const toolsResult = withCacheHints(
  { tools: [{ name: "search", description: "Search the docs" }] },
  { ttlMs: 5 * 60_000, cacheScope: CacheScope.Public },
);
console.log("tools/list result:", toolsResult);
// → { tools: [...], ttlMs: 300000, cacheScope: "public" }

// --- resources/read of a per-user file → private, cache 1 min ---
const inbox = withCacheHints(
  { contents: [{ uri: "file:///me/inbox", text: "your messages…" }] },
  { ttlMs: 60_000, cacheScope: CacheScope.Private },
);
console.log("resources/read result:", inbox);

// --- shorthands ---
console.log("publicHints(10_000):", publicHints(10_000));
console.log("privateHints(10_000):", privateHints(10_000));

// --- validation is built in: this throws ---
try {
  withCacheHints({}, { ttlMs: -1, cacheScope: CacheScope.Public });
} catch (err) {
  console.log("rejected bad ttl:", (err as Error).message);
}
