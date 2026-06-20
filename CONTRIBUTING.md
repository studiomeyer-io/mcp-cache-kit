# Contributing to mcp-cache-kit

Thanks for considering a contribution. `mcp-cache-kit` is a **security-shaped**
library: the whole point is that a `private` result never leaks across users. The
bar for new code is "it keeps the cache correct and leak-safe, and it ships with a
test" — and for anything touching the scope boundary, "it ships with a *regression*
test that fails on `main`".

## Quick Start

```sh
git clone https://github.com/studiomeyer-io/mcp-cache-kit
cd mcp-cache-kit
npm ci
npm run typecheck      # tsc --noEmit, strict
npm run build          # tsup, dual ESM + CJS
npm test               # vitest, incl. the cross-user-leak test
npm run attw           # are-the-types-wrong, must stay 4/4
```

Node **20+**. CI runs on Node 20 and 22 — your patch needs to pass on both.

## What we accept

- **Spec-correctness fixes.** SEP-2549 is an RC. If our reading of `ttlMs` /
  `cacheScope` diverges from the [spec source](https://github.com/modelcontextprotocol/modelcontextprotocol)
  (`schema.ts` + `caching.mdx`), open a PR with a failing test.
- **Leak-class fixes.** Any input that can make a `private` entry reachable from a
  different scope (or no scope) is a security bug. A regression test that
  reproduces it is the fastest path to merge — see `test/regression-review.test.ts`
  for the shape.
- **Docs.** Typo fixes, clarifications, ecosystem links.

## What we are slow on

- **Runtime dependencies.** There are **zero**, by design — every dependency is a
  supply-chain surface for a leak-safety tool. The MCP SDK is an *optional peer*.
  Open an issue before proposing one.
- **Relaxing the fail-safe default.** "Cache more aggressively" requests are
  declined unless they preserve the invariant: anything not provably safe stays
  uncacheable. Caching the wrong thing across users is worse than a miss.
- **New top-level features** beyond the cache-safety boundary (eviction policies,
  persistence backends). Discuss in an issue first.

## Pull Request Process

1. Open an issue or draft PR first for anything non-trivial.
2. One logical change per PR.
3. CI must be green: `typecheck`, `build`, `test`, `attw`.
4. Add a `CHANGELOG.md` entry under `[Unreleased]`.
5. For security-impacting changes, see [SECURITY.md](SECURITY.md) — please email
   instead of opening a public issue.

## Coding Standards

- TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
  No `any` in shipped code.
- Helpers that promise "never throws" must be tested against hostile getters /
  prototype-pollution / NUL-injection inputs.
- Keep the public surface small and documented. New exports need a README entry.
- Dual ESM/CJS correctness enforced — keep `are-the-types-wrong` at 4/4.

## Testing

- Tests live in `test/` (vitest). The headline cross-user-leak test and the
  deterministic-clock TTL tests must stay green.
- New behavior needs a test that fails on `main` and passes with your patch.

## Releasing (maintainers)

- Bump `version` in `package.json` and add a dated section to `CHANGELOG.md`.
- Tag `vX.Y.Z` on `main`. `publish.yml` runs `npm publish --provenance` via OIDC
  (needs the `NPM_TOKEN` repo secret).

## License

By contributing, you agree your work is licensed under the [MIT License](LICENSE).

## Code of Conduct

Be kind. Assume good faith. We are a small studio in Palma de Mallorca — no drama,
disagreement is fine, contempt is not.
