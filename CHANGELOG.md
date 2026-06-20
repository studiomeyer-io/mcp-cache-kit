# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
