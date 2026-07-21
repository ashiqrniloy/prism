# Release and install

## What it does

Prism is published as one core package, twenty-five first-party capability packages, and six pure-manifest family/profile packages. This page describes how they are packed, what each tarball contains, how to install them, the required `@arnilo/prism` peer dependency, the release workflow, and the offline test budget.

Core package:

- `@arnilo/prism` — the runtime, contracts, registries, streaming events, CLI (including `prism init`), and the `/docs` hub. `files`: `dist` (with `!dist/__tests__` and `!dist/**/*.map` negations), `docs`, `templates`, `CHANGELOG.md`. `bin`: `prism` -> `dist/cli.js`. `sideEffects`: `["dist/cli.js"]`.

First-party workspace packages (each has non-optional `@arnilo/prism@0.0.96` peer and `sideEffects: false`; RAG also peers on memory, and server also peers on workflows):

- `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-openrouter`, `@arnilo/prism-provider-kimi`, `@arnilo/prism-provider-zai`, `@arnilo/prism-provider-opencode-go`, `@arnilo/prism-provider-neuralwatt` — provider adapters.
- `@arnilo/prism-provider-ai-sdk` — optional AI SDK `LanguageModelV4` adapter; included by the provider and all umbrellas.
- `@arnilo/prism-compaction-llm` — optional LLM-backed compaction strategy.
- `@arnilo/prism-compaction-observational-memory` — optional source-backed observational memory.
- `@arnilo/prism-observability-opentelemetry` — optional OpenTelemetry adapter for `AgentEvent` streams.
- `@arnilo/prism-tool-validator-json-schema` — bounded JSON Schema tool argument validation.
- `@arnilo/prism-mcp` — MCP transport/client bridge plus explicit authorized Prism tool/command server exposure.
- `@arnilo/prism-coding-agent` / `@arnilo/prism-coding-security` — optional host shell/filesystem tools plus approval, containment, and sandbox policy.
- `@arnilo/prism-session-store-sqlite` / `@arnilo/prism-session-store-postgres` — production persistence, checkpoints, and leases.
- `@arnilo/prism-credentials-node` — encrypted-file and keychain credential storage.
- `@arnilo/prism-workflows` — typed bounded DAG orchestration with durable approval, schedules/background runs, composition/state/replay, and multi-process coordination.
- `@arnilo/prism-evals` — optional deterministic scorers, immutable datasets, and bounded batch experiments over `AgentRunResult`.
- `@arnilo/prism-memory` — optional working memory, semantic recall, Embedder/VectorStore contracts, and PostgreSQL/pgvector adapter.
- `@arnilo/prism-rag` — optional bounded text/Markdown chunking, vector indexing/retrieval, stable citations, and ContextProvider integration (peers on memory).
- `@arnilo/prism-server` — optional framework-free authorized Web agent/workflow routes (peers on workflows).
- `@arnilo/prism-supervisor` — optional bounded child delegation and A2A 1.0 card/server/client interoperability.
- `@arnilo/prism-web-tools` — optional bounded host-selected Brave/Exa search and Firecrawl Markdown/schema extraction; native fetch, no vendor SDK/browser.
- `@arnilo/prism-browser` — optional host-supplied Playwright browser tools (`browser_open`/`browser_snapshot`/`browser_act`/`browser_close`); import launches nothing; `playwright-core@1.61.0` optional peer.

Family/profile packages (pure manifests, no code or `dist`; ship `README.md` and `CHANGELOG.md`; use exact hard `dependencies`):

- `@arnilo/prism-providers` — all seven `@arnilo/prism-provider-*` packages: six HTTP adapters plus AI SDK interoperability.
- `@arnilo/prism-compaction` — both `@arnilo/prism-compaction-*` packages.
- `@arnilo/prism-base` — core + compaction family + JSON Schema validator; excludes providers, MCP, native credentials/storage, and coding tools.
- `@arnilo/prism-code` — base + coding-agent + coding-security + MCP; providers and persistence remain explicit choices.
- `@arnilo/prism-sdk` — base + workflows + MCP + Node credentials + OpenTelemetry; providers and persistence remain explicit choices.
- `@arnilo/prism-evals` remains optional and network-free by default; model judges are host callbacks and live credentialed gates run separately. `examples/evaluation-gate.ts` demonstrates non-zero threshold gating.
- `@arnilo/prism-all` — every first-party package: code + SDK + providers + persistence + evals + memory/RAG + server + supervisor + web tools + browser. Installation alone activates no network/listener, telemetry, database, memory, evaluation, delegation, MCP, shell, filesystem, or browser capability.

Profile footprint snapshot (Node 24/npm 11, lockfile graph, 2026-07-19): `base` reaches 6 first-party packages and one external dependency root (Ajv); `code` reaches 10 and three (Ajv, MCP SDK, diff); `sdk` reaches 11 and three (Ajv, MCP SDK, keyring); `all` reaches all 32 first-party manifests and seven external roots (those plus better-sqlite3, pg, and AI SDK provider types). Native database drivers stay out of base/code/sdk; both appear only in all.

Each code package's `files` array is `["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]`; `README.md`, `LICENSE`, and `CHANGELOG.md` ship in every code-package tarball, the core tarball also ships the `docs/` directory, and family/profile tarballs ship `README.md` + `CHANGELOG.md` + `package.json`.

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
| Install coding-agent profile | `npm install @arnilo/prism-code @arnilo/prism-provider-openai` |
| Install application SDK profile | `npm install @arnilo/prism-sdk @arnilo/prism-provider-openai @arnilo/prism-session-store-sqlite` |
| Install everything | `npm install @arnilo/prism-all` |
| Install core + a single provider | `npm install @arnilo/prism @arnilo/prism-provider-openai` |
| Install bounded web research tools | `npm install @arnilo/prism @arnilo/prism-web-tools @arnilo/prism-tool-validator-json-schema` |
| Install browser automation tools | `npm install @arnilo/prism @arnilo/prism-browser playwright-core@1.61.0` |
| Build everything (core + workspaces) | `npm run build` |
| Run the default (network-free) test suite | `npm test` |
| Dry-run pack core + every package | `npm run pack:dry-run` |
| Local mirror of the release verify gate | `npm run release:dry-run` |
| Validate clean tag/version/ranges and reject registry collisions | `npm run release:check -- --version 0.0.96` |
| Preview deterministic publish order | `npm run release:publish -- --version 0.0.96 --dry-run --allow-dirty --allow-untagged` |
| Resume interrupted tagged publication | `npm run release:publish -- --version 0.0.96 --resume --report release-artifacts/publish-report.json` |
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
- **Tarball filenames.** npm strips the `@scope/` prefix, so the core package `@arnilo/prism` produces a tarball named `arnilo-prism-0.0.96.tgz`; first-party packages produce `arnilo-prism-provider-<name>-0.0.96.tgz` / `arnilo-prism-compaction-<name>-0.0.96.tgz` / `arnilo-prism-coding-agent-0.0.96.tgz`; family/profile packages produce `arnilo-prism-{providers,compaction,base,code,sdk,all}-0.0.96.tgz`. The CLI bin name `prism` is unaffected by the package name (`npx prism` still works; npm allows the bin field to differ from the package name).

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
    "@arnilo/prism": "0.0.96",
    "@arnilo/prism-provider-openai": "0.0.96",
    "@arnilo/prism-compaction-observational-memory": "0.0.96"
  }
}
```

Installing the provider/compaction packages without `@arnilo/prism` present produces an unmet-peer error (the `@arnilo/prism` peer is required, not optional):

```text
npm error code ERESOLVE
npm error Could not resolve dependency:
npm error peer @arnilo/prism@"0.0.96" from @arnilo/prism-provider-openai@0.0.96
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

Release publication derives all 32 packages from the workspace once, validates exact `0.0.96` manifest/lockfile/internal ranges, then uses deterministic dependency order. `release:check` requires a clean commit tagged `v0.0.96` and rejects any existing registry version. `release:publish --resume` skips only registry versions whose internal dependency fingerprint matches the local manifest; conflicting versions fail closed. Each attempted package is written immediately to the JSON report, so a failed job can rerun safely. `--dry-run` still performs registry availability checks and invokes `npm publish --dry-run` with explicit public access, provenance, and `latest` tag.

```bash
npm run release:check -- --version 0.0.96
npm run release:publish -- --version 0.0.96 --dry-run --allow-dirty --allow-untagged
```

`--allow-dirty` and `--allow-untagged` exist only for local preview; real publication and CI never pass them. npm registry calls occur only in these release preflight/publication commands, never build/test/package discovery.

Optional live smoke tests stay separate from SDK readiness because they require credentials and network access:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present
```

### 0.0.96 publish handoff

**Decision: GO after operator prerequisites below.** Code, tests, package graph, protected PostgreSQL CI, registry availability, packed artifacts, security gates, coding/browser adversarial fixtures, Synapta Defects 1a/1b/2 (tool-call stream recovery / typed incomplete deltas / empty-candidate rejection), and dependency-ordered publication dry-run passed from the Phase 4 release-candidate tree. Clean protected-branch CI, signed commit/tag, npm authentication, OIDC attestation, protected Docker/Playwright live gates (when host-provisioned), and actual publication remain operator/workflow prerequisites. No package was published during readiness work. Scope includes coding and browser execution only; **no Office** package, binary, SDK, wrapper, docs page, test, or release gate exists.

#### npm authentication prerequisite

The existing GitHub Actions secret `NPM_TOKEN` is used only by the publish step as `NODE_AUTH_TOKEN`, matching previous Prism releases. Confirm that token remains valid and can publish existing and new public packages under `@arnilo`; no additional secret or manual npm publish is required. The workflow also requests OIDC and always passes `--provenance`.

#### Release commit and tag

Merge through the protected release branch, then run these commands from a clean checkout of the protected merge commit. `git push origin v0.0.96` is the workflow dispatch; there is no manual publish command.

```bash
# Prepare and push the release commit.
git diff --check
npm ci
npm run sdk:ready
git add -A
git diff --cached --check
git commit -S -m "Release 0.0.96"
git push origin HEAD

# Merge/confirm protected branch CI, then check out that exact clean merge commit.
test -z "$(git status --porcelain)"
npm ci
npm run release:check -- --version 0.0.96 --allow-untagged --report /tmp/prism-0.0.96-preflight.json

git tag -s v0.0.96 -m "Prism 0.0.96"
git verify-tag v0.0.96
test "$(git rev-parse HEAD)" = "$(git rev-list -n 1 v0.0.96)"
npm run release:check -- --version 0.0.96 --report /tmp/prism-0.0.96-tagged-preflight.json
git push origin v0.0.96
```

The tag workflow's only publication command is `npm run release:publish -- --version "${GITHUB_REF_NAME#v}" --resume --report release-artifacts/publish-report.json`. Latest registry preflight returned `available` for all 32 `0.0.96` versions at handoff (including first publication of `@arnilo/prism-browser`). Publisher order is stable and dependency-safe:

```text
 1 @arnilo/prism
 2 @arnilo/prism-coding-agent
 3 @arnilo/prism-compaction-llm
 4 @arnilo/prism-compaction-observational-memory
 5 @arnilo/prism-credentials-node
 6 @arnilo/prism-evals
 7 @arnilo/prism-mcp
 8 @arnilo/prism-memory
 9 @arnilo/prism-observability-opentelemetry
10 @arnilo/prism-provider-ai-sdk
11 @arnilo/prism-provider-kimi
12 @arnilo/prism-provider-neuralwatt
13 @arnilo/prism-provider-openai
14 @arnilo/prism-provider-opencode-go
15 @arnilo/prism-provider-openrouter
16 @arnilo/prism-provider-zai
17 @arnilo/prism-session-store-postgres
18 @arnilo/prism-session-store-sqlite
19 @arnilo/prism-supervisor
20 @arnilo/prism-tool-validator-json-schema
21 @arnilo/prism-web-tools
22 @arnilo/prism-browser
23 @arnilo/prism-workflows
24 @arnilo/prism-coding-security
25 @arnilo/prism-compaction
26 @arnilo/prism-providers
27 @arnilo/prism-rag
28 @arnilo/prism-server
29 @arnilo/prism-base
30 @arnilo/prism-code
31 @arnilo/prism-sdk
32 @arnilo/prism-all
```

#### Interruption and resume

Do not create another tag or rerun packages manually. Re-run failed jobs for the same tag in GitHub Actions. The workflow invokes `release:publish --resume`: registry versions with matching names, versions, and internal dependency fingerprints are skipped; any mismatch stops the job. Retain `release-artifacts-v0.0.96` and `publish-report-v0.0.96` for audit.

#### Bounded post-publish smoke

Download the workflow artifact and run `sha256sum -c SHA256SUMS`. Then verify all registry versions/tags/integrity and install the complete profile in a fresh directory:

```bash
while read -r package; do
  test "$(npm view "$package@0.0.96" version)" = "0.0.96"
  test "$(npm view "$package" dist-tags.latest)" = "0.0.96"
  npm view "$package@0.0.96" dist.integrity >/dev/null
done <<'PACKAGES'
@arnilo/prism
@arnilo/prism-coding-agent
@arnilo/prism-compaction-llm
@arnilo/prism-compaction-observational-memory
@arnilo/prism-credentials-node
@arnilo/prism-evals
@arnilo/prism-mcp
@arnilo/prism-memory
@arnilo/prism-rag
@arnilo/prism-server
@arnilo/prism-supervisor
@arnilo/prism-observability-opentelemetry
@arnilo/prism-provider-ai-sdk
@arnilo/prism-provider-kimi
@arnilo/prism-provider-neuralwatt
@arnilo/prism-provider-openai
@arnilo/prism-provider-opencode-go
@arnilo/prism-provider-openrouter
@arnilo/prism-provider-zai
@arnilo/prism-session-store-postgres
@arnilo/prism-session-store-sqlite
@arnilo/prism-tool-validator-json-schema
@arnilo/prism-web-tools
@arnilo/prism-browser
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
npm install --no-audit --no-fund @arnilo/prism-all@0.0.96
node --input-type=module <<'NODE'
for (const name of [
  "@arnilo/prism", "@arnilo/prism-coding-agent", "@arnilo/prism-coding-security",
  "@arnilo/prism-compaction-llm", "@arnilo/prism-compaction-observational-memory",
  "@arnilo/prism-credentials-node", "@arnilo/prism-mcp", "@arnilo/prism-observability-opentelemetry",
  "@arnilo/prism-provider-kimi", "@arnilo/prism-provider-neuralwatt", "@arnilo/prism-provider-openai",
  "@arnilo/prism-provider-opencode-go", "@arnilo/prism-provider-openrouter", "@arnilo/prism-provider-zai",
  "@arnilo/prism-session-store-postgres", "@arnilo/prism-session-store-sqlite",
  "@arnilo/prism-tool-validator-json-schema", "@arnilo/prism-workflows", "@arnilo/prism-evals",
  "@arnilo/prism-provider-ai-sdk", "@arnilo/prism-memory", "@arnilo/prism-rag",
  "@arnilo/prism-server", "@arnilo/prism-supervisor", "@arnilo/prism-web-tools",
  "@arnilo/prism-browser",
]) await import(name);
NODE
./node_modules/.bin/prism --help >/dev/null
npm audit signatures --json --include-attestations > npm-signatures.json
```

This smoke is bounded to registry metadata, imports, CLI startup, checksums, signatures, and provenance; do not rerun the full release suite after immutable publication.

#### Rollback limitations

npm publication is not transactional and published versions are immutable. Partial publication is a resume case, not rollback. For a confirmed systemic defect after completion, deprecate every affected `@0.0.96`; restore `latest` to the previous good release only where that tag already existed. Exact `0.0.96` installs remain possible, so publish a fixed version promptly. Do not unpublish except for a security/legal emergency under npm policy.

## Extension and configuration notes

- **Required `@arnilo/prism` peer.** Every first-party package declares a non-optional `@arnilo/prism@0.0.96` peer (`peerDependenciesMeta` must not mark `@arnilo/prism` optional; other peers such as `playwright-core` may be optional). The range stays pinned to `0.0.96` for the 0.x series and will widen to `^1.0.0` at the 1.x stable release. Inside the workspace each package also declares `"@arnilo/prism": "file:../.."` in `devDependencies` so `npm install` resolves the peer locally; that devDependency is stripped from consumer installs and is not a runtime dependency.
- **Public access.** All 32 manifests (26 code packages + 6 family/profile packages) declare `"publishConfig": { "access": "public" }`; the publisher also passes `--access public` explicitly because scoped packages otherwise default to restricted on first publish.
- **Map retention knob.** Source maps are emitted locally but stripped from tarballs by `!dist/**/*.map`. Removing that `files` negation ships maps in releases (larger tarballs, better consumer stack traces).
- **Release workflow.** `.github/workflows/release.yml` has six jobs. `verify` runs network-free SDK readiness on Node 24; `node20-compat` builds/imports every public root `exports` default target on Node 20 for declared `engines.node >=20` (docs examples need Node >=22.6 native TypeScript stripping); `postgres-integration` uses `pgvector/pgvector:pg16`; `supply-chain` runs high-severity audit, SPDX/license policy, and tracked-source secret scanning; and tag-only `codeql-release` runs SAST. Tag-only `publish` needs all five gates, preserves clean exact-tag/version/topological publication, and alone receives `NPM_TOKEN`, `id-token: write`, and `attestations: write`. Before npm publish it packs all current tarballs, generates checksums plus SPDX, scans unpacked public artifacts, creates GitHub attestations for tarballs and SBOM, then retains artifacts for 30 days. Registry state remains the resumable journal. Local `npm run release:dry-run` remains network-free SDK readiness; local PostgreSQL coverage is `PRISM_TEST_POSTGRES_URL=... npm run test:postgres`.
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
  - `PRISM_LIVE_WEB=1` — gates `@arnilo/prism-web-tools` restricted live tests; provider calls additionally require `PRISM_BRAVE_SEARCH_TOKEN`, `PRISM_EXA_API_KEY`, or `PRISM_FIRECRAWL_API_KEY`. Run `npm run test:live -w @arnilo/prism-web-tools`; default tests use injected fake fetch only.
  - `PRISM_TEST_PLAYWRIGHT=1` or `PRISM_LIVE_PLAYWRIGHT=1` — gates `@arnilo/prism-browser` protected Playwright adversarial matrix (`npm run test:live -w @arnilo/prism-browser`). Host must supply a pinned Chromium binary via `playwright-core`. Default tests use fake Playwright APIs only; enabled but missing browser fails closed.
  - `PRISM_TEST_DOCKER_SANDBOX=1` — gates `@arnilo/prism-coding-security` protected Docker matrix. Requires host-preloaded digest-pinned `PRISM_TEST_DOCKER_IMAGE` and absolute `PRISM_TEST_DOCKER_BIN` (optional `PRISM_TEST_DOCKER_USER`). Prism never pulls/builds the image during default tests. Missing prerequisites fail closed when the gate is enabled; disabled gate skips safely.
  - `PRISM_LIVE_CANARIES=1` — gates `scripts/live-canary.mjs`, used only by scheduled/manual `.github/workflows/live-canaries.yml` in protected `live-canaries` environment. It requires provider endpoint/key/model, MCP endpoint/token, A2A endpoint/token, and Brave token environment entries; performs four probes plus at most one MCP session DELETE; caps provider output at one token, each response at 64 KiB, each request at 15 seconds (30 seconds hard), and emits only aggregate kind/status/code/duration. Disabled gate skips before network; enabled but incomplete configuration fails closed.
  - `PRISM_LIVE_COMPACTION_TESTS=1` — gates `@arnilo/prism-compaction-llm`'s live summary-provider smoke test (placeholder).
  - `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` — gates `@arnilo/prism-compaction-observational-memory`'s live worker/provider checks (placeholder).
  - `PRISM_TEST_POSTGRES_URL` — gates `@arnilo/prism-session-store-postgres` and `@arnilo/prism-memory` integration tests against a real database (memory path requires pgvector). Local: `PRISM_TEST_POSTGRES_URL=... npm run test:postgres`. CI: `postgres-integration` job with `pgvector/pgvector:pg16`.
  - `PRISM_TEST_KEYCHAIN=1` — gates `@arnilo/prism-credentials-node` system-keychain round-trips (requires a working OS keychain backend; skipped by default).
  - Provider live tests read the API key from the env only when both gates are set; the key is used as a bearer token and never logged. `assertNoSecretLeak` verifies the key value does not appear in any streamed event. The compaction placeholders still carry no real credentials.
  - Enforced by `network-free-guard.test.ts` (default suite stays network-free) and by source-scanning meta-tests that assert each `live.test.ts` keeps its `skip:` guard.
- **Supply-chain workflows.** `.github/workflows/security.yml` runs CodeQL JavaScript/TypeScript SAST, PR-only dependency review, `npm audit`, SPDX 2.3 generation, exact license allow/deny policy, tracked-source plus unpacked-tarball credential-pattern scans, and seven-day SBOM retention. Dependabot opens bounded weekly npm and GitHub Actions updates. Every third-party action uses a full immutable revision; workflows never use `pull_request_target`. GitHub repository secret scanning/push protection and required-check branch rules remain repository settings because GitHub provides no equivalent checked-in workflow toggle; enable `security / codeql`, `security / supply-chain`, PR dependency review, and release checks on protected branches.
- **Sandbox/browser protected workflow.** `.github/workflows/sandbox-browser.yml` is scheduled/manual only in protected `sandbox-browser` environment. It runs network-free adversarial eval fixtures by default, optionally enables digest-pinned Docker and Playwright gates via repository variables (`PRISM_TEST_DOCKER_IMAGE`, `PRISM_ENABLE_PLAYWRIGHT_GATE`), receives no provider/npm/OIDC secrets, and uploads only a redacted aggregate status artifact (7-day retention).
- **Release attestations.** Tag publication uses GitHub OIDC with only `contents: read`, `id-token: write`, and `attestations: write` at the publish job. `actions/attest-build-provenance` attests every `.tgz` and `sbom.spdx.json` before npm publication; npm still receives `--provenance`. Verify downloaded attestations with GitHub CLI and npm signatures on the release host.
- **Install smoke is offline.** The install-smoke test packs core + every package into a temp dir and installs tarballs with `--offline --no-audit --no-fund` into a fresh project. External dependencies are satisfied from the lockfile-backed npm cache prepared by `npm ci`; any attempted uncached registry fetch fails the gate.
- **Offline test budget.** The default `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) is pinned at **< 60s on Node 20** with a measured local baseline of ~45s (build ~18s + network-free tests/workspace tests/packaging smoke ~27s). The full CI `sdk:ready` gate runs on Node 24 because docs tests execute `examples/*.ts` via native TypeScript stripping. `npm run sdk:ready` also runs typecheck and pack dry-run, so it is allowed to exceed the `npm test` budget while remaining network-free. The CI `sdk:ready` step has `timeout-minutes: 5` as a hang backstop; the separate Node 20 compatibility step has `timeout-minutes: 3`. The budget was raised from 30s after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests; optimize before raising it again.

### 0.0.9 dependency audit decision (2026-07-21)

`npm audit --audit-level=high` reports 0 vulnerabilities and `npm ls --all --depth=0` resolves the exact 32-package `0.0.96` graph (including `@arnilo/prism-browser`). Locked-install SPDX contains 185 packages and eight approved license expressions; `scripts/verify-sbom.mjs` passed. Browser keeps `playwright-core@1.61.0` as an optional peer and ships no browser binary/image; no Office package/binary enters the graph.

### 0.0.8 dependency audit decision (2026-07-20)

`npm audit --audit-level=high` reports 0 vulnerabilities and `npm ls --all --depth=0` resolves the exact 31-package `0.0.8` graph. Locked-install SPDX contains 183 packages and eight approved license expressions; `scripts/verify-sbom.mjs` passed. New runtime dependencies remain isolated to optional packages: MCP stays pinned to SDK 1.29.0 and web tools add no vendor SDK. Native `better-sqlite3` remains the sole install-script dependency and stays in opt-in SQLite.

### 0.0.9 release-candidate verification — 2026-07-21

| Gate | Result |
| --- | --- |
| Package graph | Root + 31 workspaces = 32 publishable manifests at exact `0.0.96` with exact internal peer/dependency ranges; `@arnilo/prism-browser` in `@arnilo/prism-all` only (not `@arnilo/prism-code`). |
| Deterministic suites | Post–Synapta Task 13 re-verify: `npm run sdk:ready` passed: 1,934 tests across core/workspaces (1,905 pass, 29 explicit live skips, 0 fail), full typecheck/build/examples, docs/export/package/install smoke, and 32 dry-run packs. |
| Synapta Defects 1a/1b/2 | Malformed streamed tool-call args → failed/`tool_execution_blocked` (`invalid_json_arguments`, never executes); incomplete deltas → typed `incomplete_delta` fail-closed; empty/thinking-only call-free artifacts → `parse_error` revision budget with no `succeeded` without `artifact_finished`. Conformance helper matches recovery/`incomplete_delta` contract. |
| Coding/browser | Network-free coding-agent + browser adversarial fixtures unchanged; dated `scripts/benchmark-0.0.9.mjs` evidence retained (Node v24.18.0 Linux x64, 100 iterations); protected Docker (`PRISM_TEST_DOCKER_SANDBOX=1`) and Playwright (`PRISM_LIVE_PLAYWRIGHT=1`) remain explicit operator P0 gates when host-provisioned. |
| Supply chain | `npm audit --audit-level=high` = 0 vulnerabilities; SPDX SBOM 185 packages / 8 approved licenses; working-tree secret scan 2,402 files / 0 findings; unpacked-tarball secret scan 847 files / 0 findings; `git diff --check` clean. |
| Artifacts | Packed review: 972,339 bytes compressed / 3,755,038 unpacked / 847 files across 32 tarballs; core 519,366 / 1,819,939; browser 29,171 / 132,669 with no Playwright binary/image and no Office package/binary. |
| Registry/order | Public `release:check` found all 32 `@arnilo/*@0.0.96` versions available. Dependency-ordered `release:publish --dry-run --allow-dirty --allow-untagged` completed 32/32 dry-run with explicit public/latest/provenance; no commit, tag, or publication created. |
| Office exclusion | No Office package, binary, SDK, wrapper, docs page, test, or release gate. |

### 0.0.8 release-candidate verification — 2026-07-20

Phase 3 validation ran from this working tree without creating a release commit/tag or publishing. Clean protected-branch/tag, GitHub CodeQL/dependency-review, environment approval, OIDC, and actual canary/publication checks remain mandatory in the handoff above.

| Gate | Result |
| --- | --- |
| Node 24 full matrix | `npm run sdk:ready` passed in 87 seconds inside its five-minute backstop: 1,814 tests (1,789 pass, 25 explicit live skips, 0 fail), full typecheck/build/examples, docs/export/package/install smoke, workspace conformance, and 31 dry-run packs. |
| Node 20 compatibility | Docker Node 20.20.1 performed a clean locked install, built all workspaces, and imported all 21 public root export targets. |
| PostgreSQL | Fresh `pgvector/pgvector:pg16`: 17 session-store/persistence plus 14 memory/pgvector checks passed with 0 skips/failures. |
| Packed consumer | Offline install smoke packed all 31 exact `0.0.8` tarballs into a fresh consumer, imported every public code package/core subpath, ran integration/composition journeys, and ran generated `prism init`. |
| Artifact contents | 31 tarballs contain 783 files, about 860 kB packed and 3.28 MB unpacked. Core is 245 files, about 490 kB packed and 1.74 MB unpacked. Packaging deny-list and unpacked-artifact secret scan found no tests/maps/source/plans/secrets. |
| Registry and order | Public preflight found all 31 `@arnilo/*@0.0.8` versions available. Dependency-ordered `release:publish --dry-run` completed 31/31 with explicit public/latest/provenance arguments; no publish occurred. |
| Supply chain | High-severity audit: 0 vulnerabilities; dependency tree clean; SPDX/license policy passed (183 packages/eight expressions); tracked source (2,229 files) and unpacked artifacts (783 files) returned zero secret findings. Immutable-action/permission/attestation policy tests passed. Actual CodeQL/dependency-review and artifact attestations run only in protected GitHub workflows. |
| Benchmarks | Dated 1,000-operation Node 24/Linux x64 results cover actual batched-ledger and in-memory OTel paths, snapshot-cache lookup, and provider/PostgreSQL/MCP/A2A/web local envelope shapes; table and non-live caveats are in `docs/performance.md`. |
| Live prerequisites | Disposable PostgreSQL passed and `PRISM_TEST_KEYCHAIN=1` passed 27/27. Three web-provider live tests and provider/MCP/A2A protected canaries stayed explicitly skipped because this host has no release credentials/endpoints; disabled gate performed no network. |
| Provenance/publication | GitHub OIDC attestations and npm provenance are generated only by authorized execution from clean signed `v0.0.8`; no commit, tag, attestation, or publication was created here. |

Temporary containers, benchmark JSON, SBOM, packed tarballs, and dry-run reports were deleted or kept only under `/tmp`; protected CI recreates retained release artifacts.

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
| Tarball excludes built tests, source maps, and source | `packaging.test.ts` rejects `dist/__tests__/`, `*.map`, `src/`, `plans/`, and internal files; confirms every package ships README/changelog (and code packages ship LICENSE), core ships docs + CLI, exported targets exist (`dist/index.js` + `dist/index.d.ts` for NeuralWatt), and `prism-all` transitively reaches all 32 published first-party manifests. |
| NeuralWatt package/docs/examples release gate | `packaging.test.ts` pins `@arnilo/prism-provider-neuralwatt` package exports/type declarations and `@arnilo/prism-providers`/`@arnilo/prism-all` membership; `docs.test.ts` asserts `docs/index.md` links `providers/neuralwatt.md` and `provider-caching.md`, and that `examples/cache-aware-prompt-assembly.ts` plus `examples/neuralwatt-agent-run.ts` exist and are listed. |
| Version graph and resumable publication | `release.test.ts` covers exact package/lock/range validation, topological order, registry collisions, dry-run, interrupted reports/resume, clean tagged git state, provenance/public/tag arguments, and token-safe errors. `release:check` and `release:publish` derive the workspace graph without a manual package list. |
| Supply-chain and live-canary policy | `supply-chain-security.test.ts` verifies SPDX allow/deny behavior, bounded source/artifact secret detection, credential-free canary reports, timeout/redacted failures, immutable action revisions, no `pull_request_target`, protected live environment, attestation paths, and publish dependency on `supply-chain`; CI adds CodeQL and PR dependency review. |
| Network-free + offline test budget | `network-free-guard.test.ts` keeps the default suite network-free; budget pinned `< 60s` (measured baseline above). Install-smoke is offline (`--offline --no-audit --no-fund`, zero registry fetches). |
| Core security invariants reaffirmed | Runtime/docs tests hold the trust boundary: **no built-in app tools** (hosts register tools; the core ships only the mock provider and contract helpers), **no hidden provider/credential globals** (providers/credentials are host-owned `AgentConfig` fields, resolved via explicit `providerSource`/`CredentialResolver`), **no auto package discovery** (provider/tool/skill packages are opt-in and individually installed; contribution discovery is realpath-contained and emits inert envelopes the host registers), and **no secret persistence in core** (redaction applies before any `RunLedger`/`SessionStore` append; the ledger gate asserts each message event is written exactly once and redacted). |

A change that adds a public persistence/runtime surface, a new package, or a new example must extend the matching row's enforcement (add the page to `apiPages`, the package to the `packages` array, or the example to the demos list) so the checklist stays self-maintaining.

## Related APIs

- [`docs/provider-packages.md`](provider-packages.md): first-party provider package layout and setup.
- [`docs/cli-rpc.md`](cli-rpc.md): the `prism` CLI bin and RPC protocol shipped as `dist/cli.js`.
- [`docs/configuration-and-manifests.md`](configuration-and-manifests.md): package manifest merging and validation.
