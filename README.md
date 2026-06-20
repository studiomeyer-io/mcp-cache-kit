<!-- studiomeyer-mcp-stack-banner:start -->
> **Part of the [StudioMeyer MCP Stack](https://studiomeyer.io)** — Built in Mallorca 🌴 · ⭐ if you use it
<!-- studiomeyer-mcp-stack-banner:end -->

# mcp-cache-kit

[![npm](https://img.shields.io/npm/v/mcp-cache-kit.svg)](https://www.npmjs.com/package/mcp-cache-kit)
[![CI](https://github.com/studiomeyer-io/mcp-cache-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/studiomeyer-io/mcp-cache-kit/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/studiomeyer-io/mcp-cache-kit/badge)](https://scorecard.dev/viewer/?uri=github.com/studiomeyer-io/mcp-cache-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Correct, leak-safe caching for the new MCP cache semantics ([SEP-2549](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2549)).**

The MCP spec **2026-07-28 release candidate** adds [SEP-2549](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/): `tools/list`, `resources/read` (and the other list results) now carry **`ttlMs`** and **`cacheScope`** so clients, gateways, and proxies can cache them — modeled on HTTP `Cache-Control`. It is brand-new and has essentially no dedicated tooling. Generic caches store results "somehow" and ignore `cacheScope`, which is a real security trap: a result marked `cacheScope: "private"` that gets cached and served across users is a **cross-user data leak**.

`mcp-cache-kit` is the small, correct layer for exactly this:

- **Server side** — set the fields right (`withCacheHints`).
- **Client / proxy side** — a cache that *honors* `ttlMs` and **never serves a `private` result across authorization contexts** (`McpResultCache`).
- **A guard** — decide if any result may be cached for a given scope, with a clear reason (`cacheSafety` / `assertCacheSafe`).

Zero runtime dependencies. TypeScript strict, ESM + CJS, Node 20+. The `@modelcontextprotocol/sdk` is an *optional* peer — the helpers also work on plain result objects, so you can use it without the SDK.

> ⚠️ **The 2026-07-28 spec is a release candidate.** Field names and semantics may still shift before final. This library models them conservatively and is intentionally tolerant of missing/malformed fields (it treats anything it cannot prove safe as uncacheable).

## What SEP-2549 actually says

Verified against the spec source ([`schema/draft/schema.ts`](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/draft/schema.ts) and [`docs/.../utilities/caching.mdx`](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/specification/draft/server)):

Cacheable results extend a `CacheableResult` shape with two **top-level** fields:

| Field        | Type                    | Meaning                                                                                                 |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `ttlMs`      | `number` (`@minimum 0`) | Freshness window, like `Cache-Control: max-age`. `0` = immediately stale. Absent/negative → treat as `0`. |
| `cacheScope` | `"public" \| "private"` | Like `Cache-Control: public` vs `private`. See below.                                                  |

- **`"public"`** — the response has no user-specific data. Any client or intermediary MAY cache it and serve it **across authorization contexts**.
- **`"private"`** — the response MAY be cached and reused **only within the same authorization context**. Caches MUST NOT be shared across authorization contexts (a different access token / user / session needs a different cache entry).

Applies to `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`, and `resources/read`.

> The spec also warns: a `"public"` result from an *authenticated* endpoint can still be shared between callers, and you **MUST NOT rely on `cacheScope` alone** to prevent unauthorized access. This library enforces the scope boundary for you, but you still own labeling scopes honestly and authenticating at the origin. See [SECURITY.md](./SECURITY.md).

## The cross-user-leak trap

```
              tools/list / resources/read
   user A  ───────────────────────────────►  proxy (caches by request only)
                                                   │ stores result, ignores cacheScope
   user B  ───────── same request ──────────►  proxy
                                                   │ returns A's cached result  ← LEAK
```

If the cached result was `cacheScope: "private"` (A's inbox, A's tenant config, …), user B just received another user's data. `mcp-cache-kit` keys every entry by the request **and** the caller's scope identity, so a `private` entry for A is structurally unreachable for B.

## Install

```bash
npm install mcp-cache-kit
# optional, only if you use the SDK result types directly:
npm install @modelcontextprotocol/sdk
```

## Server side — set the hints

Attach the fields to a result. `withCacheHints` validates them (rejects negative/non-finite `ttlMs` and any `cacheScope` other than `public`/`private`) and returns a **new** object.

```ts
import { withCacheHints, CacheScope } from "mcp-cache-kit";

// tools/list rarely contains user data → public, cache for 5 minutes
server.setRequestHandler(ListToolsRequestSchema, async () =>
  withCacheHints({ tools }, { ttlMs: 5 * 60_000, cacheScope: CacheScope.Public }),
);

// a per-user resource → private, cache for 1 minute
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const contents = await loadForUser(req.params.uri);
  return withCacheHints({ contents }, { ttlMs: 60_000, cacheScope: CacheScope.Private });
});
```

There are shorthands too: `publicHints(ttlMs)` and `privateHints(ttlMs)`.

## Client / proxy side — honor them safely

`McpResultCache` stores results keyed by `(request, scope)`. Pass a `scopeId` that identifies the caller's authorization context (an access-token hash, user id, tenant id, or session id).

```ts
import { McpResultCache } from "mcp-cache-kit";

const cache = new McpResultCache({ maxEntries: 5_000 });

async function handleReadResource(req, ctx) {
  const scopeId = ctx.tokenHash; // identifies the authorization context

  // try the cache first
  const hit = cache.get(req, { scopeId });
  if (hit.hit) return hit.value;

  // miss → fetch from the upstream MCP server, then offer it to the cache.
  // set() stores it ONLY if the result is cache-safe for this scope.
  const result = await upstream.request(req);
  cache.set(req, result, { scopeId });
  return result;
}
```

Or the one-liner:

```ts
const result = await cache.getOrLoad(req, () => upstream.request(req), { scopeId });
```

What the cache guarantees:

- **TTL is honored** — entries expire at `received + ttlMs` and are removed on access (or via `prune()`).
- **`private` never leaks** — a `private` entry stored for scope A is only ever returned to scope A. A different `scopeId`, or no `scopeId`, gets a miss.
- **`public` is shared** — stored under one shared key and returned to anyone.
- **Fail-safe** — `set()` silently refuses (and counts as `rejected`) anything it can't prove safe: missing/partial hints, bad `cacheScope`, bad `ttlMs`, `private`-without-`scopeId`, and `ttlMs: 0` (by default).

## Guard — `cacheSafety` / `assertCacheSafe`

Use these in a gateway when you want to make the decision yourself:

```ts
import { cacheSafety, assertCacheSafe } from "mcp-cache-kit";

const decision = cacheSafety(result, { scopeId });
if (decision.cacheable) {
  // decision.scopeKey is where to store it; decision.hints.ttlMs is the TTL
  myStore.put(decision.scopeKey, result, decision.hints.ttlMs);
} else {
  // decision.reason: "missing-fields" | "invalid-ttl" | "invalid-scope"
  //                | "zero-ttl" | "private-without-scope" | "not-an-object"
  log.debug(`not caching: ${decision.message}`);
}

// or throw if "must be cacheable here" is an invariant:
const { hints, scopeKey } = assertCacheSafe(result, { scopeId }); // throws CacheUnsafeError otherwise
```

## Low-level helpers

All individually exported and tested:

- `parseCacheHints(result)` → `{ ok: true, hints } | { ok: false, reason, message }` — never throws.
- `validateCacheHints({ ttlMs, cacheScope })` → normalized hints (throws `TypeError` on bad input).
- `isCacheScope(x)`, `isValidTtlMs(x)` — type guards.
- `deriveScopeKey(cacheScope, scopeId?)` — the scope-key rule (`undefined` for `private` without a `scopeId`).
- `deriveRequestKey({ method, params })` / `stableStringify(x)` — deterministic request keys (param key order doesn't matter).
- Constants: `CacheScope`, `CACHE_SCOPE_VALUES`, `PUBLIC_SCOPE_KEY`.

## Fail-safe philosophy

Caching the wrong thing across users is worse than a cache miss. So the default decision is always **"do not cache"** unless the result *proves* it is safe: both fields present, both valid, and — for `private` — a `scopeId` to bind it to. SEP-2549 is still an RC, so being strict here also protects you from upstream servers that emit partial or mislabeled hints.

## Testing notes

`McpResultCache` takes an injectable `clock` (`() => number`), so you can test TTL behavior deterministically without real time — and it also works under `vitest` fake timers driving the default `Date.now`. Both styles are covered in the test suite, including the headline cross-user leak test.

## Part of the StudioMeyer MCP toolkit

A small family of focused, production-grade tools for building and operating MCP servers — mix and match:

- [mcp-armor](https://github.com/studiomeyer-io/mcp-armor) — runtime defense sidecar: scans tool calls, verifies signed manifests, blocks known-bad CVEs
- [mcp-gauntlet](https://github.com/studiomeyer-io/mcp-gauntlet) — pre-deploy `mcp-fuzz` (schema-aware fuzzer) + `mcp-storm` (load tester)
- [mcp-otel](https://github.com/studiomeyer-io/mcp-otel) — W3C Trace Context → OpenTelemetry bridge
- **mcp-cache-kit** *(this one)* — leak-safe SEP-2549 caching (`ttlMs` + `cacheScope`)
- [skilldoctor](https://github.com/studiomeyer-io/skilldoctor) — linter + security scanner for agent skill files

## License

[MIT](./LICENSE) © StudioMeyer 2026
