# Security Policy

`mcp-cache-kit` exists to prevent a specific, easy-to-make security bug, so the
threat model is the whole point of the library. Please read this before deploying
a cache in front of MCP traffic.

## The threat: cross-context cache leaks

[SEP-2549](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2549)
(MCP spec, 2026-07-28 release candidate) lets servers mark `tools/list`,
`resources/read` (and the other list results) with cache hints:

- `ttlMs` — how long the result stays fresh.
- `cacheScope` — `"public"` (safe to share across users) or `"private"` (safe to
  reuse **only within the same authorization context**).

The dangerous failure mode is a gateway/proxy that caches "by request" and ignores
`cacheScope`. If a `"private"` `resources/read` result for user A is stored under a
request-only key, the next user B who issues the same request gets served **user
A's private data**. That is a cross-tenant / cross-user data leak.

A second trap comes straight from the spec: a `"public"` result coming out of an
*authenticated* endpoint may still be shared across callers. Servers must not mark
anything `"public"` that contains user-specific data, and **must not rely on
`cacheScope` alone** for access control.

## How this library mitigates it

- **Scope-keyed storage.** Every cache entry is keyed by the request **and** a
  scope key. `public` entries use one shared key (so they are shared on purpose).
  `private` entries derive their key from the caller's authorization-context
  identity (`scopeId` — e.g. an access-token hash, user id, tenant id, or session
  id). A different caller derives a different key and **cannot** reach another
  caller's private entry. There is no code path that returns a private entry to a
  caller who did not store it.
- **Fail-safe by default.** Anything we cannot prove is cache-safe is simply not
  cached: missing/partial hints, an unknown `cacheScope`, a non-finite/negative
  `ttlMs`, a `"private"` result offered without a `scopeId`, and (by default) a
  `ttlMs` of `0`. The default decision is "do not cache", never "cache anyway".
- **A guard you can drop anywhere.** `cacheSafety(result, { scopeId })` and
  `assertCacheSafe(...)` give a clear allow/deny with a machine-readable reason, so
  a proxy can decide safely without re-implementing the rules.
- **`scopeId` must be a non-empty string.** A non-string id (number, array, object
  — e.g. a numeric tenant PK passed by mistake) is refused rather than coerced, so
  it can never collide with another scope's key. Isolation is then only as strong
  as your `scopeId` being unique and unspoofable — that part is yours to guarantee.
- **TTL uses a wall clock** (`Date.now` by default). A backward clock jump can keep
  an entry "fresh" past its `ttlMs`; inject a monotonic `clock` if that matters.

## Your responsibilities (this library cannot do these for you)

1. **Pass a real `scopeId`.** It must uniquely identify the authorization context.
   An access-token hash or an authenticated user/tenant id is good. A value an
   attacker can spoof or that collides across users is not. If you cannot identify
   the context, do not pass a `scopeId` — the library will then refuse to cache
   `private` results (the safe outcome).
2. **Mark scopes honestly on the server.** Never label user-specific data
   `"public"`. When in doubt, use `"private"` (or omit hints entirely).
3. **Do not use the cache as an authorization layer.** It reduces redundant
   fetches; it does not replace authenticating each request at the origin.
4. **Treat `cacheScope` as advisory across trust boundaries.** Per the spec, a
   malicious or buggy upstream can mislabel results.

## Supported versions

`0.x` — the latest `0.x` release receives fixes. Pre-1.0, the public API may change
as SEP-2549 itself is still a release candidate.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via GitHub Security Advisories on
the repository (`Security` tab -> `Report a vulnerability`), or open a minimal,
non-exploitative issue if private reporting is unavailable. Do not include working
exploits against third-party systems. We aim to acknowledge reports within a few
business days.
