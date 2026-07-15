# Release and install

## What it does

Prism is published as one core package, seventeen first-party capability packages, and six pure-manifest family/profile packages. This page describes how they are packed, what each tarball contains, how to install them, the required `@arnilo/prism` peer dependency, the release workflow, and the offline test budget.

Core package:

- `@arnilo/prism` — the runtime, contracts, registries, streaming events, CLI, and the `/docs` hub. `files`: `dist` (with `!dist/__tests__` and `!dist/**/*.map` negations), `docs`, `CHANGELOG.md`. `bin`: `prism` -> `./dist/cli.js`. `sideEffects`: `["dist/cli.js"]`.

First-party workspace packages (each `peerDependencies: { "@arnilo/prism": "0.0.4" }`, non-optional; `sideEffects: false`):

- `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-openrouter`, `@arnilo/prism-provider-kimi`, `@arnilo/prism-provider-zai`, `@arnilo/prism-provider-opencode-go`, `@arnilo/prism-provider-neuralwatt` — provider adapters.
- `@arnilo/prism-compaction-llm` — optional LLM-backed compaction strategy.
- `@arnilo/prism-compaction-observational-memory` — optional source-backed observational memory.
- `@arnilo/prism-observability-opentelemetry` — optional OpenTelemetry adapter for `AgentEvent` streams.
- `@arnilo/prism-tool-validator-json-schema` — bounded JSON Schema tool argument validation.
- `@arnilo/prism-mcp` — MCP transport/client bridge mapping remote tools into core dispatch.
- `@arnilo/prism-coding-agent` / `@arnilo/prism-coding-security` — optional host shell/filesystem tools plus approval, containment, and sandbox policy.
- `@arnilo/prism-session-store-sqlite` / `@arnilo/prism-session-store-postgres` — production persistence, checkpoints, and leases.
- `@arnilo/prism-credentials-node` — encrypted-file and keychain credential storage.
- `@arnilo/prism-workflows` — typed bounded DAG orchestration over sessions/tools/events/persistence.

Family/profile packages (pure manifests, no code or `dist`; ship `README.md` and `CHANGELOG.md`; use exact hard `dependencies`):

- `@arnilo/prism-providers` — all 6 `@arnilo/prism-provider-*` packages.
- `@arnilo/prism-compaction` — both `@arnilo/prism-compaction-*` packages.
- `@arnilo/prism-base` — core + compaction family + JSON Schema validator; excludes providers, MCP, native credentials/storage, and coding tools.
- `@arnilo/prism-code` — base + coding-agent + coding-security + MCP; providers and persistence remain explicit choices.
- `@arnilo/prism-sdk` — base + workflows + MCP + Node credentials + OpenTelemetry; providers and persistence remain explicit choices.
- `@arnilo/prism-all` — code + SDK + providers + SQLite + PostgreSQL, transitively installing every first-party package. Installation alone activates no network, telemetry, database, MCP, shell, or filesystem capability.

Profile footprint snapshot (Node 24/npm 11, lockfile graph, 2026-07-14): `base` reaches 6 first-party packages and one external dependency root (Ajv); `code` reaches 10 and three (Ajv, MCP SDK, diff); `sdk` reaches 11 and three (Ajv, MCP SDK, keyring); `all` reaches all 24 manifests and six (those plus better-sqlite3 and pg). Final clean-RC manifest tarballs are 998 B, 995 B, 1,001 B, and 1,393 B respectively, including their 0.0.4 changelogs. Native database drivers stay out of base/code/sdk; both appear only in all.

Each code package's `files` array is `["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]`; `README.md`, `LICENSE`, and `CHANGELOG.md` ship in every code-package tarball, the core tarball also ships the `docs/` directory, and family/profile tarballs ship `README.md` + `CHANGELOG.md` + `package.json`.

## When to use it

Use this page when installing Prism into a host app, when adding a first-party package, when cutting a release, or when investigating why a tarball contains (or excludes) a file.

Consumers install the core package for the runtime and add first-party packages for provider adapters or compaction strategies. Each first-party package requires the `@arnilo/prism` peer at its declared version; install `@arnilo/prism` alongside them or npm will report an unmet peer.

## Inputs / request

| Operation | Command |
| --- | --- |
| Install core only | `npm install @arnilo/prism` |
| Install core + all providers | `npm install @arnilo/prism @arnilo/prism-providers` |
| Install minimal safe profile | `npm install @arnilo/prism-base` |
| Install coding-agent profile | `npm install @arnilo/prism-code @arnilo/prism-provider-openai` |
| Install application SDK profile | `npm install @arnilo/prism-sdk @arnilo/prism-provider-openai @arnilo/prism-session-store-sqlite` |
| Install everything | `npm install @arnilo/prism-all` |
| Install core + a single provider | `npm install @arnilo/prism @arnilo/prism-provider-openai` |
| Build everything (core + workspaces) | `npm run build` |
| Run the default (network-free) test suite | `npm test` |
| Dry-run pack core + every package | `npm run pack:dry-run` |
| Local mirror of the release verify gate | `npm run release:dry-run` |
| Validate clean tag/version/ranges and reject registry collisions | `npm run release:check -- --version 0.0.4` |
| Preview deterministic publish order | `npm run release:publish -- --version 0.0.4 --dry-run --allow-dirty --allow-untagged` |
| Resume interrupted tagged publication | `npm run release:publish -- --version 0.0.4 --resume --report release-artifacts/publish-report.json` |
| Full SDK readiness gate (typecheck + offline tests + pack) | `npm run sdk:ready` |

Public core import specifiers (from the root `exports` map):

| Specifier | Resolves to |
| --- | --- |
| `@arnilo/prism` | `dist/index.{js,d.ts}` |
| `@arnilo/prism/providers/openai-compatible` | `dist/providers/openai-compatible.{js,d.ts}` |
| `@arnilo/prism/providers/transport` | `dist/providers/transport.{js,d.ts}` |
| `@arnilo/prism/providers/openai` | `dist/providers/openai-primitives.{js,d.ts}` |
| `@arnilo/prism/providers/media` | `dist/providers/media.{js,d.ts}` |
| `@arnilo/prism/testing/provider-conformance` | `dist/testing/provider-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/session-store-conformance` | `dist/testing/session-store-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/compaction-conformance` | `dist/testing/compaction-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/tool-conformance` | `dist/testing/tool-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/extension-conformance` | `dist/testing/extension-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/persistence-schema` | `dist/testing/persistence-schema.{js,d.ts}` |
| `@arnilo/prism/testing/run-ledger-conformance` | `dist/testing/run-ledger-conformance.{js,d.ts}` |
| `@arnilo/prism/node/config` | `dist/node/config.{js,d.ts}` |
| `@arnilo/prism/node/settings` | `dist/node/settings.{js,d.ts}` |
| `@arnilo/prism/node/trust` | `dist/node/trust.{js,d.ts}` |
| `@arnilo/prism/node/session-store-jsonl` | `dist/node/session-store-jsonl.{js,d.ts}` |
| `@arnilo/prism/node/contribution-discovery` | `dist/node/contribution-discovery.{js,d.ts}` |
| `@arnilo/prism/node/instruction-injectors` | `dist/node/instruction-injectors.{js,d.ts}` |
| `@arnilo/prism/node/system-prompts` | `dist/node/system-project-prompts.{js,d.ts}` |
| `@arnilo/prism/node/agent-definitions` | `dist/node/agent-definitions.{js,d.ts}` |

## Outputs / response / events

A packed tarball contains only public compiled output and release files:

- `dist/**` compiled `.js` and `.d.ts` for every exported subpath.
- Code packages ship `README.md`, `LICENSE`, and `CHANGELOG.md`; family/profile packages ship `README.md` and `CHANGELOG.md`.
- The core tarball additionally ships the full `docs/` directory (the docs hub).
- `dist/cli.js` and the `bin` link in core.
- **Tarball filenames.** npm strips the `@scope/` prefix, so the core package `@arnilo/prism` produces a tarball named `arnilo-prism-0.0.4.tgz`; first-party packages produce `arnilo-prism-provider-<name>-0.0.4.tgz` / `arnilo-prism-compaction-<name>-0.0.4.tgz` / `arnilo-prism-coding-agent-0.0.4.tgz`; family/profile packages produce `arnilo-prism-{providers,compaction,base,code,sdk,all}-0.0.4.tgz`. The CLI bin name `prism` is unaffected by the package name (`npx prism` still works; npm allows the bin field to differ from the package name).

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
    "@arnilo/prism": "0.0.4",
    "@arnilo/prism-provider-openai": "0.0.4",
    "@arnilo/prism-compaction-observational-memory": "0.0.4"
  }
}
```

Installing the provider/compaction packages without `@arnilo/prism` present produces an unmet-peer error (the `@arnilo/prism` peer is required, not optional):

```text
npm error code ERESOLVE
npm error Could not resolve dependency:
npm error peer @arnilo/prism@"0.0.4" from @arnilo/prism-provider-openai@0.0.4
```

## Implementation example

```ts
import { createAgent, createAgentSession, type ModelConfig } from "@arnilo/prism";
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
import { loadConfigFile } from "@arnilo/prism/node/config";

const config = await loadConfigFile("./prism.config.json");
const model: ModelConfig = { provider: "openai-compatible", model: "gpt-4.1-mini" };
const provider = createOpenAICompatibleProvider({
  id: "openai-compatible",
  baseUrl: String(config.providers?.openai?.baseUrl ?? "https://api.openai.com/v1"),
  apiKey: () => process.env.OPENAI_API_KEY,
});
const agent = createAgent({ model, provider });
const session = createAgentSession({ agent });
```

Local release dry-run mirrors the GitHub Actions `verify` job and delegates to the SDK readiness gate:

```bash
npm run release:dry-run
```

For SDK readiness, run the same one-command gate directly. It composes existing scripts only: examples/workspace typecheck, build, network-free core tests (docs/export/package/install smoke included), workspace tests, and pack dry-run.

```bash
npm run sdk:ready
```

Release publication derives all 24 packages from the workspace once, validates exact `0.0.4` manifest/lockfile/internal ranges, then uses deterministic dependency order. `release:check` requires a clean commit tagged `v0.0.4` and rejects any existing registry version. `release:publish --resume` skips only registry versions whose internal dependency fingerprint matches the local manifest; conflicting versions fail closed. Each attempted package is written immediately to the JSON report, so a failed job can rerun safely. `--dry-run` still performs registry availability checks and invokes `npm publish --dry-run` with explicit public access, provenance, and `latest` tag.

```bash
npm run release:check -- --version 0.0.4
npm run release:publish -- --version 0.0.4 --dry-run --allow-dirty --allow-untagged
```

`--allow-dirty` and `--allow-untagged` exist only for local preview; real publication and CI never pass them. npm registry calls occur only in these release preflight/publication commands, never build/test/package discovery.

Optional live smoke tests stay separate from SDK readiness because they require credentials and network access:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present
```

### 0.0.4 publish handoff

**Decision: GO after operator prerequisites below.** Code, tests, package graph, registry availability, and clean-RC artifacts passed. No package was published during readiness work.

#### npm authentication prerequisite

The existing GitHub Actions secret `NPM_TOKEN` is used only by the publish step as `NODE_AUTH_TOKEN`, matching previous Prism releases. Confirm that token remains valid and can publish existing and new public packages under `@arnilo`; no additional secret or manual npm publish is required. The workflow also requests OIDC and always passes `--provenance`.

#### Release commit and tag

Merge through the protected release branch, then run these commands from a clean checkout of the protected merge commit. `git push origin v0.0.4` is the workflow dispatch; there is no manual publish command.

```bash
# Prepare and push the release commit.
git diff --check
npm ci
npm run sdk:ready
git add -A
git diff --cached --check
git commit -S -m "Release 0.0.4"
git push origin HEAD

# Merge/confirm protected branch CI, then check out that exact clean merge commit.
test -z "$(git status --porcelain)"
npm ci
npm run release:check -- --version 0.0.4 --allow-untagged --report /tmp/prism-0.0.4-preflight.json

git tag -s v0.0.4 -m "Prism 0.0.4"
git verify-tag v0.0.4
test "$(git rev-parse HEAD)" = "$(git rev-list -n 1 v0.0.4)"
npm run release:check -- --version 0.0.4 --report /tmp/prism-0.0.4-tagged-preflight.json
git push origin v0.0.4
```

The tag workflow's only publication command is `npm run release:publish -- --version "${GITHUB_REF_NAME#v}" --resume --report release-artifacts/publish-report.json`. Latest registry preflight returned `available` for all 24 `0.0.4` versions. Publisher order is stable and dependency-safe:

```text
 1 @arnilo/prism
 2 @arnilo/prism-coding-agent
 3 @arnilo/prism-compaction-llm
 4 @arnilo/prism-compaction-observational-memory
 5 @arnilo/prism-credentials-node
 6 @arnilo/prism-mcp
 7 @arnilo/prism-observability-opentelemetry
 8 @arnilo/prism-provider-kimi
 9 @arnilo/prism-provider-neuralwatt
10 @arnilo/prism-provider-openai
11 @arnilo/prism-provider-opencode-go
12 @arnilo/prism-provider-openrouter
13 @arnilo/prism-provider-zai
14 @arnilo/prism-session-store-postgres
15 @arnilo/prism-session-store-sqlite
16 @arnilo/prism-tool-validator-json-schema
17 @arnilo/prism-workflows
18 @arnilo/prism-coding-security
19 @arnilo/prism-compaction
20 @arnilo/prism-providers
21 @arnilo/prism-base
22 @arnilo/prism-code
23 @arnilo/prism-sdk
24 @arnilo/prism-all
```

#### Interruption and resume

Do not create another tag or rerun packages manually. Re-run failed jobs for the same tag in GitHub Actions. The workflow invokes `release:publish --resume`: registry versions with matching names, versions, and internal dependency fingerprints are skipped; any mismatch stops the job. Retain `release-artifacts-v0.0.4` and `publish-report-v0.0.4` for audit.

#### Bounded post-publish smoke

Download the workflow artifact and run `sha256sum -c SHA256SUMS`. Then verify all registry versions/tags/integrity and install the complete profile in a fresh directory:

```bash
while read -r package; do
  test "$(npm view "$package@0.0.4" version)" = "0.0.4"
  test "$(npm view "$package" dist-tags.latest)" = "0.0.4"
  npm view "$package@0.0.4" dist.integrity >/dev/null
done <<'PACKAGES'
@arnilo/prism
@arnilo/prism-coding-agent
@arnilo/prism-compaction-llm
@arnilo/prism-compaction-observational-memory
@arnilo/prism-credentials-node
@arnilo/prism-mcp
@arnilo/prism-observability-opentelemetry
@arnilo/prism-provider-kimi
@arnilo/prism-provider-neuralwatt
@arnilo/prism-provider-openai
@arnilo/prism-provider-opencode-go
@arnilo/prism-provider-openrouter
@arnilo/prism-provider-zai
@arnilo/prism-session-store-postgres
@arnilo/prism-session-store-sqlite
@arnilo/prism-tool-validator-json-schema
@arnilo/prism-workflows
@arnilo/prism-coding-security
@arnilo/prism-compaction
@arnilo/prism-providers
@arnilo/prism-base
@arnilo/prism-code
@arnilo/prism-sdk
@arnilo/prism-all
PACKAGES

consumer="$(mktemp -d)"
cd "$consumer"
npm init -y >/dev/null
npm install --no-audit --no-fund @arnilo/prism-all@0.0.4
node --input-type=module <<'NODE'
for (const name of [
  "@arnilo/prism", "@arnilo/prism-coding-agent", "@arnilo/prism-coding-security",
  "@arnilo/prism-compaction-llm", "@arnilo/prism-compaction-observational-memory",
  "@arnilo/prism-credentials-node", "@arnilo/prism-mcp", "@arnilo/prism-observability-opentelemetry",
  "@arnilo/prism-provider-kimi", "@arnilo/prism-provider-neuralwatt", "@arnilo/prism-provider-openai",
  "@arnilo/prism-provider-opencode-go", "@arnilo/prism-provider-openrouter", "@arnilo/prism-provider-zai",
  "@arnilo/prism-session-store-postgres", "@arnilo/prism-session-store-sqlite",
  "@arnilo/prism-tool-validator-json-schema", "@arnilo/prism-workflows",
]) await import(name);
NODE
./node_modules/.bin/prism --help >/dev/null
npm audit signatures --json --include-attestations > npm-signatures.json
```

This smoke is bounded to registry metadata, imports, CLI startup, checksums, signatures, and provenance; do not rerun the full release suite after immutable publication.

#### Rollback limitations

npm publication is not transactional and published versions are immutable. Partial publication is a resume case, not rollback. For a confirmed systemic defect after completion, deprecate every affected `@0.0.4`; restore `latest` to `0.0.3` only for the 13 previously published packages, and remove `latest` from the 11 first-publication packages. Exact `0.0.4` installs remain possible, so publish a fixed version promptly. Do not unpublish except for a security/legal emergency under npm policy.

## Extension and configuration notes

- **Required `@arnilo/prism` peer.** Every first-party package declares `peerDependencies: { "@arnilo/prism": "0.0.4" }` with no `peerDependenciesMeta` (non-optional). The range stays pinned to `0.0.4` for the 0.x series and will widen to `^1.0.0` at the 1.x stable release. Inside the workspace each package also declares `"@arnilo/prism": "file:../.."` in `devDependencies` so `npm install` resolves the peer locally; that devDependency is stripped from consumer installs and is not a runtime dependency.
- **Public access.** All 24 manifests (18 code packages + 6 family/profile packages) declare `"publishConfig": { "access": "public" }`; the publisher also passes `--access public` explicitly because scoped packages otherwise default to restricted on first publish.
- **Map retention knob.** Source maps are emitted locally but stripped from tarballs by `!dist/**/*.map`. Removing that `files` negation ships maps in releases (larger tarballs, better consumer stack traces).
- **Release workflow.** `.github/workflows/release.yml` has four jobs. `verify` runs the full SDK readiness gate on Node 24: `npm ci`, then `npm run sdk:ready` (`npm run typecheck`, network-free `npm test`, and `npm run pack:dry-run`). `node20-compat` runs on Node 20: `npm ci`, `npm run build`, then imports every public root `exports` default target from `dist/`. This proves published-package basics under declared `engines.node >=20` without docs examples, which require Node >=22.6 native TypeScript stripping. `postgres-integration` runs the PostgreSQL suite against `postgres:16`. `publish` runs only for exact `v*` tags after all three gates, checks clean/tagged state and the complete 0.0.4 graph, then publishes in topological order through `scripts/release.mjs`. The existing `NPM_TOKEN` GitHub secret is exposed only to the publish step; `id-token: write` also enables OIDC where configured. npm receives `--provenance --access public --tag latest`; no credential value is placed in source or output. Before publishing, CI packs all 24 tarballs, generates `SHA256SUMS`, and retains both pack manifests and artifacts for 30 days. Registry state is the resume journal: matching published packages are skipped, mismatches stop publication, and an incremental package-status report is also retained for 30 days. Local `npm run release:dry-run` delegates to `npm run sdk:ready`; local PostgreSQL coverage is `PRISM_TEST_POSTGRES_URL=... npm run test:postgres`.
- **Adding a package.** New workspace packages are picked up automatically by `npm run build --workspaces`, `npm test --workspaces`, `npm run pack:dry-run`, the packaging guard (`src/__tests__/packaging.test.ts`), and the install-smoke test (`src/__tests__/install-smoke.test.ts`) via the workspace glob; add the package to both tests' config arrays for explicit per-package assertions.

## Security and performance notes

- **No secrets or fixtures in tarballs.** Tests, fixtures, `src/`, `plans/`, `.agents/`, `roadmap.md`, and `tsconfig` files are excluded. The `docs avoid real-looking secret examples` docs check and the packaging guard's deny list prevent secret-bearing fixtures from shipping.
- **Live tests stay opt-in.** The default `npm test` is network-free by construction and never sets these vars. Provider/compaction live gates stay credential-gated and are not set by default or during `sdk:ready`. The PostgreSQL adapter live matrix is the exception that runs in CI via the dedicated `postgres-integration` job (still skipped in the default suite).
  - `PRISM_LIVE_PROVIDER_TESTS=1` — gates the six provider packages' `src/__tests__/live.test.ts` (`@arnilo/prism-provider-openai`, `provider-opencode-go`, `provider-openrouter`, `provider-zai`, `provider-kimi`, `provider-neuralwatt`). Each provider live test also requires its own API key env var and skips safely when it is missing:
    - `OPENAI_API_KEY` for `@arnilo/prism-provider-openai`
    - `OPENROUTER_API_KEY` for `@arnilo/prism-provider-openrouter`
    - `KIMI_API_KEY` for `@arnilo/prism-provider-kimi`
    - `ZAI_API_KEY` for `@arnilo/prism-provider-zai`
    - `NEURALWATT_API_KEY` for `@arnilo/prism-provider-neuralwatt`
    - `OPENCODE_API_KEY` for `@arnilo/prism-provider-opencode-go`
  - `PRISM_LIVE_COMPACTION_TESTS=1` — gates `@arnilo/prism-compaction-llm`'s live summary-provider smoke test (placeholder).
  - `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` — gates `@arnilo/prism-compaction-observational-memory`'s live worker/provider checks (placeholder).
  - `PRISM_TEST_POSTGRES_URL` — gates `@arnilo/prism-session-store-postgres` integration tests (`runSessionStoreConformance` / `runRunLedgerConformance` against a real database). Local: `PRISM_TEST_POSTGRES_URL=... npm run test:postgres`. CI: `postgres-integration` job.
  - `PRISM_TEST_KEYCHAIN=1` — gates `@arnilo/prism-credentials-node` system-keychain round-trips (requires a working OS keychain backend; skipped by default).
  - Provider live tests read the API key from the env only when both gates are set; the key is used as a bearer token and never logged. `assertNoSecretLeak` verifies the key value does not appear in any streamed event. The compaction placeholders still carry no real credentials.
  - Enforced by `network-free-guard.test.ts` (default suite stays network-free) and by source-scanning meta-tests that assert each `live.test.ts` keeps its `skip:` guard.
- **Install smoke is offline.** The install-smoke test packs core + every package into a temp dir and installs tarballs with `--offline --no-audit --no-fund` into a fresh project. External dependencies are satisfied from the lockfile-backed npm cache prepared by `npm ci`; any attempted uncached registry fetch fails the gate.
- **Offline test budget.** The default `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) is pinned at **< 60s on Node 20** with a measured local baseline of ~45s (build ~18s + network-free tests/workspace tests/packaging smoke ~27s). The full CI `sdk:ready` gate runs on Node 24 because docs tests execute `examples/*.ts` via native TypeScript stripping. `npm run sdk:ready` also runs typecheck and pack dry-run, so it is allowed to exceed the `npm test` budget while remaining network-free. The CI `sdk:ready` step has `timeout-minutes: 5` as a hang backstop; the separate Node 20 compatibility step has `timeout-minutes: 3`. The budget was raised from 30s after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests; optimize before raising it again.

### 0.0.4 dependency audit decision (2026-07-14)

`npm audit --audit-level=high` reports 0 vulnerabilities and `npm ls --all` is clean. Lockfile registry entries all carry integrity hashes and resolved registry URLs; direct/runtime dependency licenses are permissive. `@types/node` was updated within its declared Node 22 range from 22.19.21 to 22.20.1. No runtime dependency changed.

Major updates are deliberately deferred from this feature release: `diff` 8.0.4 → 9 requires coding-tool compatibility review, TypeScript 5.9.3 → 7 requires compiler/output review, and `@types/node` 22 → 26 would exceed the project's Node 20 support target. Revisit each in a dedicated dependency update after 0.0.4; none addresses a current audit finding. Native `better-sqlite3` is the sole dependency with an install hook and remains isolated in the opt-in SQLite package.

### 0.0.4 release-candidate verification — 2026-07-15

Release candidate was copied from the current repository file set into a fresh Git repository, committed, and verified from a clean tree. `npm ci` completed in 1 s and all build/test/pack operations left zero generated or modified files.

| Gate | Result |
| --- | --- |
| Node 24 full matrix | `npm test` 28.209 s; `npm run sdk:ready` 51.500 s; 1,475 tests (1,450 pass, 25 explicit live skips, 0 fail). The `< 60s` `npm test` budget and 5-minute SDK hang backstop hold. |
| Node 20 compatibility | Node 20.20.2 clean `npm ci` + build; all 20 root export targets imported. Node 24.18.0 repeated the same 20-import smoke. |
| PostgreSQL | Fresh `postgres:16` container; all 15 adapter integration tests passed with 0 skips/failures. |
| Packed consumer | All 24 exact RC tarballs installed offline; 37 code-package/root-subpath imports loaded (six family/profile packages are manifest-only); `prism --help` exited successfully. |
| Artifact contents | 24 tarballs, 539,285 packed bytes / 2,044,155 unpacked bytes. Core: 342,328 B; base/code/sdk/all: 998/995/1,001/1,393 B. Zero tests, source maps, source, plans, internal reports, fixtures, lockfiles, credential files, unsafe paths, or version/range/access mismatches. The small profile differences from the earlier working-tree snapshot are gzip-level only; unpacked sizes are unchanged. |
| Reproducibility | A second clean tagged dry-run produced the same SHA-1 tarball shasum for all 24 packages. Registry preflight reported all 24 versions available. |
| Supply chain | `npm audit --audit-level=high`: 0 vulnerabilities; `npm ls --all`: clean. CycloneDX 1.5 SBOM contains root plus 173 components with no missing/prohibited licenses. Pack manifests include SHA-1 and SHA-512 integrity; 28 SHA-256 checksums cover 24 tarballs, two pack manifests, RC manifest, and SBOM and all re-verify. Source/artifact private-key/token scans found 0 matches. |
| Provenance | Clean exact `v0.0.4` publication dry-run completed 24/24 with explicit public/latest/provenance arguments and no publish. Signed npm provenance attestation is intentionally generated only by the OIDC publish job because creating it requires real registry publication. |
| Performance baselines | Task 2 release measurements remain within ceilings: 500-delta ledger 1.19 ms; 500 JSONL appends 141.10 ms; cached schema validation 0.99 µs; six delayed tools 121.12 ms sequential / 60.92 ms at concurrency 2; SQLite 1,000 appends 31.84 ms; redaction 10,000 objects 4.79 ms; default scrypt/AES 48.09 ms; 1,000-node workflow 27.68 ms. |

RC manifests, SBOM, checksums, and tarballs are retained as CI artifacts rather than committed generated files.

## Release checklist

Every release gate maps to an exact enforcement test or command, so the checklist is executable rather than manual. Run `npm run sdk:ready` for the full local SDK readiness gate: `npm run typecheck`, network-free `npm test`, and `npm run pack:dry-run`. `npm run release:dry-run` is an alias for the same gate. The GitHub Actions `verify` job runs `npm ci` and `npm run sdk:ready` on Node 24; `node20-compat` runs `npm ci`, `npm run build`, and public export imports on Node 20; `postgres-integration` runs the opt-in PostgreSQL adapter suite against a CI Postgres service.

| Gate | Enforcement |
| --- | --- |
| Docs coverage for persistence/runtime/migration surfaces | `docs.test.ts` enrolls every API page in `apiPages` (heading + index-link + bare-specifier + secret-scan checks); dedicated section assertions pin `database-persistence.md`, `runs-and-usage.md`, `session-stores-and-branching.md`, `migration.md`, `agent-definitions.md`, `performance.md`, and the Phase 41 `external_app_example_*` / `phase41_external_app_surfaces_*` gates. |
| Package exports/subpaths resolve to built output | `public-export-contract.test.ts` asserts every `exports`/`main`/`types`/`bin` target resolves to a built file under `dist/` with a sibling `.d.ts`, and no target escapes `dist/` (no `src/` or `examples/` leak). CI `node20-compat` also imports every public root `exports` default target on Node 20. |
| Public-API drift | `public-export-contract.test.ts` `phase39_public_protocol_exports_and_types_do_not_drift` pins the runtime protocol (`providerToolCallDelta`, `ToolCallDeltaContent`), the `/testing/provider-conformance` subpath shape, and the observational-memory runtime `.d.ts` surface. |
| Root SDK export surface freeze | `public-export-contract.test.ts` `root export surface is frozen` snapshots every value and type export of `src/index.ts` (107 value + 69 type) so any add/remove is a deliberate test update; `every frozen value export resolves at runtime` rebuilds `dist/index.js` and asserts each value export is present (catches build drift), and `every frozen type export appears in the built type declarations` asserts each type export is in `dist/index.d.ts`. |
| Examples compile and are listed; runnable demos execute | `npm run typecheck` runs `tsc -p examples --noEmit`; `docs.test.ts` checks every `examples/*.ts` file is listed in `examples/README.md`, then runs demos offline and scans output for secrets. |
| Examples run to completion with no secret leakage | `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` runs each demo (Node strips TypeScript types natively) with exit-0 and real-secret scans; `external_app_example_*` pins the DB-backed adapter reference exercising the `RunLedger`, branch-handle checkout, fork, and prior-run resume. |
| Tarball excludes built tests, source maps, and source | `packaging.test.ts` rejects `dist/__tests__/`, `*.map`, `src/`, `plans/`, and internal files; confirms every package ships README/changelog (and code packages ship LICENSE), core ships docs + CLI, exported targets exist (`dist/index.js` + `dist/index.d.ts` for NeuralWatt), and `prism-all` transitively reaches all 24 manifests. |
| NeuralWatt package/docs/examples release gate | `packaging.test.ts` pins `@arnilo/prism-provider-neuralwatt` package exports/type declarations and `@arnilo/prism-providers`/`@arnilo/prism-all` membership; `docs.test.ts` asserts `docs/index.md` links `providers/neuralwatt.md` and `provider-caching.md`, and that `examples/cache-aware-prompt-assembly.ts` plus `examples/neuralwatt-agent-run.ts` exist and are listed. |
| Version graph and resumable publication | `release.test.ts` covers exact package/lock/range validation, topological order, registry collisions, dry-run, interrupted reports/resume, clean tagged git state, provenance/public/tag arguments, and token-safe errors. `release:check` and `release:publish` derive the workspace graph without a manual package list. |
| Network-free + offline test budget | `network-free-guard.test.ts` keeps the default suite network-free; budget pinned `< 60s` (measured baseline above). Install-smoke is offline (`--offline --no-audit --no-fund`, zero registry fetches). |
| Core security invariants reaffirmed | Runtime/docs tests hold the trust boundary: **no built-in app tools** (hosts register tools; the core ships only the mock provider and contract helpers), **no hidden provider/credential globals** (providers/credentials are host-owned `AgentConfig` fields, resolved via explicit `providerSource`/`CredentialResolver`), **no auto package discovery** (provider/tool/skill packages are opt-in and individually installed; contribution discovery is realpath-contained and emits inert envelopes the host registers), and **no secret persistence in core** (redaction applies before any `RunLedger`/`SessionStore` append; the ledger gate asserts each message event is written exactly once and redacted). |

A change that adds a public persistence/runtime surface, a new package, or a new example must extend the matching row's enforcement (add the page to `apiPages`, the package to the `packages` array, or the example to the demos list) so the checklist stays self-maintaining.

## Related APIs

- [`docs/provider-packages.md`](provider-packages.md): first-party provider package layout and setup.
- [`docs/cli-rpc.md`](cli-rpc.md): the `prism` CLI bin and RPC protocol shipped as `dist/cli.js`.
- [`docs/configuration-and-manifests.md`](configuration-and-manifests.md): package manifest merging and validation.
