# Release and install

## What it does

Prism is published as one core package, forty-one first-party capability packages, and six pure-manifest family/profile packages (**48** publishable manifests total). This page describes how they are packed, what each tarball contains, how to install them, the required `@arnilo/prism` peer dependency, the release workflow, and the offline test budget. The measurable 1.0 readiness gates (command-per-gate) live in [`0.1.0-readiness.md`](./0.1.0-readiness.md).

Core `@arnilo/prism` ships runtime, CLI, templates, and docs. Every code package has a required `@arnilo/prism@0.0.26` peer; profiles are pure manifests. Installation activates no provider, listener, database, browser, credential, or tool capability.

Current **48** publishable manifests:

`@arnilo/prism`, `@arnilo/prism-ag-ui`, `@arnilo/prism-browser`, `@arnilo/prism-coding-agent`, `@arnilo/prism-coding-security`, `@arnilo/prism-compaction-llm`
`@arnilo/prism-compaction-observational-memory`, `@arnilo/prism-credentials-node`, `@arnilo/prism-enterprise-postgres`, `@arnilo/prism-evals`, `@arnilo/prism-mcp`, `@arnilo/prism-memory`
`@arnilo/prism-model-router`, `@arnilo/prism-observability-opentelemetry`, `@arnilo/prism-policy`, `@arnilo/prism-all`, `@arnilo/prism-base`, `@arnilo/prism-caveman`
`@arnilo/prism-code`, `@arnilo/prism-compaction`, `@arnilo/prism-ponytail`, `@arnilo/prism-providers`, `@arnilo/prism-sdk`, `@arnilo/prism-provider-ai-sdk`
`@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-anthropic`, `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, `@arnilo/prism-provider-google`, `@arnilo/prism-provider-kimi`
`@arnilo/prism-provider-neuralwatt`, `@arnilo/prism-provider-ollama`, `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-opencode-go`, `@arnilo/prism-provider-openrouter`, `@arnilo/prism-provider-vertex`
`@arnilo/prism-provider-zai`, `@arnilo/prism-rag`, `@arnilo/prism-server`, `@arnilo/prism-session-store-codecs`, `@arnilo/prism-session-store-nats`, `@arnilo/prism-session-store-postgres`, `@arnilo/prism-session-store-sqlite`
`@arnilo/prism-supervisor`, `@arnilo/prism-tool-validator-json-schema`, `@arnilo/prism-web-tools`, `@arnilo/prism-work-tools`, `@arnilo/prism-workflows`

Core ships `dist`, docs, templates, and `CHANGELOG.md`; code packages ship compiled output, README, license, and changelog. Family/profile packages ship manifest, README, and changelog. `@arnilo/prism-providers` includes all eleven `@arnilo/prism-provider-*` packages.

## When to use it

Use this page when installing Prism into a host app, when adding a first-party package, when cutting a release, or when investigating why a tarball contains (or excludes) a file.

Consumers install the core package for the runtime and add first-party packages for provider adapters or compaction strategies. Each first-party package requires the `@arnilo/prism` peer at its declared version; install `@arnilo/prism` alongside them or npm will report an unmet peer.

## Inputs / request

| Operation | Command |
| --- | --- |
| Install core only | `npm install @arnilo/prism` |
| Scaffold a minimal project | `npx --package @arnilo/prism prism init my-agent [--provider openai] [--with-workflows] [--with-evals]` |
| Install core + all providers | `npm install @arnilo/prism @arnilo/prism-providers` |
| Install minimal safe profile | `npm install @arnilo/prism-base` |
| Install compaction strategies only | `npm install @arnilo/prism @arnilo/prism-compaction` |
| Install coding-agent profile | `npm install @arnilo/prism-code @arnilo/prism-provider-openai` |
| Install application SDK profile | `npm install @arnilo/prism-sdk @arnilo/prism-provider-openai @arnilo/prism-session-store-sqlite` |
| Install everything | `npm install @arnilo/prism-all` |
| Install core + a single provider | `npm install @arnilo/prism @arnilo/prism-provider-openai` |
| 0.0.12 AG-UI (after release) | `npm install @arnilo/prism@0.0.12 @arnilo/prism-ag-ui@0.0.12` |
| Install bounded web research tools | `npm install @arnilo/prism @arnilo/prism-web-tools @arnilo/prism-tool-validator-json-schema` |
| Install browser automation tools | `npm install @arnilo/prism @arnilo/prism-browser playwright-core@1.61.0` |
| Build everything (core + workspaces) | `npm run build` |
| Run the default (network-free) test suite | `npm test` |
| Dry-run pack core + every package | `npm run pack:dry-run` |
| Local mirror of the release verify gate | `npm run release:dry-run` |
| Validate clean tag/version/ranges and reject registry collisions | `npm run release:check -- --version 0.0.26` |
| Preview deterministic publish order | `npm run release:publish -- --version 0.0.26 --dry-run --allow-dirty --allow-untagged` |
| Resume interrupted tagged publication | `npm run release:publish -- --version 0.0.26 --resume --report release-artifacts/publish-report.json` |
| Protected PostgreSQL enterprise suite | `PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres` |
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
| `@arnilo/prism/testing/agent-event-source-conformance` | `dist/testing/agent-event-source-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/session-store-conformance` | `dist/testing/session-store-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/compaction-conformance` | `dist/testing/compaction-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/tool-conformance` | `dist/testing/tool-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/tool-effect-store-conformance` | `dist/testing/tool-effect-store-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/extension-conformance` | `dist/testing/extension-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/persistence-schema` | `dist/testing/persistence-schema.{js,d.ts}` |
| `@arnilo/prism/testing/run-ledger-conformance` | `dist/testing/run-ledger-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/feedback` | `dist/testing/feedback.{js,d.ts}` |
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
- The core tarball additionally ships the full `docs/` directory (the docs hub) and `templates/init/` used by `prism init`.
- `dist/cli.js` and the `bin` link in core.
- **Tarball filenames.** npm strips the `@scope/` prefix, so the core package `@arnilo/prism` produces a tarball named `arnilo-prism-0.0.26.tgz`; first-party packages produce `arnilo-prism-provider-<name>-0.0.26.tgz` / `arnilo-prism-compaction-<name>-0.0.26.tgz` / `arnilo-prism-coding-agent-0.0.26.tgz`; family/profile packages produce `arnilo-prism-{providers,compaction,base,code,sdk,all}-0.0.26.tgz`. The CLI bin name `prism` is unaffected by the package name (`npx prism` still works; npm allows the bin field to differ from the package name).

Excluded from every tarball by `files` negation:

- `dist/__tests__/` — compiled tests and the meta-tests (`packaging.test.js`, `install-smoke.test.js`, `docs.test.js`, `network-free-guard.test.js`, and the phase boundary tests).
- `dist/**/*.map` — source maps. Source maps are still emitted locally (`tsconfig` `sourceMap: true`) for debugging; the `!dist/**/*.map` line is the **map-retention knob**: remove that negation to ship source maps in releases.
- `src/`, `plans/`, `.agents/`, `.github/`, `tsconfig*.json`, `roadmap.md`, and `package-lock.json` are never packed (outside the `files` whitelist and/or explicitly ignored).

`sideEffects` is `false` for every first-party package (their entrypoints export only types and declarations). Core sets `sideEffects: ["dist/cli.js"]` because `src/cli.ts` runs the CLI and sets `process.exitCode` at import time; every other core entrypoint is side-effect-free.

`prism init` generates a private TypeScript project whose default dependency set is only `@arnilo/prism` (plus TypeScript tooling as `devDependencies`). Provider and `--with-workflows` / `--with-evals` flags add only the selected optional packages. Measured default clean install is ~27.5 MB versus the Mastra scaffold baseline of 439 MB.

## Request/response example

```json
{
  "name": "host-app",
  "type": "module",
  "dependencies": {
    "@arnilo/prism": "0.0.26",
    "@arnilo/prism-enterprise-postgres": "0.0.26",
    "@arnilo/prism-provider-openai": "0.0.26"
  }
}
```

Installing the provider/compaction packages without `@arnilo/prism` present produces an unmet-peer error (the `@arnilo/prism` peer is required, not optional):

```text
npm error code ERESOLVE
npm error Could not resolve dependency:
npm error peer @arnilo/prism@"0.0.17" from @arnilo/prism-provider-openai@0.0.17
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

Release publication derives all **48** manifests from the workspace once, validates exact `0.0.26` manifest/lockfile/internal ranges, then uses deterministic dependency order. `release:check` requires a clean commit tagged `v0.0.26` and rejects any existing registry version. `release:publish --resume` skips only registry versions whose internal dependency fingerprint matches the local manifest; conflicting versions fail closed. Each attempted package is written immediately to the JSON report, so a failed job can rerun safely. `--dry-run` performs registry availability checks and invokes `npm publish --dry-run` with explicit public access, provenance, and `latest` tag, but does not publish.

```bash
npm run release:check -- --version 0.0.26
npm run release:publish -- --version 0.0.26 --dry-run --allow-dirty --allow-untagged
```

`--allow-dirty` and `--allow-untagged` exist only for local preview; real publication and CI never pass them. npm registry calls occur only in these release preflight/publication commands, never build/test/package discovery.

Optional live smoke tests stay separate from SDK readiness because they require credentials and network access:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present
```

### 0.0.26 publish handoff

**Decision: GO after protected operator prerequisites below.** Release **0.0.26** (Phase 9, plan 009) ships Git-aware repository enumeration, host-selected LSP language intelligence, managed process sessions (sandbox-backed, ownership-scoped), a reference GitHub forge adapter with idempotent handoff, and an allow-list egress proxy with DNS-rebinding defense and Docker sandbox attestation. Publishable graph grows to **48** manifests (new `@arnilo/prism-session-store-nats`). See [migration](migration.md) `0.0.25 → 0.0.26`, [language intelligence](language-intelligence.md), [process sessions](process-sessions.md), [forge integration](forge-integration.md), and [coding security](coding-security.md).

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/phase9-conformance.test.mjs
node scripts/benchmark-0.0.26.mjs > scripts/benchmark-0.0.26.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate -- --version 0.0.26 --allow-break --allow-dirty --allow-untagged
npm run release:check -- --version 0.0.26 --allow-dirty --allow-untagged --report /tmp/prism-0.0.26-preflight.json
npm run release:publish -- --version 0.0.26 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.26-dry-run.json
git tag -s v0.0.26 -m "Prism 0.0.26"
git verify-tag v0.0.26
git push origin v0.0.26
```

### 0.0.24 publish handoff

**Decision: GO after protected operator prerequisites below.** Release **0.0.24** (Phase 7, plan 007) ships durable `AgentEventSource`, recoverable `ToolEffectStore`, AG-UI 0.0.57 compatibility, and AG-UI MCP/MCP Apps/A2A fronting. Publishable graph stays **47** manifests. Core remains dependency-free; PostgreSQL event source and enterprise `toolEffects` stay opt-in. Delivery is at-least-once — not exactly-once. See [migration](migration.md) `0.0.23 → 0.0.24` and [tool effects](tool-effects.md).

```bash
git diff --check
npm ci
npm run sdk:ready
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" node scripts/benchmark-0.0.24.mjs > scripts/benchmark-0.0.24.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate
npm run release:check -- --version 0.0.24 --allow-dirty --allow-untagged --report /tmp/prism-0.0.24-preflight.json
npm run release:publish -- --version 0.0.24 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.24-dry-run.json
git tag -s v0.0.24 -m "Prism 0.0.24"
git verify-tag v0.0.24
git push origin v0.0.24
```

### 0.0.23 publish handoff

**Decision: GO after protected operator prerequisites below.** Release **0.0.23** (Phase 6, plan 006) adds `@arnilo/prism-enterprise-postgres`, the optional PostgreSQL composition for policy decisions, evaluation records, work-mutation claim/CAS state, and cross-replica model-router rate/budget/circuit state. The publish graph is **47 manifests** (41 code + 6 family/profile; +1 package). `@arnilo/prism-all` includes it; core remains dependency-free. See [migration](migration.md#0022--0023-production-enterprise-state-adapters-intentional-pre-10-contract-changes) and [enterprise PostgreSQL state](enterprise-postgres-state.md).

Intentional pre-1.0 migration points: work idempotency now uses `begin`/CAS transitions and never automatically replays `unknown`; durable router state requires awaited methods plus verified identity and disables `providerSource`. Policy/evaluation/work/router data remain opt-in. No Redis, queue, event delivery, exactly-once effect claim, worker, migration CLI, ORM, or new core API ships.

```bash
git diff --check
npm ci
npm run sdk:ready
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" node scripts/benchmark-0.0.23.mjs
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate
npm run release:check -- --version 0.0.23 --allow-dirty --allow-untagged --report /tmp/prism-0.0.23-preflight.json
npm run release:publish -- --version 0.0.23 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.23-dry-run.json
git tag -s v0.0.23 -m "Prism 0.0.23"
git verify-tag v0.0.23
git push origin v0.0.23
```

`npm publish --dry-run` is non-publishing and applies `publishConfig.access`; the real protected tag workflow is the only publication path, with provenance and resume report. It must run the PostgreSQL suite using a protected, disposable database URL. The recorded benchmark is local/CI comparison evidence, not a portable SLO. npm publication is immutable: a partial publish resumes from the same tag; a confirmed defect requires deprecation plus a fixed version.

### 0.0.22 publish handoff

**Decision: GO after protected operator prerequisites below.** Release **0.0.22** (Phase 5 third-party behavior integrations, plan 005) ships `@arnilo/prism-caveman` and `@arnilo/prism-ponytail` as opt-in behavior packages (upstream Caveman/Ponytail wiring, session mode persistence, progressive disclosure + injector split). Core `@arnilo/prism` runtime is unchanged. The publish graph is **46 manifests** (+2). No intentional pre-1.0 breaks for hosts that do not install the new packages — see [migration](migration.md) under `0.0.21 → 0.0.22 third-party behavior integrations`.

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/budget-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate
npm run release:check -- --version 0.0.22 --allow-dirty --allow-untagged --report /tmp/prism-0.0.22-preflight.json
npm run release:publish -- --version 0.0.22 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.22-dry-run.json
git tag -s v0.0.22 -m "Prism 0.0.22"
git verify-tag v0.0.22
git push origin v0.0.22
```

### Historical release handoffs

Release-specific migration detail lives in [migration](migration.md). The current handoff plus the retained protected matrix below supersede 0.0.16–0.0.21 command transcripts.

### 0.0.15 protected live-canary matrix

Default `npm test`, `npm run sdk:ready`, and `benchmark-0.0.15` are network-free. Run live rows only from a protected scheduled/release environment (or an explicitly authorized operator workstation); never place credentials in fixtures, benchmark JSON, pull-request jobs, or package scripts. Use least-privilege keys, one bounded request, and retain only redacted aggregate status. A blank **checked-in gate** means Prism deliberately has no generic credential fixture: host owns that provider/account compatibility probe.

| Surface | Gate and credential | Checked-in/protected command | Canary scope |
| --- | --- | --- | --- |
| OpenAI Responses baseline | `PRISM_LIVE_PROVIDER_TESTS=1` + `OPENAI_API_KEY` | `npm test -w @arnilo/prism-provider-openai` | Bounded text/tool/abort smoke; key never enters events. |
| OpenAI hosted tools + Realtime | `OPENAI_API_KEY`; protected release harness additionally supplies host-owned safety identifier and hosted-tool entitlement | No generic fixture; record result with the release evidence | Provider-hosted `web_search`/similar execution and Realtime audio/interruption need account-specific availability, so fake transport coverage remains default gate. |
| AI SDK adapter | Host-selected AI SDK v4 model factory plus its provider credential | No generic fixture; run host integration in protected release environment | Exact `@ai-sdk/provider@4.0.4` mapping/version check; Prism does not own upstream model credentials. |
| Kimi / Moonshot | `PRISM_LIVE_PROVIDER_TESTS=1` + `KIMI_API_KEY` | `npm test -w @arnilo/prism-provider-kimi` | Coding route; Moonshot entitlement is account-specific. |
| Z.AI | `PRISM_LIVE_PROVIDER_TESTS=1` + `ZAI_API_KEY` | `npm test -w @arnilo/prism-provider-zai` | GLM stream/tool/reasoning smoke. |
| OpenRouter | `PRISM_LIVE_PROVIDER_TESTS=1` + `OPENROUTER_API_KEY` | `npm test -w @arnilo/prism-provider-openrouter` | Routed stream/model metadata smoke; host chooses permitted route. |
| OpenCode Go | `PRISM_LIVE_PROVIDER_TESTS=1` + `OPENCODE_API_KEY` | `npm test -w @arnilo/prism-provider-opencode-go` | OpenAI/Anthropic route selection smoke. |
| Alibaba DashScope | Alibaba least-privilege API key | No generic fixture; host compatibility probe in protected release environment | Region/preset/catalog entitlement varies; offline serializer and catalog tests remain default gate. |
| Ollama Cloud/local | Cloud API key or host-local authenticated endpoint | No generic fixture; host compatibility probe in protected release environment | Cloud account and local daemon/model availability are host-owned; no daemon starts during Prism tests. |
| NeuralWatt | `PRISM_LIVE_PROVIDER_TESTS=1` + `NEURALWATT_API_KEY` | `npm test -w @arnilo/prism-provider-neuralwatt` | Stream/retry/quota telemetry smoke. |
| Anthropic | `PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY` | `npm test -w @arnilo/prism-provider-anthropic` | Restricted one-turn provider smoke. |
| Google | `PRISM_LIVE_PROVIDER_TESTS=1` + `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `npm test -w @arnilo/prism-provider-google` | Restricted one-turn provider smoke. |
| Memory PostgreSQL/pgvector | `PRISM_TEST_POSTGRES_URL` with `vector` extension | `npm run test:postgres -w @arnilo/prism-memory` | Shared memory conformance, export/rebuild pagination, and finite-vector boundary. |

The scheduled/manual `live-canaries` workflow uses protected environment `live-canaries`; release validation uses its protected release environment. Neither workflow receives a broad workspace key. A successful offline benchmark is never evidence that a live row ran; each protected invocation must record its enabled matrix rows and skipped/missing prerequisites.

### Historical release notes

Older 0.0.10–0.0.15 handoffs are summarized in [migration](migration.md); historical 43-package evidence remains there. The publishable package catalog includes `@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-ollama`, and `@arnilo/prism-session-store-codecs`; current publication uses the 47-manifest handoff above.

## Extension and configuration notes

- **Required `@arnilo/prism` peer.** Every first-party code package declares a non-optional `@arnilo/prism@0.0.26` peer (`peerDependenciesMeta` must not mark `@arnilo/prism` optional; other peers such as `playwright-core` may be optional). The range stays pinned to `0.0.26` for the current 0.x release and will widen to `^1.0.0` at the 1.x stable release. Inside the workspace each package also declares `"@arnilo/prism": "file:../.."` in `devDependencies` so `npm install` resolves the peer locally; that devDependency is stripped from consumer installs and is not a runtime dependency.
- **Public access.** All 48 manifests (42 code packages + 6 family/profile packages) declare `"publishConfig": { "access": "public" }`; the publisher also passes `--access public` explicitly because scoped packages otherwise default to restricted on first publish.
- **Map retention knob.** Source maps are emitted locally but stripped from tarballs by `!dist/**/*.map`. Removing that `files` negation ships maps in releases (larger tarballs, better consumer stack traces).
- **Release workflow.** `.github/workflows/release.yml` has six jobs. `verify` runs network-free SDK readiness on Node 24; `node20-compat` builds/imports every public root `exports` default target on Node 20 for declared `engines.node >=20` (docs examples need Node >=22.6 native TypeScript stripping); `postgres-integration` uses `pgvector/pgvector:pg16`; `supply-chain` runs high-severity audit, SPDX/license policy, and tracked-source secret scanning; and tag-only `codeql-release` runs SAST. Tag-only `publish` needs all five gates, preserves clean exact-tag/version/topological publication, and alone receives `NPM_TOKEN`, `id-token: write`, and `attestations: write`. Before npm publish it packs all current tarballs, generates checksums plus SPDX, scans unpacked public artifacts, creates GitHub attestations for tarballs and SBOM, then retains artifacts for 30 days. Registry state remains the resumable journal. Local `npm run release:dry-run` remains network-free SDK readiness; local PostgreSQL coverage is `PRISM_TEST_POSTGRES_URL=... npm run test:postgres`.
- **Adding a package.** New workspace packages are picked up automatically by `npm run build --workspaces`, `npm test --workspaces`, `npm run pack:dry-run`, the packaging guard (`src/__tests__/packaging.test.ts`), and the install-smoke test (`src/__tests__/install-smoke.test.ts`) via the workspace glob; add the package to both tests' config arrays for explicit per-package assertions.

## Security and performance notes

- **No secrets or fixtures in tarballs.** Tests, fixtures, `src/`, `plans/`, `.agents/`, `roadmap.md`, and `tsconfig` files are excluded. The `docs avoid real-looking secret examples` docs check and the packaging guard's deny list prevent secret-bearing fixtures from shipping.
- **Live tests stay opt-in.** The default `npm test` is network-free by construction and never sets these vars. Provider/compaction live gates stay credential-gated and are not set by default or during `sdk:ready`. The PostgreSQL adapter live matrix is the exception that runs in CI via the dedicated `postgres-integration` job (still skipped in the default suite).
  - `PRISM_LIVE_PROVIDER_TESTS=1` — gates the eight provider packages' `src/__tests__/live.test.ts` (`@arnilo/prism-provider-anthropic`, `provider-google`, `provider-openai`, `provider-opencode-go`, `provider-openrouter`, `provider-zai`, `provider-kimi`, `provider-neuralwatt`). Each provider live test also requires its own API key env var and skips safely when it is missing:
    - `OPENAI_API_KEY` for `@arnilo/prism-provider-openai`
    - `OPENROUTER_API_KEY` for `@arnilo/prism-provider-openrouter`
    - `KIMI_API_KEY` for `@arnilo/prism-provider-kimi`
    - `ZAI_API_KEY` for `@arnilo/prism-provider-zai`
    - `NEURALWATT_API_KEY` for `@arnilo/prism-provider-neuralwatt`
    - `OPENCODE_API_KEY` for `@arnilo/prism-provider-opencode-go`
  - `PRISM_LIVE_WEB=1` — gates `@arnilo/prism-web-tools` restricted live tests; provider calls additionally require `PRISM_BRAVE_SEARCH_TOKEN`, `PRISM_EXA_API_KEY`, or `PRISM_FIRECRAWL_API_KEY`. Run `npm run test:live -w @arnilo/prism-web-tools`; default tests use injected fake fetch only.
  - `PRISM_TEST_PLAYWRIGHT=1` or `PRISM_LIVE_PLAYWRIGHT=1` — gates `@arnilo/prism-browser` protected Playwright adversarial matrix (`npm run test:live -w @arnilo/prism-browser`). Host must supply a pinned Chromium binary via `playwright-core`. Default tests use fake Playwright APIs only; enabled but missing browser fails closed.
  - `PRISM_TEST_DOCKER_SANDBOX=1` — gates `@arnilo/prism-coding-security` protected Docker matrix. Requires host-preloaded digest-pinned `PRISM_TEST_DOCKER_IMAGE` and absolute `PRISM_TEST_DOCKER_BIN` (optional `PRISM_TEST_DOCKER_USER`). Prism never pulls/builds the image during default tests. Missing prerequisites fail closed when the gate is enabled; disabled gate skips safely.
  - `PRISM_LIVE_CANARIES=1` — gates `scripts/live-canary.mjs`, used only by scheduled/manual `.github/workflows/live-canaries.yml` in protected `live-canaries` environment. It requires provider endpoint/key/model, MCP endpoint/token, A2A endpoint/token, and Brave token environment entries; performs four probes plus at most one MCP session DELETE; caps provider output at one token, each response at 64 KiB, each request at 15 seconds (30 seconds hard), and emits only aggregate kind/status/code/duration. Disabled gate skips before network; enabled but incomplete configuration fails closed.
  - `PRISM_LIVE_COMPACTION_TESTS=1` — gates `@arnilo/prism-compaction-llm`'s live summary-provider smoke test (placeholder).
  - `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` — gates `@arnilo/prism-compaction-observational-memory`'s live observer/reflector worker canary. Requires `OPENAI_API_KEY`; gate enabled without key fails closed.
  - `PRISM_TEST_POSTGRES_URL` — gates `@arnilo/prism-session-store-postgres` and `@arnilo/prism-memory` integration tests against a real database (memory path requires pgvector). Local: `PRISM_TEST_POSTGRES_URL=... npm run test:postgres`. CI: `postgres-integration` job with `pgvector/pgvector:pg16`.
  - `PRISM_TEST_KEYCHAIN=1` — gates `@arnilo/prism-credentials-node` system-keychain round-trips (requires a working OS keychain backend; skipped by default).
  - Provider live tests read the API key from the env only when both gates are set; the key is used as a bearer token and never logged. `assertNoSecretLeak` verifies the key value does not appear in any streamed event. The compaction placeholders still carry no real credentials.
  - Enforced by `network-free-guard.test.ts` (default suite stays network-free) and by source-scanning meta-tests that assert each `live.test.ts` keeps its `skip:` guard.
- **Supply-chain workflows.** `.github/workflows/security.yml` runs CodeQL JavaScript/TypeScript SAST, PR-only dependency review, `npm audit`, SPDX 2.3 generation, exact license allow/deny policy, tracked-source plus unpacked-tarball credential-pattern scans, and seven-day SBOM retention. Dependabot opens bounded weekly npm and GitHub Actions updates. Every third-party action uses a full immutable revision; workflows never use `pull_request_target`. GitHub repository secret scanning/push protection and required-check branch rules remain repository settings because GitHub provides no equivalent checked-in workflow toggle; enable `security / codeql`, `security / supply-chain`, PR dependency review, and release checks on protected branches.
- **Sandbox/browser protected workflow.** `.github/workflows/sandbox-browser.yml` is scheduled/manual only in protected `sandbox-browser` environment. It runs network-free adversarial eval fixtures by default, optionally enables digest-pinned Docker and Playwright gates via repository variables (`PRISM_TEST_DOCKER_IMAGE`, `PRISM_ENABLE_PLAYWRIGHT_GATE`), receives no provider/npm/OIDC secrets, and uploads only a redacted aggregate status artifact (7-day retention).
- **Release attestations.** Tag publication uses GitHub OIDC with only `contents: read`, `id-token: write`, and `attestations: write` at the publish job. `actions/attest-build-provenance` attests every `.tgz` and `sbom.spdx.json` before npm publication; npm still receives `--provenance`. Verify downloaded attestations with GitHub CLI and npm signatures on the release host.
- **Install smoke is offline.** The install-smoke test packs core + every package into a temp dir and installs tarballs with `--offline --no-audit --no-fund` into a fresh project. External dependencies are satisfied from the lockfile-backed npm cache prepared by `npm ci`; any attempted uncached registry fetch fails the gate.
- **Offline test budget.** The default `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) is pinned at **< 60s on Node 20** with a measured local baseline of ~45s (build ~18s + network-free tests/workspace tests/packaging smoke ~27s). The full CI `sdk:ready` gate runs on Node 24 because docs tests execute `examples/*.ts` via native TypeScript stripping. `npm run sdk:ready` also runs typecheck and pack dry-run, so it is allowed to exceed the `npm test` budget while remaining network-free. The CI `sdk:ready` step has `timeout-minutes: 5` as a hang backstop; the separate Node 20 compatibility step has `timeout-minutes: 3`. The budget was raised from 30s after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests; optimize before raising it again.

### 0.0.12 release-candidate verification — 2026-07-22

| Gate | Result |
| --- | --- |
| Package graph | Root + 34 workspaces = 35 publishable manifests at exact `0.0.12`; `@arnilo/prism-ag-ui` is public and reached only through `@arnilo/prism-all`. |
| Protocol and compaction | AG-UI root/`./acp`, core streamed durable resume, and coding compaction import from packed offline consumer; `benchmark-0.0.12` schema passed. |
| SDK readiness | `npm run sdk:ready` passed: typecheck, network-free tests, offline install/export checks, and 35 package dry-run packs. |
| Compatibility and supply chain | Node 20.20.2 imported every core export; audit found 0 high findings (2 moderate MCP-transitive advisories); SPDX/license check covered 192 packages/8 effective licenses. `@ag-ui/core@0.0.57` is an exact MIT override because its published metadata omits `license` while its shipped LICENSE is MIT; other `NOASSERTION` entries still fail. 963 present tracked files had 0 secret findings. |
| Registry/order | Public `release:check` found all 35 `@arnilo/*@0.0.12` versions available. Dependency-ordered `release:publish --dry-run --allow-dirty --allow-untagged` completed 35/35 with explicit public/latest/provenance; no commit, tag, or publication was created. |

A deleted tracked feature-request markdown was intentionally not restored by release work; resolve it before a clean checkout runs the workflow's literal `git ls-files` secret-scan command. Protected live gates, signed tag, OIDC, and actual publication remain operator prerequisites.

### 0.0.11 dependency audit decision (2026-07-22)

`npm audit --audit-level=high` reports 0 vulnerabilities and `npm ls --all --depth=0` resolves the exact 34-package `0.0.11` graph (including `@arnilo/prism-provider-anthropic`, `@arnilo/prism-provider-google`, and `@arnilo/prism-browser`). Locked-install SPDX and `scripts/verify-sbom.mjs` pass. Browser keeps `playwright-core@1.61.0` as an optional peer and ships no browser binary/image; no Office package/binary enters the graph. Host mode never claims disposable containment.


### 0.0.11 release-candidate verification — 2026-07-22

| Gate | Result |
| --- | --- |
| Package graph | Root + 33 workspaces = 34 publishable manifests at exact `0.0.11` with exact internal peer/dependency ranges; Anthropic/Google in `@arnilo/prism-providers` and transitively `@arnilo/prism-all`. |
| Coding harness P1 | SessionIndex/search, contextBudget, steer, ask_user_decision, runCodingGoalVerify; schema v4 FTS migration; `benchmark-0.0.11` search/budget schema green. |
| Providers | Native Anthropic + Google packages offline-conformant; live gates remain `PRISM_LIVE_PROVIDER_TESTS=1` + host keys. |
| SDK readiness | `npm run sdk:ready`: 2,047 tests (2,014 pass / 33 skip / 0 fail); pack 1,041,760 / 4,041,551 / 889 files; core 549,565 / 1,938,287 / 253. |
| Registry/order | Public `release:check` found all 34 `@arnilo/*@0.0.11` versions available. Dependency-ordered `release:publish --dry-run --allow-dirty --allow-untagged` completed 34/34 dry-run with explicit public/latest/provenance; no commit, tag, or publication created. |


## Formatting, linting, and coverage

Prism uses one tool for formatting and linting — [Biome](https://biomejs.dev) — configured once at the repo root (`biome.json`) and inherited by every workspace. Coverage uses Node's built-in test coverage; there is no third-party coverage service.

| Command | What it does |
| --- | --- |
| `npm run lint` | `biome lint .` — fails on any lint error (warnings are non-fatal). |
| `npm run format:check` | `biome format .` — fails if any file is unformatted. |
| `npm run format` | `biome format --write .` — normalizes formatting in place. |
| `npm run test:coverage` | `node --test --experimental-test-coverage` over the core suite with enforced minimums: **lines 60%**, **functions 70%**, **branches 75%** (current baseline ≈ 64 / 72 / 79). Excludes `__tests__/`, `node_modules/`, and `scripts/` from the report. |

All four gates run inside `npm run sdk:ready` (after `typecheck`, before `pack:dry-run`). A few rules are disabled in `biome.json` because they are false positives for this codebase: `noControlCharactersInRegex` and `noAssignInExpressions` (security/redaction code intentionally matches control characters and uses `while ((m = re.exec(…)))` loops), `noShadowRestrictedNames`, `noThenProperty` (the workflow DSL has a legitimate `then` branch field), `noExplicitAny`, `noVoidTypeReturn`, and `useYield`. Raise the coverage thresholds in `package.json` `test:coverage` as the baseline climbs.

## Dependency major-upgrade isolation

Major dependency upgrades are **isolated, compatibility-tested changes — never bundled into a feature release.** A major bump (TypeScript, `@types/node`, `diff`, or any third-party runtime dependency and its successors) ships as its own commit/PR that runs `npm run sdk:ready` plus packed-install evidence, and is reviewed separately from feature work. Release commits contain no unreviewed major bumps.

**Current third-party upgrade surface** (internal `@arnilo/prism-*` ranges are version-managed by the release tooling, not dependency upgrades; the core `@arnilo/prism` package has **zero** runtime dependencies, asserted by `core-boundaries.test.ts`):

| Dependency | Range | Resolved (lockfile) | Used by |
| --- | --- | --- | --- |
| `typescript` (dev) | `^7.0.2` | 7.0.2 | root build |
| `@types/node` (dev) | `^26.1.1` | 26.1.1 | root build |
| `@biomejs/biome` (dev) | `^2.5.5` | 2.5.5 | lint/format (Task 6) |
| `diff` | `^9.0.0` | 9.0.0 | `@arnilo/prism-coding-agent` |
| `pg` | `^8.22.0` | 8.22.0 | `@arnilo/prism-memory`, `@arnilo/prism-session-store-postgres` |
| `better-sqlite3` | `^12.11.1` | 12.11.1 | `@arnilo/prism-session-store-sqlite` |
| `ajv` | `^8.17.1` | 8.20.0 | `@arnilo/prism-tool-validator-json-schema` |
| `zod` | `^4.4.3` | 4.4.3 | `@arnilo/prism-mcp` |
| `@napi-rs/keyring` | `^1.3.0` | 1.3.0 | `@arnilo/prism-credentials-node` |
| `@modelcontextprotocol/sdk` | `1.29.0` | 1.29.0 | `@arnilo/prism-mcp` |
| `@ag-ui/core` | `0.0.57` | 0.0.57 | `@arnilo/prism-ag-ui` |
| `@agentclientprotocol/sdk` | `1.3.0` | 1.3.0 | `@arnilo/prism-ag-ui` |

**Recorded compatibility matrix (2026-07-26, release 0.0.16):**

| Leg | Node | Result |
| --- | --- | --- |
| Full SDK readiness (`npm run sdk:ready`: typecheck, lint, format, test, coverage, pack, release:gate) | 24.18.0 (current) | ✅ green — 1312/1312 tests, lint 0 errors, format clean, coverage 64/72/79 vs 60/70/75 thresholds. |
| Build toolchain (`tsc` 7.0.2, `biome` 2.5.5) | 20.20.2 (LTS iron) | ✅ both run under Node 20. |
| Public surface import smoke (all 21 root `exports` default targets) | 20.20.2 | ✅ all import cleanly. |
| Full core test suite | 20.20.2 | 1311/1312 — the single failure is `examples_demos_run_to_completion_and_emit_no_secret`, which executes `examples/*.ts` via Node's native TypeScript stripping (Node 22.6+). This is a test-harness capability, not an SDK runtime incompatibility, and is exactly why CI scopes Node 20 to build + import smoke. |

**CI enforcement** (`.github/workflows/release.yml`): the `verify` job runs `npm run sdk:ready` on Node 24; `node20-compat` runs `npm ci`, `npm run build`, and the public-import smoke on Node 20; `supply-chain` runs audit, SPDX/license checks, SBOM, and source-secret scans; `publish` `needs:` all of `verify`, `node20-compat`, `postgres-integration`, `codeql-release`, and `supply-chain`, so nothing publishes unless every leg — including the audit/SBOM gates — passes.

**Process for a major-upgrade PR:** (1) bump exactly one dependency major in its own branch; (2) `npm run sdk:ready` green; (3) packed-install evidence (`npm run pack:dry-run`, or a scratch `npm install <tarball>` import smoke for native deps like `better-sqlite3`); (4) review lockfile churn line-by-line; (5) the `supply-chain` job supplies audit/SBOM; (6) confirm no build-time regression beyond measured noise on the matrix above; (7) merge separately from any feature work.

## Release checklist

Every release gate maps to an exact enforcement test or command, so the checklist is executable rather than manual. Run `npm run sdk:ready` for the full local SDK readiness gate: `npm run typecheck`, `npm run lint`, `npm run format:check`, network-free `npm test`, `npm run test:coverage`, `npm run pack:dry-run`, and `npm run release:gate`. `npm run release:dry-run` is an alias for the same gate. The GitHub Actions `verify` job runs `npm ci` and `npm run sdk:ready` on Node 24; `node20-compat` runs `npm ci`, `npm run build`, and public export imports on Node 20; `postgres-integration` runs the opt-in PostgreSQL adapter suite against a CI Postgres service.

| Gate | Enforcement |
| --- | --- |
| Docs coverage for persistence/runtime/migration surfaces | `docs.test.ts` enrolls every API page in `apiPages` (heading + index-link + bare-specifier + secret-scan checks); dedicated section assertions pin `database-persistence.md`, `runs-and-usage.md`, `session-stores-and-branching.md`, `migration.md`, `agent-definitions.md`, `performance.md`, and the Phase 41 `external_app_example_*` / `phase41_external_app_surfaces_*` gates. |
| Package exports/subpaths resolve to built output | `public-export-contract.test.ts` asserts every `exports`/`main`/`types`/`bin` target resolves to a built file under `dist/` with a sibling `.d.ts` (`dist/index.js` + `dist/index.d.ts` for a root package), and no target escapes `dist/` (no `src/` or `examples/` leak). CI `node20-compat` also imports every public root `exports` default target on Node 20. |
| Public-API drift | `public-export-contract.test.ts` `phase39_public_protocol_exports_and_types_do_not_drift` pins the runtime protocol (`providerToolCallDelta`, `ToolCallDeltaContent`), the `/testing/provider-conformance` subpath shape, and the observational-memory runtime `.d.ts` surface. |
| Root SDK export surface freeze | `public-export-contract.test.ts` `root export surface is frozen` snapshots every value and type export of `src/index.ts` (107 value + 69 type) so any add/remove is a deliberate test update; `every frozen value export resolves at runtime` rebuilds `dist/index.js` and asserts each value export is present (catches build drift), and `every frozen type export appears in the built type declarations` asserts each type export is in `dist/index.d.ts`. |
| Examples compile and are listed; runnable demos execute | `npm run typecheck` runs `tsc -p examples --noEmit`; `docs.test.ts` checks every `examples/*.ts` file is listed in `examples/README.md`, then runs demos offline and scans output for secrets. |
| Examples run to completion with no secret leakage | `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` runs each demo (Node strips TypeScript types natively) with exit-0 and real-secret scans; `external_app_example_*` pins the DB-backed adapter reference exercising the `RunLedger`, branch-handle checkout, fork, and prior-run resume. |
| Tarball excludes built tests, source maps, and source | `packaging.test.ts` rejects `dist/__tests__/`, `*.map`, `src/`, `plans/`, and internal files; confirms every package ships README/changelog (and code packages ship LICENSE), core ships docs + CLI, and every export target exists. `prism-all` reaches every current publishable package except the deliberate Caveman/Ponytail opt-outs. |
| NeuralWatt package/docs/examples release gate | `packaging.test.ts` pins `@arnilo/prism-provider-neuralwatt` package exports/type declarations and `@arnilo/prism-providers`/`@arnilo/prism-all` membership; `docs.test.ts` asserts `docs/index.md` links `providers/neuralwatt.md` and `provider-caching.md`, and that `examples/cache-aware-prompt-assembly.ts` plus `examples/neuralwatt-agent-run.ts` exist and are listed. |
| Enterprise PostgreSQL package/docs/example gate | Packaging/install/public-contract tests include `@arnilo/prism-enterprise-postgres`; `docs.test.ts` pins its API page, four-store migration/ownership/unknown-outcome/async-router guidance, and `examples/enterprise-postgres-state.ts`; `npm run test:postgres` exercises migration, restart, contention, and cleanup with an explicit database URL. |
| Version graph and resumable publication | `release.test.ts` covers exact package/lock/range validation, topological order, registry collisions, dry-run, interrupted reports/resume, clean tagged git state, provenance/public/tag arguments, and token-safe errors. `release:check` and `release:publish` derive the workspace graph without a manual package list. |
| Pre-publish compatibility gates | `release:gate` (in `sdk:ready`) fails on removed/changed `.d.ts` exports vs `scripts/compat-baseline/` (unless `--allow-break` + migration note), version-range/lockfile drift, and tarball deny-list violations (`plans/`, `code-reviews/`, `docs/review-coverage-*`, `*.map`, `__tests__/`); unit-tested in `scripts/release-gate.test.mjs`. |
| Formatting, linting, and coverage thresholds | `npm run lint` and `npm run format:check` run Biome (single root `biome.json`, workspaces inherit) and fail on any lint error or unformatted file; `npm run test:coverage` uses Node's built-in `--experimental-test-coverage` with enforced minimums (lines 60 / functions 70 / branches 75) and no third-party service. All three run inside `sdk:ready`. |
| Supply-chain and live-canary policy | `supply-chain-security.test.ts` verifies SPDX allow/deny behavior, bounded source/artifact secret detection, credential-free canary reports, timeout/redacted failures, immutable action revisions, no `pull_request_target`, protected live environment, attestation paths, and publish dependency on `supply-chain`; CI adds CodeQL and PR dependency review. |
| Network-free + offline test budget | `network-free-guard.test.ts` keeps the default suite network-free; budget pinned `< 60s` (measured baseline above). Install-smoke is offline (`--offline --no-audit --no-fund`, zero registry fetches). |
| Core security invariants reaffirmed | Runtime/docs tests hold the trust boundary: **no built-in app tools** (hosts register tools; the core ships only the mock provider and contract helpers), **no hidden provider/credential globals** (providers/credentials are host-owned `AgentConfig` fields, resolved via explicit `providerSource`/`CredentialResolver`), **no auto package discovery** (provider/tool/skill packages are opt-in and individually installed; contribution discovery is realpath-contained and emits inert envelopes the host registers), and **no secret persistence in core** (redaction applies before any `RunLedger`/`SessionStore` append; the ledger gate asserts each message event is written exactly once and redacted). |

A change that adds a public persistence/runtime surface, a new package, or a new example must extend the matching row's enforcement (add the page to `apiPages`, the package to the `packages` array, or the example to the demos list) so the checklist stays self-maintaining.

## Pre-publish compatibility gates (`release:gate`)

`npm run release:gate` (also run inside `npm run sdk:ready`) is the offline gate that must pass before `release:check`/`release:publish`. It runs three stages over the exact version graph (version defaults to the root manifest; no git or registry access):

- **ranges**: reuses `validateRelease` — exact internal version ranges and lockfile entries.
- **compat**: diffs every package's packed `.d.ts` surface (exported names + normalized declaration signatures, `export *` resolved within the package) against `scripts/compat-baseline/<pkg>.txt`. Removed or changed exports fail unless `--allow-break` is passed **and** `docs/migration.md` mentions the target version. Manifest-only profiles (no `main`/`types`/`exports`) are skipped. Regenerate baselines after a deliberate reviewed change with `node scripts/release.mjs gate --update-baseline`.
- **tarball**: `npm pack --dry-run --json` file lists must not match the deny list (`code-reviews/`, `bug-reports/`, `plans/`, `scripts/benchmark-*`, `docs/review-coverage-*`, `__tests__/`, `*.map`). Root `files` excludes `docs/review-coverage-*` historical reviews.

Gate behavior is unit-tested in `scripts/release-gate.test.mjs`. Signature diff is name + normalized first-declaration-line level; full structural `.d.ts` diffing (api-extractor or equivalent) is the recorded upgrade path if line-level proves insufficient.

## Related APIs

- [`docs/provider-packages.md`](provider-packages.md): first-party provider package layout and setup.
- [`docs/cli-rpc.md`](cli-rpc.md): the `prism` CLI bin and RPC protocol shipped as `dist/cli.js`.
- [`docs/configuration-and-manifests.md`](configuration-and-manifests.md): package manifest merging and validation.
