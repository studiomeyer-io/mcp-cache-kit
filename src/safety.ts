/**
 * The safety layer: decide whether a result may be cached for a given
 * authorization-context identity, and derive the scope key it must be stored under.
 *
 * This is where the cross-user-leak trap is closed. SEP-2549 says a `private`
 * result "MAY be cached and reused only within the same authorization context".
 * We enforce that by KEYING private entries with the caller's scope identity, so a
 * `private` entry stored for user A is structurally unreachable for user B.
 */

import { parseCacheHints } from "./hints.js";
import {
  CacheScope,
  type CacheDecision,
  type CacheHints,
} from "./types.js";

/**
 * The single, shared scope key used for `public` results. Chosen to be a value
 * that cannot collide with any real scope identity (which is escaped, see below).
 */
export const PUBLIC_SCOPE_KEY = "public";

/** Options for {@link cacheSafety} / {@link assertCacheSafe}. */
export interface CacheSafetyOptions {
  /**
   * Identity of the caller's authorization context — e.g. an access-token hash,
   * user id, tenant id, or session id. REQUIRED to cache `private` results.
   * Pass it for `public` results too if you have it; it will simply be ignored.
   */
  scopeId?: string;
  /**
   * If true, a `ttlMs` of `0` is reported as cacheable (with `zero-ttl` being a
   * non-fatal note). Default `false`: a 0 TTL means "immediately stale", so there
   * is nothing worth storing and we report it uncacheable. The cache uses the
   * default.
   */
  allowZeroTtl?: boolean;
}

/**
 * Derive the scope key an entry must be stored under.
 *
 * - `public`  → {@link PUBLIC_SCOPE_KEY} (shared across all callers).
 * - `private` → a key derived from `scopeId`, namespaced so it can never collide
 *   with the public bucket or with another scope id.
 *
 * Returns `undefined` for a `private` result when no `scopeId` is supplied —
 * the caller MUST treat that as "do not cache".
 */
export function deriveScopeKey(
  cacheScope: CacheScope,
  scopeId?: string,
): string | undefined {
  if (cacheScope === CacheScope.Public) return PUBLIC_SCOPE_KEY;
  // private — fail closed on anything that is not a non-empty string. A JS caller
  // can pass a number/array/object (e.g. a numeric tenant PK straight from the DB),
  // and `(123).length` is `undefined`, which would void the length-prefix collision
  // defense below and leak a private entry across scopes. So we never coerce an
  // unexpected type into a cache key — we refuse to cache it.
  if (typeof scopeId !== "string" || scopeId === "") return undefined;
  // Namespace + length-prefix the id so distinct ids cannot be confused with one
  // another or with the literal public key (e.g. a scopeId of "public").
  return `private:${scopeId.length}:${scopeId}`;
}

/**
 * Decide whether `result` may be cached for the given scope identity.
 *
 * Returns a {@link CacheDecision}: when `cacheable: true` it includes the validated
 * hints and the `scopeKey` to store the entry under; when `cacheable: false` it
 * includes a machine-readable `reason` and a human-readable `message`.
 *
 * Fail-safe by construction: missing/invalid hints, an unrecognized scope, a
 * `private` result without a `scopeId`, and (by default) a `0` TTL all return
 * `cacheable: false`. Never throws.
 *
 * Use this as a guard anywhere in a proxy/gateway:
 * ```ts
 * const d = cacheSafety(result, { scopeId: tokenHash });
 * if (d.cacheable) store(key, d.scopeKey, result, d.hints.ttlMs);
 * ```
 */
export function cacheSafety(
  result: unknown,
  options: CacheSafetyOptions = {},
): CacheDecision {
  const parsed = parseCacheHints(result);
  if (!parsed.ok) {
    return { cacheable: false, reason: parsed.reason, message: parsed.message };
  }
  const hints = parsed.hints;

  if (hints.ttlMs === 0 && options.allowZeroTtl !== true) {
    return {
      cacheable: false,
      reason: "zero-ttl",
      message: "ttlMs is 0 (immediately stale); nothing to cache",
    };
  }

  const scopeKey = deriveScopeKey(hints.cacheScope, options.scopeId);
  if (scopeKey === undefined) {
    return {
      cacheable: false,
      reason: "private-without-scope",
      message:
        'cacheScope is "private" but no scopeId was provided; refusing to cache to avoid cross-context leaks',
    };
  }

  return { cacheable: true, hints, scopeKey };
}

/** Error thrown by {@link assertCacheSafe} when a result may not be cached. */
export class CacheUnsafeError extends Error {
  override readonly name = "CacheUnsafeError";
  /** Machine-readable reason, mirrors {@link CacheDecision}'s `reason`. */
  readonly reason: Extract<CacheDecision, { cacheable: false }>["reason"];
  constructor(decision: Extract<CacheDecision, { cacheable: false }>) {
    super(`mcp-cache-kit: result is not cache-safe (${decision.reason}): ${decision.message}`);
    this.reason = decision.reason;
  }
}

/**
 * Assert that `result` may be cached for the given scope identity, throwing a
 * {@link CacheUnsafeError} otherwise. Returns the validated hints + scopeKey.
 *
 * Prefer {@link cacheSafety} when you want to branch without exceptions; use this
 * when "must be cacheable here" is an invariant you want to enforce loudly.
 */
export function assertCacheSafe(
  result: unknown,
  options: CacheSafetyOptions = {},
): { hints: CacheHints; scopeKey: string } {
  const decision = cacheSafety(result, options);
  if (!decision.cacheable) {
    throw new CacheUnsafeError(decision);
  }
  return { hints: decision.hints, scopeKey: decision.scopeKey };
}
