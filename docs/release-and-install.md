# Release and install

## What it does

Prism is published as one core package plus seven first-party workspace packages and three umbrella convenience packages. This page describes how they are packed, what each tarball contains, how to install them, the required `@arnilo/prism` peer dependency, the release workflow, and the offline test budget.

Core package:

- `@arnilo/prism` — the runtime, contracts, registries, streaming events, CLI, and the `/docs` hub. `files`: `dist` (with `!dist/__tests__` and `!dist/**/*.map` negations), `docs`, `CHANGELOG.md`. `bin`: `prism` -> `./dist/cli.js`. `sideEffects`: `["dist/cli.js"]`.

First-party workspace packages (each `peerDependencies: { "@arnilo/prism": "0.0.1" }`, non-optional; `sideEffects: false`):

- `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-openrouter`, `@arnilo/prism-provider-kimi`, `@arnilo/prism-provider-zai`, `@arnilo/prism-provider-opencode-go` — provider adapters.
- `@arnilo/prism-compaction-llm` — optional LLM-backed compaction strategy.
- `@arnilo/prism-compaction-observational-memory` — optional source-backed observational memory.

Umbrella packages (pure manifests, no code, no `dist`; ship only `README.md`; use hard `dependencies` to transitively install their family):

- `@arnilo/prism-providers` — depends on all 5 `@arnilo/prism-provider-*` packages.
- `@arnilo/prism-compaction` — depends on both `@arnilo/prism-compaction-*` packages.
- `@arnilo/prism-all` — depends on `@arnilo/prism` + `@arnilo/prism-providers` + `@arnilo/prism-compaction` (the full kit in one install).

Each code package's `files` array is `["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]`; `README.md`, `LICENSE`, and `CHANGELOG.md` ship in every code-package tarball, the core tarball also ships the `docs/` directory, and umbrella tarballs ship only `README.md` + `package.json`.

## When to use it

Use this page when installing Prism into a host app, when adding a first-party package, when cutting a release, or when investigating why a tarball contains (or excludes) a file.

Consumers install the core package for the runtime and add first-party packages for provider adapters or compaction strategies. Each first-party package requires the `@arnilo/prism` peer at its declared version; install `@arnilo/prism` alongside them or npm will report an unmet peer.

## Inputs / request

| Operation | Command |
| --- | --- |
| Install core only | `npm install @arnilo/prism` |
| Install core + all providers | `npm install @arnilo/prism @arnilo/prism-providers` |
| Install core + compaction | `npm install @arnilo/prism @arnilo/prism-compaction` |
| Install everything (core + providers + compaction) | `npm install @arnilo/prism-all` |
| Install core + a single provider | `npm install @arnilo/prism @arnilo/prism-provider-openai` |
| Build everything (core + workspaces) | `npm run build` |
| Run the default (network-free) test suite | `npm test` |
| Dry-run pack core + every package | `npm run pack:dry-run` |
| Local mirror of the release verify gate | `npm run release:dry-run` |

Public core import specifiers (from the root `exports` map):

| Specifier | Resolves to |
| --- | --- |
| `@arnilo/prism` | `dist/index.js` / `dist/index.d.ts` |
| `@arnilo/prism/providers/openai-compatible` | `dist/providers/openai-compatible.{js,d.ts}` |
| `@arnilo/prism/testing/provider-conformance` | `dist/testing/provider-conformance.{js,d.ts}` |
| `@arnilo/prism/node/config` | `dist/node/config.{js,d.ts}` |
| `@arnilo/prism/node/settings` | `dist/node/settings.{js,d.ts}` |
| `@arnilo/prism/node/trust` | `dist/node/trust.{js,d.ts}` |
| `@arnilo/prism/node/session-store-jsonl` | `dist/node/session-store-jsonl.{js,d.ts}` |

## Outputs / response / events

A packed tarball contains only public compiled output and release files:

- `dist/**` compiled `.js` and `.d.ts` for every exported subpath.
- `README.md`, `LICENSE`, `CHANGELOG.md` in every package.
- The core tarball additionally ships the full `docs/` directory (the docs hub).
- `dist/cli.js` and the `bin` link in core.
- **Tarball filenames.** npm strips the `@scope/` prefix, so the core package `@arnilo/prism` produces a tarball named `arnilo-prism-0.0.1.tgz`; first-party packages produce `arnilo-prism-provider-<name>-0.0.1.tgz` / `arnilo-prism-compaction-<name>-0.0.1.tgz`; umbrella packages produce `arnilo-prism-providers-0.0.1.tgz` / `arnilo-prism-compaction-0.0.1.tgz` / `arnilo-prism-all-0.0.1.tgz`. The CLI bin name `prism` is unaffected by the package name (`npx prism` still works; npm allows the bin field to differ from the package name).

Excluded from every tarball by `files` negation:

- `dist/__tests__/` — compiled tests and the meta-tests (`packaging.test.js`, `install-smoke.test.js`, `docs.test.js`, `network-free-guard.test.js`, and the phase boundary tests).
- `dist/**/*.map` — source maps. Source maps are still emitted locally (`tsconfig` `sourceMap: true`) for debugging; the `!dist/**/*.map` line is the **map-retention knob**: remove that negation to ship source maps in releases.
- `src/`, `plans/`, `.agents/`, `.github/`, `tsconfig*.json`, `roadmap.md`, and `package-lock.json` are never packed (outside the `files` whitelist and/or explicitly ignored).

`sideEffects` is `false` for every first-party package (their entrypoints export only types and declarations). Core sets `sideEffects: ["dist/cli.js"]` because `src/cli.ts` runs the CLI and sets `process.exitCode` at import time; every other core entrypoint is side-effect-free.

## Request/response example

```json
{
  "name": "host-app",
  "type": "module",
  "dependencies": {
    "@arnilo/prism": "0.0.1",
    "@arnilo/prism-provider-openai": "0.0.1",
    "@arnilo/prism-compaction-observational-memory": "0.0.1"
  }
}
```

Installing the provider/compaction packages without `@arnilo/prism` present produces an unmet-peer error (the `@arnilo/prism` peer is required, not optional):

```text
npm error code ERESOLVE
npm error Could not resolve dependency:
npm error peer @arnilo/prism@"0.0.1" from @arnilo/prism-provider-openai@0.0.1
```

## Implementation example

```ts
// Core runtime
import { createAgent, createAgentSession } from "@arnilo/prism";
// OpenAI-compatible provider subpath
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
// Node filesystem config loader
import { loadConfigFile } from "@arnilo/prism/node/config";

const agent = createAgent({ provider: createOpenAICompatibleProvider({ /* ... */ }) });
const session = createAgentSession(agent, { /* session store, etc. */ });
```

Local release dry-run mirrors the GitHub Actions `verify` job (build + tests + packaging/install-smoke guards + pack dry-run):

```bash
npm run release:dry-run
```

## Extension and configuration notes

- **Required `@arnilo/prism` peer.** Every first-party package declares `peerDependencies: { "@arnilo/prism": "0.0.1" }` with no `peerDependenciesMeta` (non-optional). The range stays pinned to `0.0.1` for the 0.x series and will widen to `^1.0.0` at the 1.x stable release. Inside the workspace each package also declares `"@arnilo/prism": "file:../.."` in `devDependencies` so `npm install` resolves the peer locally; that devDependency is stripped from consumer installs and is not a runtime dependency.
- **Public access.** All 11 manifests (8 code packages + 3 umbrellas) declare `"publishConfig": { "access": "public" }` so a manual `npm publish` of a scoped `@arnilo/prism-*` package defaults to public rather than `restricted` (paid). The `release.yml` flags (`npm publish --access public` + `npm publish --workspaces --access public`) are belt-and-suspenders backups.
- **Map retention knob.** Source maps are emitted locally but stripped from tarballs by `!dist/**/*.map`. Removing that `files` negation ships maps in releases (larger tarballs, better consumer stack traces).
- **Release workflow.** `.github/workflows/release.yml` has two jobs. `verify` runs on push (main/master, `v*` tags) and pull requests: `npm ci`, `npm test` (builds core + workspaces first, then runs the packaging and install-smoke guards), and `npm run pack:dry-run`. `publish` runs only on `refs/tags/v*` after `verify` succeeds: `npm run build`, then `npm publish --access public` for core (first, because packages require the `@arnilo/prism` peer on the registry) and `npm publish --workspaces --access public`. With no `NPM_TOKEN` secret it runs `--dry-run` instead of a real publish. `permissions.id-token: write` is set so `--provenance` can be added later without re-architecting permissions.
- **Adding a package.** New workspace packages are picked up automatically by `npm run build --workspaces`, `npm test --workspaces`, `npm run pack:dry-run`, the packaging guard (`src/__tests__/packaging.test.ts`), and the install-smoke test (`src/__tests__/install-smoke.test.ts`) via the workspace glob; add the package to both tests' config arrays for explicit per-package assertions.

## Security and performance notes

- **No secrets or fixtures in tarballs.** Tests, fixtures, `src/`, `plans/`, `.agents/`, `roadmap.md`, and `tsconfig` files are excluded. The `docs avoid real-looking secret examples` docs check and the packaging guard's deny list prevent secret-bearing fixtures from shipping.
- **Live tests stay opt-in.** The default `npm test` is network-free by construction and never sets these vars. Three opt-in gate vars exist, each gating a different set of placeholder live smoke tests; none is set by default, in CI, or during release verification. Every gated live test is currently an empty placeholder awaiting provider-specific/worker checks in a later phase.
  - `PRISM_LIVE_PROVIDER_TESTS=1` — gates the five provider packages' `src/__tests__/live.test.ts` (`@arnilo/prism-provider-openai`, `provider-opencode-go`, `provider-openrouter`, `provider-zai`, `provider-kimi`).
  - `PRISM_LIVE_COMPACTION_TESTS=1` — gates `@arnilo/prism-compaction-llm`'s live summary-provider smoke test.
  - `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` — gates `@arnilo/prism-compaction-observational-memory`'s live worker/provider checks.
  - These guards use fake-safe names and carry no real credentials; the gated bodies intentionally do not read `OPENAI_API_KEY` or any provider key — they are placeholders. Itemize any provider-specific key env here only when a future phase adds a real live check that reads it.
  - Enforced by `network-free-guard.test.ts` (default suite stays network-free) and by source-scanning meta-tests that assert each `live.test.ts` keeps its `skip:` guard.
- **Install smoke is offline.** The install-smoke test packs core + every package into a temp dir and installs the tarballs with `--offline --no-audit --no-fund` into a fresh temp project; zero registry fetches happen because Prism has no runtime dependencies.
- **Offline test budget.** The default `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) is pinned at **< 60s on Node 20** with a measured local baseline of ~45s (build ~18s + network-free tests/workspace tests/packaging smoke ~27s). The `npm test` CI step has `timeout-minutes: 3` as a hang backstop. The budget was raised from 30s after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests; optimize before raising it again.

## Release checklist

Every release gate maps to an exact enforcement test or command, so the checklist is executable rather than manual. Run `npm run release:dry-run` to exercise the offline subset (build + network-free `npm test` + `npm run pack:dry-run`); run `npm run typecheck` to add the examples typecheck (`tsc -p examples --noEmit`). The GitHub Actions `verify` job runs `npm ci`, `npm test`, and `npm run pack:dry-run` on every push and pull request.

| Gate | Enforcement |
| --- | --- |
| Docs coverage for persistence/runtime/migration surfaces | `docs.test.ts` enrolls every API page in `apiPages` (heading + index-link + bare-specifier + secret-scan checks); dedicated section assertions pin `database-persistence.md`, `runs-and-usage.md`, `session-stores-and-branching.md`, `migration.md`, `agent-definitions.md`, `performance.md`, and the Phase 41 `external_app_example_*` / `phase41_external_app_surfaces_*` gates. |
| Package exports/subpaths resolve to built output | `public-export-contract.test.ts` asserts every `exports`/`main`/`types`/`bin` target resolves to a built file under `dist/` with a sibling `.d.ts`, and no target escapes `dist/` (no `src/` or `examples/` leak). |
| Public-API drift | `public-export-contract.test.ts` `phase39_public_protocol_exports_and_types_do_not_drift` pins the runtime protocol (`providerToolCallDelta`, `ToolCallDeltaContent`), the `/testing/provider-conformance` subpath shape, and the observational-memory runtime `.d.ts` surface. |
| Examples compile and are listed | `npm run typecheck` runs `tsc -p examples --noEmit`; `docs.test.ts` `examples_files_exist_and_index_links_examples` checks every example file exists and is listed in `examples/README.md`. |
| Examples run to completion with no secret leakage | `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` runs each demo (Node strips TypeScript types natively) with exit-0 and real-secret scans; `external_app_example_*` pins the DB-backed adapter reference exercising the `RunLedger`, branch-handle checkout, fork, and prior-run resume. |
| Tarball excludes built tests, source maps, and source | `packaging.test.ts` deny list rejects `dist/__tests__/`, `*.map`, `src/`, `plans/`, and internal files per package; confirms `README.md`/`LICENSE`/`CHANGELOG.md` ship, the core tarball ships `docs/` + `dist/cli.js`, and every `exports` target is present as compiled output. |
| Network-free + offline test budget | `network-free-guard.test.ts` keeps the default suite network-free; budget pinned `< 60s` (measured baseline above). Install-smoke is offline (`--offline --no-audit --no-fund`, zero registry fetches). |
| Core security invariants reaffirmed | Runtime/docs tests hold the trust boundary: **no built-in app tools** (hosts register tools; the core ships only the mock provider and contract helpers), **no hidden provider/credential globals** (providers/credentials are host-owned `AgentConfig` fields, resolved via explicit `providerSource`/`CredentialResolver`), **no auto package discovery** (provider/tool/skill packages are opt-in and individually installed; contribution discovery is realpath-contained and emits inert envelopes the host registers), and **no secret persistence in core** (redaction applies before any `RunLedger`/`SessionStore` append; the ledger gate asserts each message event is written exactly once and redacted). |

A change that adds a public persistence/runtime surface, a new package, or a new example must extend the matching row's enforcement (add the page to `apiPages`, the package to the `packages` array, or the example to the demos list) so the checklist stays self-maintaining.

## Related APIs

- [`docs/provider-packages.md`](provider-packages.md): first-party provider package layout and setup.
- [`docs/cli-rpc.md`](cli-rpc.md): the `prism` CLI bin and RPC protocol shipped as `dist/cli.js`.
- [`docs/configuration-and-manifests.md`](configuration-and-manifests.md): package manifest merging and validation.
