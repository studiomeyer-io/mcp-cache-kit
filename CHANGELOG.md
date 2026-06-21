# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Hot path never throws on a hostile / non-serializable request.**
  `McpResultCache.get` / `set` / `getOrLoad` previously threw out of the proxy hot
  path when a request could not be serialized into a cache key — a circular
  `params` (`RangeError`), a `BigInt` in `params` (`TypeError`), or a throwing
  getter on `method`/`params`. In a gateway that keys every request this is a
  denial-of-service. Such a request is now a fail-safe **miss** (`get`, new
  `GetMissReason` `"unkeyable-request"`) or **reject** (`set`, new
  `UncacheableReason` `"unkeyable-request"`), counted in stats, never an exception.
- **`stableStringify` / `deriveRequestKey` are now cycle-safe** — a circular
  structure serializes with a `"[Circular]"` marker instead of overflowing the
  stack. Genuinely shared (diamond) references still serialize in full; only an
  ancestor cycle is marked.

### Added

- `"unkeyable-request"` member on `UncacheableReason` and `GetMissReason`
  (additive — existing exhaustive switches keep compiling; the value only appears
  on the caches request-keying path, never from the `cacheSafety` scope guard).
- Test coverage for the request-keying safety contract, eviction edges
  (`maxEntries = 1`, recency refresh on overwrite), the disabled-cache reasons,
  the TTL exact boundary, and key-construction collision hardening. Suite: 66 → 89
  tests; line coverage 99.2% → 100%, branch 96.0% → 99.1%.

### CI

- Bump pinned GitHub Actions (supersedes Dependabot #1): `actions/checkout`
  v4 → v7, `actions/setup-node` v4 → v6, `github/codeql-action/upload-sarif`
  v3 → v4, `actions/upload-artifact` v4 → v7.

## [0.1.0] - 2026-06-20

Initial release. Models MCP **SEP-2549** (`ttlMs` + `cacheScope`) from the
2026-07-28 release candidate, verified against the spec source.

### Added

- **Server side** — `withCacheHints(result, { ttlMs, cacheScope })` (validates and
  returns a new object), plus `publicHints(ttlMs)` / `privateHints(ttlMs)`
  shorthands.
- **Client / proxy side** — `McpResultCache`: keys every entry by
  `(request, scope)`, honors `ttlMs`, never serves a `private` result across
  authorization contexts, and `set()` fail-safe-refuses anything it cannot prove
  cacheable. `get` / `set` / `getOrLoad` / `prune`, injectable `clock`.
- **Guard** — `cacheSafety(result, { scopeId })` / `assertCacheSafe(...)` with a
  machine-readable `reason` (`missing-fields`, `invalid-ttl`, `invalid-scope`,
  `zero-ttl`, `private-without-scope`, `not-an-object`).
- **Low-level helpers** — `parseCacheHints` (never throws),
  `validateCacheHints`, `isCacheScope`, `isValidTtlMs`, `deriveScopeKey`
  (namespaced + length-prefixed against collision), `deriveRequestKey`,
  `stableStringify`.
- Constants `CacheScope`, `CACHE_SCOPE_VALUES`, `PUBLIC_SCOPE_KEY`.
- Zero runtime dependencies; `@modelcontextprotocol/sdk` an optional peer (helpers
  work on plain result objects). Dual ESM + CJS, `are-the-types-wrong` 4/4.

### Security

- Fail-safe by default: a result is treated as **uncacheable** unless it proves it
  is safe (both fields present and valid, and — for `private` — a `scopeId` to bind
  it to). `deriveScopeKey` rejects non-string `scopeId` (fail-closed) so a numeric
  tenant key cannot defeat the length-prefix leak guard.

### Notes

- SEP-2549 is a release candidate; field names/semantics may shift before final.
  Re-verify against the spec before 1.0.

[Unreleased]: https://github.com/studiomeyer-io/mcp-cache-kit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/studiomeyer-io/mcp-cache-kit/releases/tag/v0.1.0
