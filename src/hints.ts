/**
 * Server-side helpers: attach and read SEP-2549 cache hints on results.
 */

import {
  CACHE_SCOPE_VALUES,
  CacheScope,
  type CacheHints,
  type CacheHintsInput,
  type MaybeCacheableResult,
  type ParsedCacheHints,
  type WithCacheHints,
} from "./types.js";

/** Type guard for the `cacheScope` enum. */
export function isCacheScope(value: unknown): value is CacheScope {
  return (
    typeof value === "string" &&
    (CACHE_SCOPE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * True if `ttlMs` is a valid SEP-2549 TTL: a finite, non-negative number.
 *
 * The spec annotates `ttlMs` with `@minimum 0` and treats negative/absent values
 * as `0`. We require a real finite number here (NaN / Infinity are rejected).
 */
export function isValidTtlMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate a {@link CacheHintsInput}, throwing a descriptive `TypeError` on bad input.
 * Returns the normalized {@link CacheHints} (ttlMs floored to an integer ms).
 *
 * @throws {TypeError} if `ttlMs` is not a finite number `>= 0`, or `cacheScope`
 *   is not `"public" | "private"`.
 */
export function validateCacheHints(input: CacheHintsInput): CacheHints {
  if (input === null || typeof input !== "object") {
    throw new TypeError(
      `mcp-cache-kit: cache hints must be an object with { ttlMs, cacheScope }, got ${describe(
        input,
      )}`,
    );
  }
  if (!isValidTtlMs(input.ttlMs)) {
    throw new TypeError(
      `mcp-cache-kit: ttlMs must be a finite number >= 0 (milliseconds), got ${describe(
        input.ttlMs,
      )}`,
    );
  }
  if (!isCacheScope(input.cacheScope)) {
    throw new TypeError(
      `mcp-cache-kit: cacheScope must be one of ${CACHE_SCOPE_VALUES.map(
        (v) => `"${v}"`,
      ).join(" | ")}, got ${describe(input.cacheScope)}`,
    );
  }
  // Normalize to integer milliseconds — fractional ms is meaningless and keeps
  // the value JSON-clean for the wire.
  return { ttlMs: Math.floor(input.ttlMs), cacheScope: input.cacheScope };
}

/**
 * Server-side: attach SEP-2549 cache hints to a `tools/list` / `resources/read`
 * (etc.) result so clients and proxies can cache it correctly.
 *
 * Returns a NEW object (does not mutate the input) with `ttlMs` and `cacheScope`
 * set as top-level fields, exactly where the spec places them.
 *
 * @example
 * ```ts
 * server.setRequestHandler(ListToolsRequestSchema, () =>
 *   withCacheHints({ tools }, { ttlMs: 60_000, cacheScope: CacheScope.Public }),
 * );
 * ```
 *
 * @throws {TypeError} via {@link validateCacheHints} on invalid hints.
 */
export function withCacheHints<T extends object>(
  result: T,
  hints: CacheHintsInput,
): WithCacheHints<T> {
  if (result === null || typeof result !== "object") {
    throw new TypeError(
      `mcp-cache-kit: withCacheHints(result, ...) requires a result object, got ${describe(
        result,
      )}`,
    );
  }
  const valid = validateCacheHints(hints);
  return { ...result, ttlMs: valid.ttlMs, cacheScope: valid.cacheScope };
}

/**
 * Convenience: a `public` result fresh for `ttlMs`. Safe to share across users.
 */
export function publicHints(ttlMs: number): CacheHints {
  return validateCacheHints({ ttlMs, cacheScope: CacheScope.Public });
}

/**
 * Convenience: a `private` result fresh for `ttlMs`. Reusable only within the
 * same authorization context — the cache will refuse to share it across scopes.
 */
export function privateHints(ttlMs: number): CacheHints {
  return validateCacheHints({ ttlMs, cacheScope: CacheScope.Private });
}

/**
 * Client/proxy-side: read and validate the cache hints off an unknown result.
 *
 * Returns `{ ok: true, hints }` only when BOTH fields are present and valid.
 * Anything else returns `{ ok: false, reason, message }` — this is the fail-safe
 * primitive the cache builds on: if we cannot prove the hints, we don't cache.
 *
 * This never throws. It is safe to call on arbitrary JSON-RPC result payloads.
 */
export function parseCacheHints(result: unknown): ParsedCacheHints {
  if (result === null || typeof result !== "object") {
    return {
      ok: false,
      reason: "not-an-object",
      message: `result is not an object (got ${describe(result)})`,
    };
  }
  const r = result as MaybeCacheableResult;
  // Read the two fields once, defensively: a live JS object could carry a
  // throwing getter on ttlMs/cacheScope. We promise never to throw, so a hostile
  // getter is treated as "cannot read hints" → uncacheable (fail safe).
  let ttlVal: unknown;
  let scopeVal: unknown;
  try {
    ttlVal = "ttlMs" in r ? r.ttlMs : undefined;
    scopeVal = "cacheScope" in r ? r.cacheScope : undefined;
  } catch {
    return {
      ok: false,
      reason: "not-an-object",
      message: "reading cache hints threw (hostile getter on the result?)",
    };
  }
  const hasTtl = ttlVal !== undefined;
  const hasScope = scopeVal !== undefined;

  if (!hasTtl && !hasScope) {
    return {
      ok: false,
      reason: "missing-fields",
      message: "result has no SEP-2549 cache hints (ttlMs / cacheScope absent)",
    };
  }
  // Per the caching spec, absent ttlMs defaults to 0; but a partially-hinted
  // result (one field present, the other missing) is malformed — fail safe.
  if (!hasTtl || !hasScope) {
    return {
      ok: false,
      reason: "missing-fields",
      message:
        "result has only one of ttlMs / cacheScope; both are required to be cacheable",
    };
  }
  if (!isValidTtlMs(ttlVal)) {
    return {
      ok: false,
      reason: "invalid-ttl",
      message: `ttlMs is not a finite number >= 0 (got ${describe(ttlVal)})`,
    };
  }
  if (!isCacheScope(scopeVal)) {
    return {
      ok: false,
      reason: "invalid-scope",
      message: `cacheScope is not "public" | "private" (got ${describe(
        scopeVal,
      )})`,
    };
  }
  return { ok: true, hints: { ttlMs: Math.floor(ttlVal), cacheScope: scopeVal } };
}

/** Short, safe description of an unknown value for error messages. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
