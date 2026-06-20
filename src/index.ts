/**
 * mcp-cache-kit — correct, leak-safe caching for the MCP cache semantics added in
 * SEP-2549 (MCP spec, 2026-07-28 release candidate).
 *
 * - Server-side: {@link withCacheHints} sets `ttlMs` + `cacheScope` on a result.
 * - Client/proxy-side: {@link McpResultCache} honors TTL and NEVER serves a
 *   `private` result across authorization contexts.
 * - Guard: {@link cacheSafety} / {@link assertCacheSafe} decide if a result may be
 *   cached for a given scope, with a clear reason.
 *
 * Fail-safe philosophy: anything we cannot prove cache-safe is treated as
 * uncacheable. SEP-2549 is an RC — fields may still shift; this library tolerates
 * missing/malformed hints by design.
 *
 * @packageDocumentation
 */

// --- Types & spec constants ---
export {
  CacheScope,
  CACHE_SCOPE_VALUES,
  type CacheHints,
  type CacheHintsInput,
  type MaybeCacheableResult,
  type WithCacheHints,
  type ParsedCacheHints,
  type UncacheableReason,
  type CacheDecision,
} from "./types.js";

// --- Server-side hints + low-level parse/validate helpers ---
export {
  withCacheHints,
  validateCacheHints,
  parseCacheHints,
  isCacheScope,
  isValidTtlMs,
  publicHints,
  privateHints,
} from "./hints.js";

// --- Safety layer (guard + scope-key derivation) ---
export {
  cacheSafety,
  assertCacheSafe,
  deriveScopeKey,
  CacheUnsafeError,
  PUBLIC_SCOPE_KEY,
  type CacheSafetyOptions,
} from "./safety.js";

// --- Client/proxy cache ---
export {
  McpResultCache,
  deriveRequestKey,
  stableStringify,
  type McpResultCacheOptions,
  type LookupOptions,
  type RequestKeyInput,
  type Clock,
  type SetOutcome,
  type GetOutcome,
  type GetMissReason,
  type CacheStats,
} from "./cache.js";
