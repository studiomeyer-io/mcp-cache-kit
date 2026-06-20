/**
 * Core types for mcp-cache-kit, modeled on MCP SEP-2549.
 *
 * SEP-2549 (MCP spec, 2026-07-28 release candidate) adds two top-level fields to
 * cacheable results (`tools/list`, `resources/list`, `resources/templates/list`,
 * `prompts/list`, `resources/read`):
 *
 *   - `ttlMs: number`   — how long the client MAY treat the result as fresh,
 *                          analogous to HTTP `Cache-Control: max-age`. `@minimum 0`.
 *   - `cacheScope: "public" | "private"` — analogous to HTTP
 *                          `Cache-Control: public` vs `private`.
 *
 * Source of truth (verified):
 *   https://github.com/modelcontextprotocol/modelcontextprotocol (schema/draft/schema.ts,
 *   docs/specification/draft/server/utilities/caching.mdx) and
 *   https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
 *
 * NOTE: the 2026-07-28 spec is a release candidate. These field names/semantics
 * may still shift before final. This library is intentionally tolerant of missing
 * or malformed fields and treats anything it cannot prove safe as uncacheable.
 */

/**
 * The allowed values of `cacheScope` per SEP-2549.
 *
 * - `"public"`  — the response does not contain user-specific data. Any client or
 *   intermediary MAY cache it and serve it across authorization contexts.
 * - `"private"` — the response MAY be cached and reused only within the SAME
 *   authorization context. Caches MUST NOT be shared across authorization contexts
 *   (a different access token/user/session requires a different cache entry).
 */
export const CacheScope = {
  /** Shareable across authorization contexts. */
  Public: "public",
  /** Only reusable within the same authorization context. */
  Private: "private",
} as const;

/** Union of the valid `cacheScope` string values: `"public" | "private"`. */
export type CacheScope = (typeof CacheScope)[keyof typeof CacheScope];

/** Immutable list of valid scope values, handy for validation/iteration. */
export const CACHE_SCOPE_VALUES: readonly CacheScope[] = Object.freeze([
  CacheScope.Public,
  CacheScope.Private,
]);

/**
 * The SEP-2549 cache hint fields as they appear (top-level) on a cacheable result.
 */
export interface CacheHints {
  /**
   * How long (ms) the client MAY treat the result as fresh. `>= 0`.
   * `0` means "immediately stale". See {@link CacheScope} for scope semantics.
   */
  ttlMs: number;
  /** Whether the result is safe to share across authorization contexts. */
  cacheScope: CacheScope;
}

/**
 * Minimal structural shape of an MCP result that MAY carry cache hints.
 *
 * Kept deliberately loose (`Record<string, unknown>`) so the helpers work on plain
 * result objects WITHOUT a hard dependency on `@modelcontextprotocol/sdk`. If you
 * do use the SDK, its `ListToolsResult` / `ReadResourceResult` (etc.) structurally
 * satisfy this type.
 */
export interface MaybeCacheableResult extends Record<string, unknown> {
  ttlMs?: unknown;
  cacheScope?: unknown;
}

/**
 * A result that carries valid, fully-typed SEP-2549 cache hints.
 * `T` is the underlying result type so callers keep their concrete shape.
 */
export type WithCacheHints<T extends object> = T & CacheHints;

/** Options accepted by {@link withCacheHints}. */
export interface CacheHintsInput {
  /** Time-to-live in milliseconds. Must be a finite number `>= 0`. */
  ttlMs: number;
  /** One of {@link CacheScope}. */
  cacheScope: CacheScope;
}

/**
 * Result of parsing the cache hints off an unknown result object.
 *
 * `ok: true` only when BOTH fields are present and valid per spec. Otherwise
 * `ok: false` with a machine-readable `reason` and human-readable `message`.
 */
export type ParsedCacheHints =
  | { ok: true; hints: CacheHints }
  | { ok: false; reason: UncacheableReason; message: string };

/** Machine-readable reasons a result is considered uncacheable. */
export type UncacheableReason =
  /** The result was null/undefined or not an object. */
  | "not-an-object"
  /** `ttlMs` or `cacheScope` was absent. Fail-safe: don't cache. */
  | "missing-fields"
  /** `ttlMs` was present but not a finite number `>= 0`. */
  | "invalid-ttl"
  /** `cacheScope` was present but not `"public" | "private"`. */
  | "invalid-scope"
  /** `ttlMs` was `0` — explicitly "immediately stale", so nothing to store. */
  | "zero-ttl"
  /** A `private` result was offered without a scope identity to key it by. */
  | "private-without-scope";

/**
 * The decision returned by {@link cacheSafety} / used by the cache: may this result
 * be stored for the given scope identity, and if not, why.
 */
export type CacheDecision =
  | {
      cacheable: true;
      hints: CacheHints;
      /**
       * The scope key the entry MUST be stored under. For `public` results this is
       * a shared constant; for `private` results it is derived from the caller's
       * authorization-context identity.
       */
      scopeKey: string;
    }
  | { cacheable: false; reason: UncacheableReason; message: string };
