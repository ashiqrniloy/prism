# Release and install

## What it does

Prism is published as **50 publishable manifests**: the root `@arnilo/prism` core package plus **49 workspace packages** — 14 provider adapters, 9 `prism-*` family/profile packages, and 26 capability packages. (Regenerate the counts: `ls packages/*/package.json | wc -l` = 49 workspace; `ls -d packages/provider-*/ | wc -l` = 14; `ls -d packages/prism-*/ | wc -l` = 9; capability = 49 − 14 − 9 = 26; publishable = root + 49 = 50.) The 50th manifest is the 0.1.6 plan 018 optional `@arnilo/prism-document-reader` package (bounded PDF/Office literal-text extraction for the coding read tool; ships only because its `doc-reader` closeout is demanded — a deferred closeout keeps the graph at 49). This page describes how they are packed, what each tarball contains, how to install them, the required `@arnilo/prism` peer dependency, the release workflow, and the offline test budget. The measurable 1.0 readiness gates (command-per-gate) live in [`0.1.0-readiness.md`](./0.1.0-readiness.md).

Core `@arnilo/prism` ships runtime, CLI, templates, and docs. Every code package has a required `@arnilo/prism@0.1.0` peer; profiles are pure manifests. Installation activates no provider, listener, database, browser, credential, or tool capability.

Current **50** publishable manifests (root + 49 workspace packages):

`@arnilo/prism`, `@arnilo/prism-ag-ui`, `@arnilo/prism-browser`, `@arnilo/prism-coding-agent`, `@arnilo/prism-coding-security`, `@arnilo/prism-compaction-llm`
`@arnilo/prism-compaction-observational-memory`, `@arnilo/prism-credentials-node`, `@arnilo/prism-enterprise-postgres`, `@arnilo/prism-evals`, `@arnilo/prism-mcp`, `@arnilo/prism-memory`
`@arnilo/prism-model-router`, `@arnilo/prism-observability-opentelemetry`, `@arnilo/prism-policy`, `@arnilo/prism-all`, `@arnilo/prism-base`, `@arnilo/prism-caveman`
`@arnilo/prism-code`, `@arnilo/prism-compaction`, `@arnilo/prism-ponytail`, `@arnilo/prism-providers`, `@arnilo/prism-sdk`, `@arnilo/prism-provider-ai-sdk`
`@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-anthropic`, `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, `@arnilo/prism-provider-google`, `@arnilo/prism-provider-kimi`
`@arnilo/prism-provider-neuralwatt`, `@arnilo/prism-provider-ollama`, `@arnilo/prism-provider-openai`, `@arnilo/prism-provider-opencode-go`, `@arnilo/prism-provider-openrouter`, `@arnilo/prism-provider-vertex`
`@arnilo/prism-provider-zai`, `@arnilo/prism-rag`, `@arnilo/prism-server`, `@arnilo/prism-session-store-codecs`, `@arnilo/prism-session-store-nats`, `@arnilo/prism-session-store-postgres`, `@arnilo/prism-session-store-sqlite`
`@arnilo/prism-openapi-tools`, `@arnilo/prism-supervisor`, `@arnilo/prism-tool-validator-json-schema`, `@arnilo/prism-web-tools`, `@arnilo/prism-work-tools`, `@arnilo/prism-workflows`, `@arnilo/prism-document-reader`

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
| Delete all build output (explicit one-shot, see build notes) | `npm run clean` |
| Run the default (network-free) test suite | `npm test` |
| Dry-run pack core + every package | `npm run pack:dry-run` |
| Local mirror of the release verify gate | `npm run release:dry-run` |
| Validate clean tag/version/ranges and reject registry collisions | `npm run release:check -- --version 0.1.0` |
| Preview deterministic publish order | `npm run release:publish -- --version 0.1.0 --dry-run --allow-dirty --allow-untagged` |
| Resume interrupted tagged publication | `npm run release:publish -- --version 0.1.0 --resume --report release-artifacts/publish-report.json` |
| Protected PostgreSQL enterprise suite | `PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres` |
| Full SDK readiness gate (typecheck + offline tests + pack) | `npm run sdk:ready` |
| Non-blocking unused-code sweep (report to `scripts/unused-sweep-report.txt`, always exits 0) | `npm run sweep:unused` |

> **Build notes (0.1.1+).** `npm run build` no longer runs `npm run clean` first: concurrent builds/tests (`npm test`, `npm run typecheck`) are now race-free because the only destructive step was the `rm -rf` clean, and concurrent `tsc` is write-only and idempotent on identical input (two processes emitting the same files end byte-identical regardless of interleaving).
>
> `ponytail:` concurrent `tsc` is idempotent on identical input, so no single-flight lock is needed; orphaned `dist/` files from deleted sources fail loudly on the next `node --test` (broken imports) and are filtered from tarballs by the `files` allowlists; run `npm run clean` after source deletions or branch switches; `tsc --build` (0.2.0 Module F) auto-cleans orphans.

Run `npm run clean` explicitly after deleting source files or switching branches: a deleted `src/__tests__/*.test.ts` leaves an orphan `dist/__tests__/*.test.js` (tsc never auto-cleans). If the orphan's import chain still resolves it keeps running as a stale test — silent staleness, which is exactly what the explicit clean prevents — and if the chain is broken the next `node --test dist/__tests__/*.test.js` fails loudly (`ERR_MODULE_NOT_FOUND`), never silently swallowed. A fresh `npm run clean && npm run build` and the new `npm run build` from a clean state produce byte-identical `dist/` (tsc overwrites per-file outputs).

| Specifier | Resolves to |
| --- | --- |
| `@arnilo/prism` | `dist/index.{js,d.ts}` |
| `@arnilo/prism/providers/openai-compatible` | `dist/providers/openai-compatible.{js,d.ts}` |
| `@arnilo/prism/providers/transport` | `dist/providers/transport.{js,d.ts}` |
| `@arnilo/prism/providers/openai` | `dist/providers/openai-primitives.{js,d.ts}` |
| `@arnilo/prism/providers/media` | `dist/providers/media.{js,d.ts}` |
| `@arnilo/prism/testing/provider-conformance` | `dist/testing/provider-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/agent-event-source-conformance` | `dist/testing/agent-event-source-conformance.{js,d.ts}` |
| `@arnilo/prism/testing/state-concurrency-conformance` | `dist/testing/state-concurrency-conformance.{js,d.ts}` |
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
- **Tarball filenames.** npm strips the `@scope/` prefix, so the core package `@arnilo/prism` produces a tarball named `arnilo-prism-0.1.0.tgz`; first-party packages produce `arnilo-prism-provider-<name>-0.1.0.tgz` / `arnilo-prism-compaction-<name>-0.1.0.tgz` / `arnilo-prism-coding-agent-0.1.0.tgz`; family/profile packages produce `arnilo-prism-{providers,compaction,base,code,sdk,all}-0.1.0.tgz`. The CLI bin name `prism` is unaffected by the package name (`npx prism` still works; npm allows the bin field to differ from the package name).

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
    "@arnilo/prism": "0.1.0",
    "@arnilo/prism-enterprise-postgres": "0.1.0",
    "@arnilo/prism-provider-openai": "0.1.0"
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

Release publication derives all **49** manifests from the workspace once, validates exact `0.1.0` manifest/lockfile/internal ranges, then uses deterministic dependency order. `release:check` requires a clean commit tagged `v0.1.0` and rejects any existing registry version. `release:publish --resume` skips only registry versions whose internal dependency fingerprint matches the local manifest; conflicting versions fail closed. Each attempted package is written immediately to the JSON report, so a failed job can rerun safely. `--dry-run` performs registry availability checks and invokes `npm publish --dry-run` with explicit public access, provenance, and `latest` tag, but does not publish.

```bash
npm run release:check -- --version 0.1.0
npm run release:publish -- --version 0.1.0 --dry-run --allow-dirty --allow-untagged
```

`--allow-dirty` and `--allow-untagged` exist only for local preview; real publication and CI never pass them. npm registry calls occur only in these release preflight/publication commands, never build/test/package discovery.

Optional live smoke tests stay separate from SDK readiness because they require credentials and network access:

```bash
PRISM_LIVE_PROVIDER_TESTS=1 npm run test --workspaces --if-present
```

### GitHub Actions pipeline (0.0.27+)

`.github/workflows/release.yml` is the single pipeline: **push to `main`** runs CI (`verify` = `npm run sdk:ready`, `node20-compat`, `postgres-integration`, `supply-chain`), **push of a `v*` tag** additionally runs `codeql-release` and the `publish` job (deterministic `release:publish` in dependency order with provenance attestation). `security.yml` adds CodeQL/dependency-review/SBOM on push and PR; `live-canaries.yml` and `sandbox-browser.yml` are scheduled. All actions are SHA-pinned (2026-08-06 fix: CodeQL pins were invalid 404 refs and `workflow_dispatch` was missing — re-verified every pin against its upstream repo). Prerequisites outside the repo: Actions enabled in repository settings, and the `NPM_TOKEN` secret (with `id-token: write` for provenance). To re-cut a tag after a fix commit, delete and recreate it (`git push origin :v0.0.28 && git push origin v0.0.28`) so the tag creation event fires.

### 0.1.0 publish handoff (plan 012 Task 7)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.0** (Phase 12, plan 012) is the release-candidate hardening cut of the **0.0.28** graph: no new packages, public exports, schema migrations, or runtime dependencies (freeze manifest `scripts/phase12-freeze-manifest.json`). At this line the canonical statement read **49 publishable manifests**: the root `@arnilo/prism` core package plus **48 workspace packages** — 14 provider adapters, 9 `prism-*` family/profile packages, and 25 capability packages. Publishable graph stays **49** publishable manifests (root + 48 workspace packages) at exact **0.1.0**. Store compatibility with 0.0.28: **compatible, no migration** ([migration](migration.md) `0.0.28 → 0.1.0`); the full `0.0.17 → 0.1.0` upgrade matrix is in the same page. All evidence for the tree under publication is recorded in [0.1.0 readiness](0.1.0-readiness.md) (capacity envelopes, restart-recovery, e2e journeys, threat-suites leg, audit at moderate).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
node --test scripts/benchmark-0.1.0.test.mjs   # frozen 0.1.0 capacity envelope contract
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.0 --report /tmp/prism-0.1.0-preflight.json
npm run release:publish -- --version 0.1.0 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.0-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.0 -m "Prism 0.1.0"
git verify-tag v0.1.0
git push origin v0.1.0        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.0 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.0` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.0` is store-compatible with `0.0.28` in both directions (no migration ran), so an operator may defer adoption of `0.1.0` without a database rollback.

### 0.1.1 publish handoff (plan 013 Task 6)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.1** (plan 013) is the post-release hardening patch on the frozen 0.1.x line: five scoped fixes — build single-flight (clean removed from `npm run build`; standalone `npm run clean`), deterministic MCP SSE relay test (`relayStatelessBody` internal export in `@arnilo/prism-mcp`, not in the package entry surface), combined core + workspace coverage summary (`scripts/coverage-summary.mjs`, appended to `test:coverage`), canonical manifest-count narrative (49 publishable manifests = root + 48 workspace packages), and ACP modes/config ownership-scoped persistence guidance (the agent never persists them; host stores MUST key by `sessions.ownership`). Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.1**. Store compatibility with 0.1.0: **compatible, no migration** ([migration](migration.md) `0.1.0 → 0.1.1`); declaration surface additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.1 with zero breaking deltas).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.1 --report /tmp/prism-0.1.1-preflight.json
npm run release:publish -- --version 0.1.1 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.1-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.1 -m "Prism 0.1.1"
git verify-tag v0.1.1
git push origin v0.1.1        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.1 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.1` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.1` is store-compatible with `0.1.0` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback.

### 0.1.2 publish handoff (plan 014 Task 6)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.2** (plan 014) is the Alibaba Cloud provider enrichment patch on the frozen 0.1.x line: `createAlibabaEmbedder` over the OpenAI-compatible `POST {base}/embeddings` (structural `Embedder`, no new dependency), video input via `video_url` content parts on Qwen-VL models (gated on the `file` input capability), a verified compatible-mode surface decision table in [providers/alibaba.md](providers/alibaba.md) (document input and rerank deferred as demand-gated follow-ups), and an opt-in `PRISM_LIVE_DASHSCOPE_KEY` live probe. Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.2**. Store compatibility with 0.1.1: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.2 with zero breaking deltas).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.2 --report /tmp/prism-0.1.2-preflight.json
npm run release:publish -- --version 0.1.2 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.2-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.2 -m "Prism 0.1.2"
git verify-tag v0.1.2
git push origin v0.1.2        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.2 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.2` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.2` is store-compatible with `0.1.1` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback.

### 0.2.2 publish handoff (plan 022 Task 6)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.2** (plan 022) is the concurrent-state-and-durability-integrity cut on the 0.2.x review-remediation line. API surface **additive-only** vs 0.2.1 (plain reviewed compat gate at 0.2.2: deltas are the version literal plus `ModelRouterStateStore.reserveBudget`/`commitBudget`/`releaseBudget`, `ModelRouterReservation`, `ModelRouterBudgets.reservationTtlMs`, `ModelRouterLimits.maxRateKeys`/`maxBudgetKeys`, `SessionRecord.version` with `appendSession` `expectedVersion`, `EventMultiplexerError`, and the `@arnilo/prism/testing/state-concurrency-conformance` subpath — no removal; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase22-freeze-manifest.json` records per-task evidence tokens). Four behavior tightenings documented in `docs/migration.md` `0.2.1 → 0.2.2`: (1) **atomic model-budget reservation** — `reserveBudget` at admission (used + reserved + requested <= window max, `{reservationId, fencingToken, admitted, retryAfterMs?}`), `commitBudget`/`releaseBudget` at outcome, TTL expiry (default 60 s) with late commits reconciled as `unknownUsage: true`; rate/budget key maps capped (4,096 default / 65,536 hard) with LRU eviction that never drops a held-reservation row; durable reservations live in a new `reservations` JSONB column (enterprise migration 003). (2) **atomic conversation metadata** — `SessionRecord.version` + `appendSession` `expectedVersion` (`0` create-only, `N>0` exact-CAS update-only, omitted = legacy last-write-wins); stale writes throw `SessionMetadataConflictError` `metadata_conflict` (versions only, HTTP 409); concurrent create/branch/archive single-statement with branch caps inside the CAS, archive wins, deleted rows never resurrect (migration 008). (3) **single-consumer EventMultiplexer** — second concurrent `subscribe()` throws `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`. (4) **restart-stable NATS durable identity + bounded non-durable active-run registries** — durable name exactly `prism_<hmac16>`, crash-resume continues from the last ack, orphaned 0.2.1 random-suffixed consumers reclaimed on clean stop; workflow active-run registry sweeps aborted entries and fails closed at the 512 cap. New regression surface: `scripts/phase22-security.test.mjs` (4 blockers + gate accounting over built public entrypoints, wired into `security:threat-suites`), packed plain-JS `security22.mjs` consumer in install-smoke, the `@arnilo/prism/testing/state-concurrency-conformance` harness (7 probes; memory leg in npm test, durable legs in `test:postgres` and the NATS seam; zero timing-only sleeps), and the `scripts/phase22-conformance.test.mjs` gate in the `test:postgres` chain. Store compatibility with 0.2.1: **forward-only migrations** (008 + 003), see `docs/migration.md` for rollback risk. Exit gate green: npm test core + workspace + script gates (incl. phase21-freeze done-phase + phase22 conformance), `sdk:ready` exit 0, audit 0 moderate, secret scans 0 findings, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.2, protected OIDC/OPA evidence + durable state-concurrency evidence; evidence in `scripts/phase22-baseline.json` `exitGate`. Rollback = restore the 0.2.1 manifests/tag — but that reopens all four race windows, so prefer fixing the failing host on 0.2.2.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.2 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates (incl. phase22 conformance)
npm run security:threat-suites                  # phase8-11 + phase20 + phase21 + phase22 public-entry conformance
npm run sdk:ready                               # typecheck, lint, format, test, coverage, pack, release:gate
node scripts/release.mjs gate --version 0.2.2   # plain reviewed additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.2 --report /tmp/prism-0.2.2-preflight.json
npm run release:publish -- --version 0.2.2 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.2-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): live OIDC JWKS through the default pinned path (`createOidcIdentityVerifier` against a real public IdP — real DNS/TLS/JWKS document, e.g. `https://login.microsoftonline.com/common/discovery/v2.0/keys`, success proven by a key-lookup miss after a 200 fetch), live OPA (dockerized `openpolicyagent/opa`, default pinned path fails closed `ssrf_denied`), and the durable state-concurrency legs (Postgres `prism_phase22_*` schemas for sessions/checkpoints/events + enterprise router reservations/idempotency, NATS restart-durable resume against the seam). Missing protected evidence records 0.2.2 as **blocked**, never a passing skip.

### 0.2.1 publish handoff (plan 021 Task 8)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.1** (plan 021) is the provider-completion and outbound-trust-boundaries cut on the 0.2.x review-remediation line. API surface **additive-only** vs 0.2.0 (plain reviewed compat gate at 0.2.1: the only deltas are the version literal and `@arnilo/prism-mcp` transport helpers `boundResponse`/`defaultResolver`/`isLoopbackAddress`/`isLoopbackHostname`/`normalizeHostname`/`raceAbort`/`requestPinned`/`resolvePinnedAddress` becoming re-exports of the lifted core primitives — same names/signatures, no removal; baselines regenerated with `--update-baseline`, no `--allow-break`; freeze manifest `scripts/phase21-freeze-manifest.json` machine-checks each task's diff and the preserved surface). Five documented security-motivated behavior tightenings in `docs/migration.md` `0.2.0 → 0.2.1`: (1) **strict stream completion is the shared default** (`strictCompletion: true` in `createOpenAICompatibleProvider`; explicit `false` stays the documented opt-out; truncated streams fail `ProviderTransportError` `incomplete_delta` instead of a successful `providerDone`; applies to Azure/Bedrock/Vertex/OpenRouter/ZAI/NeuralWatt); (2) **bounded success bodies** — additive `readBoundedResponseJson` (65,536-byte ceiling, depth 32, properties 4096, shape gate, abort, redacted errors, `response_body_shape` code) replaces unbounded `response.json()` on all ten model-discovery sites plus NeuralWatt quota, Alibaba embeddings, OpenAI uploads, and both OAuth success paths; (3) **DNS-pinned OIDC JWKS/OPA/content fetch, redirects rejected** — core `pinnedFetch` (one resolve, 1–32 bound, per-candidate SSRF validation, pinned-lookup socket) serves the default JWKS, OPA decision, and content/media paths; 3xx fails `MediaContentError` `redirect`; private/metadata/loopback fails `ssrf_denied`; MCP re-exports the lifted helpers byte-identically; (4) **shared bounded OAuth device/token polling** — core `pollDeviceCodeToken` serves provider-openai and credentials-node with equivalent cadence/backoff/redaction; (5) **edge fixes** — Azure/Vertex credential-once, Bedrock duplicate-case/repeated-query SigV4 canonicalization, OpenAI upload failed-DELETE retention, cache `__overflow__` tokens-only. New regression surface: `scripts/phase21-security.test.mjs` (10 conformance tests over built public entrypoints, wired into `security:threat-suites`) and a packed plain-JS `security21.mjs` consumer in install-smoke. Store compatibility with 0.2.0: **compatible, no migration**. Exit gate green: npm test core + script gates (incl. phase21-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.1, live OIDC JWKS + live OPA protected evidence; evidence in `scripts/phase21-baseline.json` `exitGate`. Rollback = restore the 0.2.0 manifests/tag — but rollback restores the five boundary gaps, so hosts should disable truncated-stream acceptance, unbounded-body endpoints, redirect-following fetches, rotating-credential reuse, and upload cleanup at their own boundary if rollback is unavoidable.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.1 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run security:threat-suites                  # phase8-11 + phase20 + phase21 public-entry conformance
npm run sdk:ready                               # typecheck, lint, format, test, coverage, pack, release:gate
node scripts/release.mjs gate --version 0.2.1   # plain reviewed additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.1 --report /tmp/prism-0.2.1-preflight.json
npm run release:publish -- --version 0.2.1 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.1-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): live OIDC JWKS through the default pinned path (`createOidcIdentityVerifier` against a real public IdP — real DNS/TLS/JWKS document, e.g. `https://login.microsoftonline.com/common/discovery/v2.0/keys`, success proven by a key-lookup miss after a 200 fetch) and live OPA (`docker run -p 127.0.0.1:8181:8181 openpolicyagent/opa run --server`, push a policy, then prove the default pinned path fails closed `ssrf_denied` against the real server; decision-success behavior is covered by the built public conformance suite since the pinned path refuses private addresses by design). Missing protected evidence records 0.2.1 as **blocked**, never a passing skip.

### 0.2.0 publish handoff (plan 020 Task 6)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.2.0** (plan 020) is the first cut of the 0.2.x review-remediation line — fail-closed runtime and sandbox security. API surface **additive-only** vs 0.1.7 (plain compat gate at 0.2.0: 0 breaking declaration deltas — the three blockers are behavior tightenings, not removals; `containmentClaim` retained deprecated; baseline text regenerated with `--update-baseline`, no `--allow-break` anywhere; freeze manifest `scripts/phase20-freeze-manifest.json` machine-checks each task's diff stayed inside its allowed files). Shipped: (1) **durable-resume input validation** — `assertValidAgentRunResume` at the top of `prepareAgentRunResume` covers all four public resume entrypoints; unknown legacy decisions (`"sideways"`), malformed batches, oversized reasons/elicitation, duplicate approval ids fail closed `ERR_PRISM_DECISION_*` with zero checkpoint writes/tool calls (server parser stays defense in depth); (2) **work-tool environment isolation** — `createCliRunner` children get a fixed base allow-list + explicit env + forced HOME/telemetry controls + late-bound per-identity tokens, 64-name/64-KiB caps `ERR_PRISM_WORK_ENV`, absolute binary/configDir, linear output capture; (3) **explicit sandbox capabilities** — `SandboxAdapter.capabilities` (six immutable booleans, omission/malformed ⇒ all false), composition capabilities from verified wiring, `containmentClaim` deprecated as the conservative projection; Docker reports only verified controls, native reports filesystem/process/privilege false; docs/coding-security.md capability table, docs/host-security.md authorization guidance. New regression surface: `scripts/phase20-security.test.mjs` (public built entrypoints, wired into `security:threat-suites`), packed plain-JS consumer regressions in install-smoke, and the sandbox-browser workflow's fail-loud 0.2.0 blocker gate recording Docker/native capability evidence — **0.2.0 does not ship while any blocker is skipped**. Store compatibility with 0.1.7: **compatible, no migration** (no persisted-shape change; `docs/migration.md` `0.1.7 → 0.2.0` section). Exit gate green: npm test core + script gates (incl. phase20-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, plain reviewed compat gate at 0.2.0, Docker daemon + native netns protected evidence; evidence in `scripts/phase20-baseline.json` `exitGate`. Rollback = restore the 0.1.7 manifests/tag — but rollback restores the three defects, so hosts should disable resume side effects and work-tool execution at their own boundary if rollback is unavoidable.

```bash
# Operator prerequisites recorded: clean tree at the v0.2.0 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run security:threat-suites                  # phase8-11 + phase20 public-entry conformance
npm run sdk:ready                               # typecheck, lint, format, test, coverage, pack, release:gate
node scripts/release.mjs gate --version 0.2.0   # plain reviewed additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.2.0 --report /tmp/prism-0.2.0-preflight.json
npm run release:publish -- --version 0.2.0 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.2.0-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical
```

Protected evidence (never a passing skip): `docker info` + digest-pinned image (e.g. `PRISM_TEST_DOCKER_SANDBOX=1 PRISM_TEST_DOCKER_BIN=/usr/bin/docker PRISM_TEST_DOCKER_IMAGE=ubuntu@sha256:... npm test -w @arnilo/prism-coding-security -- --test-name-pattern "protected Docker"`) and native netns capability (`unshare --net` / `--net --map-root-user` must succeed; T9 native capability test runs, not skips). The sandbox-browser workflow fails loudly when this evidence is missing.

### 0.1.7 publish handoff (plan 019 Task 6)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.7** (plan 019) is the performance-and-DX patch on the frozen 0.1.x line — **additive-only** vs 0.1.6 (plain compat gate at 0.1.7 passed with 0 breaking declaration deltas; the baseline text was regenerated with `--update-baseline` for the version literal only, no `--allow-break` anywhere; freeze manifest `scripts/phase19-freeze-manifest.json` machine-checks each task's diff stayed inside its allowed files). Shipped: (1) **prompt-cache telemetry surface** — dependency-free `createCacheTelemetry()` aggregator in core, host-activated, per-provider/model request counts + aggregate hit rate + cache-read/write token totals + estimated savings, bounded cardinality (cap 256 distinct keys, `__overflow__` bucket), token counters/rates only (never prompt content, cache keys, or identity), O(1) `record()`; (2) **model-router selection policies** — additive `ModelRouterSelectionPolicy` on `createModelRouter` (default ordered behavior byte-identical) with the reference `createCostLatencySelection` ranking by `ModelCost` then in-memory latency EMA fed from `recordOutcome({ latencyMs })`, permutation-only reorder of already-allowed candidates, misbehavior fails closed `ERR_PRISM_MODEL_ROUTER_POLICY`; (3) **async AgUiProjection closeout** — plan 009 Task 15 surface verified with evidence (`asyncHooks: {verified: true, gapFound: false}` in `scripts/phase19-baseline.json`), no new code; (4) **`prism providers add <name>` scaffold** — new CLI subcommand generating an OpenAI-compatible provider package (manifest, provider via `createOpenAICompatibleProvider`, starter models, cache helpers, offline conformance test, docs stub) with npm-name/traversal/symlink-escape validation and placeholders only — never secrets; scaffold output is host-chosen and never auto-registered. Store compatibility with 0.1.6: **compatible, no migration** (additive-only; no persisted-shape change; `docs/migration.md` gains no entries). Exit gate green: npm test core + script gates (incl. phase19-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, budget/benchmark gates green; evidence in `scripts/phase19-baseline.json` `exitGate`. Rollback = restore the 0.1.6 manifests/tag.

```bash
# Operator prerequisites recorded: clean tree at the v0.1.7 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run sdk:ready                               # typecheck, lint, format, test, pack, release:gate
node scripts/release.mjs gate --version 0.1.7   # plain additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.7 --report /tmp/prism-0.1.7-preflight.json
npm run release:publish -- --version 0.1.7 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.7-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.7 -m "Prism 0.1.7 — performance and DX (additive)"
git verify-tag v0.1.7
git push origin v0.1.7        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

### 0.1.6 publish handoff (plan 018 Task 7)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.6** (plan 018) is the coding-agent capability-closeouts patch on the frozen 0.1.x line — **additive-only** vs 0.1.5 (plain compat gate at 0.1.6 passed with 0 breaking declaration deltas; the baseline text was regenerated with `--update-baseline` for the version literal only, no `--allow-break` anywhere). Five demand-gated closeouts shipped, each flipped to `demanded` by named demand evidence (operator `arn` for native-sandbox/doc-reader/delete-glob/checkpoint-bodies, user `Clay` for acp-session-store) before its task landed; the demand-gate registry (`scripts/phase18-freeze-manifest.json`) machine-checks demanded ⇒ implemented, deferred ⇒ untouched. Shipped: (1) **durable ACP session store** — `@arnilo/prism-ag-ui` `AcpSessionStore` host seam (`save`/`loadAll`/`evict`), persisted `{sessionId, ownership, modeId, configValues, cwd, additionalDirectories, updatedAt}`, lazy ownership-scoped restore, fail-closed drops, absent seam = 0.1.5 behavior; (2) **network-free native sandbox** — `createNativeSandbox` in `@arnilo/prism-coding-security` (fresh netns per command via the OS `unshare` binary, chained ulimits with `|| exit 126`, argv-only exec, cwd containment, process-group kill, env allow-list, Linux-only fail-closed); (3) **bounded PDF/Office document reader** — new optional package `@arnilo/prism-document-reader` (the 50th manifest, graph 49 → 50) with optional `pdf-parse`/`mammoth` peers fail-closed at creation, magic-byte gating, null fall-through, caps + redaction at the adapter boundary; (4) **recursive delete + brace-expanding glob** — per-call `recursive: true` with fan-out cap and symlink-unlink-not-follow, host-selected/per-call `braceExpansion` bounded to 128 alternatives / 4096 expanded bytes, fail-closed on overflow/malformed braces; (5) **checkpoint persistence for loaded-skill bodies** — opt-in `includeSkillBodies` on run + resume options (names-only stays default, 0.1.3 shapes byte-identical), ≤64 bodies / ≤256-char names / ≤262144-byte bodies / ≤1 MiB total, `maxStateBytes` refusal, redacted at rest, registry-independent resume render. Store compatibility with 0.1.5: **compatible, no migration** (additive-only; no persisted-shape change; `docs/migration.md` gains no entries). Exit gate green: npm test core 1,433/1,433 + 190 script gates (incl. phase18-freeze done-phase), `sdk:ready` exit 0, audit 0 moderate, pack dry-run 50/50 twice byte-identical, budget/benchmark gates green; evidence in `scripts/phase18-baseline.json` `exitGate`. Rollback = restore the 0.1.5 manifests/tag.

```bash
# Operator prerequisites recorded: clean tree at the v0.1.6 tag candidate, GPG key, npm OIDC publisher.
npm test                                        # core + workspace suites + all script gates
npm run sdk:ready                               # typecheck, lint, format, test, pack, release:gate
node scripts/release.mjs gate --version 0.1.6   # plain additive gate, 0 breaking deltas
npm run pack:dry-run                            # twice; diff reports — deterministic
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.6 --report /tmp/prism-0.1.6-preflight.json
npm run release:publish -- --version 0.1.6 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.6-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.6 -m "Prism 0.1.6 — coding-agent capability closeouts (additive)"
git verify-tag v0.1.6
git push origin v0.1.6        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.6 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.6` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.6` is store-compatible with `0.1.5` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback. The next line **0.1.7** continues the frozen 0.1.x additive promise; the 0.2.0 module line (delegated agents, agent-owned persistence, host-owned seam expansions) is the next documented cut.

### 0.1.5 publish handoff (plan 017 Task 4)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.5** (plan 017) is the **documented breaking cut** on the frozen 0.1.x line — deprecated-option removal, with the removed-symbols list, replacements, before/after examples, dynamic-config refusal behavior, store compatibility, and rollback in the top `docs/migration.md` `0.1.4 → 0.1.5` section. Removed: `ProviderRequestOptions.timeoutMs`/`maxRetries`/`maxRetryDelayMs` (inert in first-party providers; abort/retry lives at the host layer — replacements `RunOptions.signal`/`AgentConfig.retry`/`RunOptions.retry`), `RunOptions.maxToolRounds` (→ `limits.maxToolRounds`; CLI `--max-tool-rounds` unchanged), `ObservationalMemorySettingsInput` pre-0.0.19 flat keys and top-level `workerProvider`/`workerModel` aliases (→ nested `observation`/`reflection`/`dropper` configs; `sessionModel` fallback unchanged), `ReadToolOptions.autoResizeImages` (→ `transformImage`), and `INIT_PROVIDERS` (→ `listInitProviders()`). Every removal **fails closed** for untyped callers with a `TypeError` naming the replacement before any provider call, tool call, filesystem access, compaction, or session append. Compat baselines were regenerated only after the reviewed `--allow-break` break report: `arnilo__prism.txt` (removed `INIT_PROVIDERS` const + `maxToolRounds`/provider-knob member lines — interface members are not baseline text, so the delta is the `INIT_PROVIDERS` line), `arnilo__prism-coding-agent.txt` (`autoResizeImages` is an interface member — baseline delta limited to statement/re-export text if any), `arnilo__prism-compaction-observational-memory.txt` (flat keys and worker aliases are interface members — no baseline line delta expected). Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.5**. Store compatibility with 0.1.4: **compatible, no migration** (removed options were inert aliases; nested replacements resolve to the same active values; `DEFAULT_RUN_LIMITS.maxToolRounds` 8 / hard cap 64 unchanged); zero new dependencies (lockfile name-set unchanged).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.5 --report /tmp/prism-0.1.5-preflight.json
npm run release:publish -- --version 0.1.5 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.5-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.5 -m "Prism 0.1.5 — documented breaking cut: deprecated-option removal"
git verify-tag v0.1.5
git push origin v0.1.5        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.5 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.5` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.5` is store-compatible with `0.1.4` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the cut without a database rollback; code/config using removed keys must be migrated first (removed keys fail closed on 0.1.5).

### 0.1.4 publish handoff (plan 016 Task 6)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.4** (plan 016) is the internal god-module split, compat-preserving on the frozen 0.1.x line: `src/agents.ts` and `src/contracts.ts` reorganized by concern behind barrel re-exports (`contracts-core`/`contracts-run-state`/`contracts-protocol`; `agent-session`/`agent-run-lifecycle`/`agent-approval`/`agent-tool-dispatch` reusing `agent-run-state`/`agent-loops`/`compaction`) with a **byte-identical public entry surface** (0 added/0 removed/0 changed vs the 0.1.3 baseline; the 14 additive union-surface helpers are internal cross-module exports, not consumer-importable — deviation #1), measured tree-shaking improvement (111,049 → 982 B `dist/agents.js`, 9,420 → 418 B `dist/contracts.js`, module count 64 → 70; evidence in `scripts/phase16-baseline.json`), and additive **`@arnilo/prism-browser` Chrome DevTools Protocol capabilities** (Tasks 4-5): `browser_evaluate`, `browser_observe`, `block_urls`/`unblock_urls`/`throttle`/`emulate` act actions, and `{ css }`/`{ xpath }` targets on Chromium hosts — 41 added / 0 removed / 18 changed declaration texts (15 re-export-statement artifacts + 3 optional-member/signature widenings), the documented deviation #2 carve-out; root `arnilo__prism.txt` regenerated with zero breaking deltas. Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.4**. Store compatibility with 0.1.3: **compatible, no migration**; zero new dependencies (lockfile name-set unchanged).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.4 --report /tmp/prism-0.1.4-preflight.json
npm run release:publish -- --version 0.1.4 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.4-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.4 -m "Prism 0.1.4"
git verify-tag v0.1.4
git push origin v0.1.4        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.4 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.4` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.4` is store-compatible with `0.1.3` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback. The next line, **0.1.5**, is the documented breaking cut (deprecated-option removal) with its removed-symbols list landing in `docs/migration.md`.

### 0.1.3 publish handoff (plan 015 Task 5)

**Decision: GO when the operator prerequisites below are recorded.** Release **0.1.3** (plan 015) is the dead-code and deprecation hygiene patch on the frozen 0.1.x line: one parameterized benchmark runner `scripts/benchmark.mjs --scenario <name>` replaces the per-version runners (16 orphaned `benchmark-0.0.{8..16}` runner/test files removed, evidence JSON kept; the CI schema leg runs `scripts/benchmark.test.mjs`), the 12 `docs/review-coverage-2026-07-*.md` evidence files moved to the tarball-excluded `docs/_evidence/` archive, a non-blocking unused-code sweep (`npm run sweep:unused` — tsc `noUnusedLocals`/`noUnusedParameters` over core + all workspace tsconfigs plus a zero-dep dead-export scan; always exits 0, report to `scripts/unused-sweep-report.txt`), and opt-in checkpoint persistence (`persistSessionState: true` on durable run/resume options — loaded-skill name catalog ≤64 names rides the run-state checkpoint and restores on resume, bodies re-resolve from the live registry; `createReadPathSetPersistence` in `@arnilo/prism-coding-agent` persists the read-before-write path set through the host `CheckpointStore`, ≤1024 paths, ownership-scoped). Publishable graph stays **49** manifests (root + 48 workspace) at exact **0.1.3**. Store compatibility with 0.1.2: **compatible, no migration**; declaration surface additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.3 with zero breaking deltas).

```bash
# Operator prerequisites (each a named blocked gate — none may be skipped):
#  1. protected live-canary matrix green (live-canaries.yml, canary-report.json retained)
#  2. PostgreSQL + keychain protected suites green (test:postgres, keychain suite)
#  3. CodeQL SAST green on the release commit (security.yml / release.yml codeql-release)
#  4. npm OIDC trusted publishing identity authenticated (NPM_TOKEN with id-token, provenance)

git diff --check
npm ci
npm run sdk:ready            # includes typecheck, lint, format, full test, coverage, pack, release:gate
npm run security:threat-suites
PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres   # Phase 7 + Phase 12 restart-recovery
npm audit --audit-level=moderate
npm run release:check -- --version 0.1.3 --report /tmp/prism-0.1.3-preflight.json
npm run release:publish -- --version 0.1.3 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.1.3-dry-run.json
#   run the dry-run twice and diff the reports: deterministic, byte-identical

# Sign the release on the clean tagged tree (operator GPG key):
git tag -s v0.1.3 -m "Prism 0.1.3"
git verify-tag v0.1.3
git push origin v0.1.3        # tag push triggers release.yml publish job (provenance, attestations)

# Real publication never bypasses the gates: release.mjs refuses
# --allow-dirty/--allow-untagged without --dry-run.
```

**Rollback notes.** `release:publish --version 0.1.3 --resume --report release-artifacts/publish-report.json` resumes an interrupted publication and skips only registry versions whose internal dependency fingerprint matches the local manifest. A failed package aborts the run with its status written to the report; re-run after fixing the cause. npm cannot unpublish the `0.1.3` line after 72 hours — a post-publication defect ships as a `0.1.x` patch (additive-only compat promise, `release:gate` enforced), or as a documented break in the next line with a `docs/migration.md` entry. `0.1.3` is store-compatible with `0.1.2` in **both directions** (no migration ran — same checksum-protected contract), so an operator may defer or roll back the patch without a database rollback.

### 0.0.28 publish handoff (historical)

**Decision: GO after protected operator prerequisites below.** Release **0.0.28** (Phase 11, plan 011) ships the optional enterprise adapter seams: OIDC/JWKS identity verification (`@arnilo/prism-credentials-node/oidc`), OPA policy evaluation into the durable ledger (`@arnilo/prism-policy/opa`), MCP OAuth client/server support (`@arnilo/prism-mcp`), host-selected OpenAPI operations as effect-gated tools (`@arnilo/prism-openapi-tools`), and an S3-compatible artifact body store behind the new core body contract (`@arnilo/prism-server/artifact-bodies`). Every seam is opt-in and fail-closed; hosts that wire none keep exact prior behavior. Publishable graph stays **49** publishable manifests (root + 48 workspace packages; `prism-openapi-tools` joined the graph in this release). See [migration](migration.md) `0.0.27 → 0.0.28`.

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/phase11-conformance.test.mjs
node scripts/benchmark-0.0.28.mjs > scripts/benchmark-0.0.28.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate -- --version 0.0.28 --allow-break --allow-dirty --allow-untagged
npm run release:check -- --version 0.0.28 --allow-dirty --allow-untagged --report /tmp/prism-0.0.28-preflight.json
npm run release:publish -- --version 0.0.28 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.28-dry-run.json
git tag -s v0.0.28 -m "Prism 0.0.28"
git verify-tag v0.0.28
git push origin v0.0.28
```

### 0.0.27 publish handoff

**Decision: GO after protected operator prerequisites below.** Release **0.0.27** (Phase 10, plan 010) ships complete ACP coding-host interop in `@arnilo/prism-ag-ui/acp`: seam-based capability advertisement, session persistence, modes/config overlays, client fs/terminal adapters, MCP select gate, `CodingLifecycleEvent` → ACP update mapping, four-outcome approvals with elicitation, and frozen caps. Publishable graph stays **48** manifests. See [migration](migration.md) `0.0.26 → 0.0.27` and [ACP coding-host interop](acp.md).

```bash
git diff --check
npm ci
npm run sdk:ready
node --test scripts/phase10-conformance.test.mjs
node scripts/benchmark-0.0.27.mjs > scripts/benchmark-0.0.27.json
node --test scripts/budget-gate.test.mjs scripts/tooling-gate.test.mjs
node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
npm audit --audit-level=moderate
npm run release:gate -- --version 0.0.27 --allow-break --allow-dirty --allow-untagged
npm run release:check -- --version 0.0.27 --allow-dirty --allow-untagged --report /tmp/prism-0.0.27-preflight.json
npm run release:publish -- --version 0.0.27 --dry-run --allow-dirty --allow-untagged --report /tmp/prism-0.0.27-dry-run.json
git tag -s v0.0.27 -m "Prism 0.0.27"
git verify-tag v0.0.27
git push origin v0.0.27
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

### Release-integrity evidence matrix (0.0.18 → 0.1.0)

Phase 12 Task 2 (plan 012) closes roadmap defect #4: every release from 0.0.18 onward has a signed tag or a **documented publication-evidence pointer**. Tags below were created as lightweight refs (no GPG signature was available in this environment); each release therefore carries a documented evidence pointer: the roadmap phase completion evidence, benchmark JSON, conformance suite, and/or migration section that records what shipped. The 0.1.0 cut requires the **signed** tag + provenance publication procedure (operator action, see [0.1.0 readiness](0.1.0-readiness.md) "Remaining for 1.0").

| Release | Tag | Evidence pointer |
| --- | --- | --- |
| 0.0.18 | `v0.0.18` (lightweight, at `f627752`) | Roadmap Phase 1 completion evidence; `docs/migration.md` `0.0.17 → 0.0.18`; docs tripwire Phase 1 |
| 0.0.19 | `v0.0.19` (lightweight, at `7574e50`) | Roadmap Phase 2 completion evidence; migration `0.0.18 → 0.0.19` |
| 0.0.20 | `v0.0.20` (lightweight, at `b2cdb2e`) | Roadmap Phase 3 completion evidence; migration `0.0.19 → 0.0.20` |
| 0.0.21 | **no tag** | Roadmap Phase 4 completion evidence (workspace 0.0.21 / 44 manifests, sdk:ready green); migration `0.0.20 → 0.0.21` |
| 0.0.22 | `v0.0.22` (lightweight, at `f9902ed`) | Roadmap Phase 5 completion evidence; 0.0.22 publish handoff above; migration `0.0.21 → 0.0.22` |
| 0.0.23 | `v0.0.23` (lightweight, at `1401b6b`) | Roadmap Phase 6 completion evidence; 0.0.23 publish handoff above; `scripts/benchmark-0.0.23.json`; migration `0.0.22 → 0.0.23` |
| 0.0.24 | `v0.0.24` (lightweight, at `55c4b0e`) | Roadmap Phase 7 completion evidence; 0.0.24 publish handoff above; `scripts/benchmark-0.0.24.json`; `scripts/phase7-conformance.test.mjs`; migration `0.0.23 → 0.0.24` |
| 0.0.25 | `v0.0.25` (lightweight, at `24d7ac0`) | Roadmap Phase 8 completion evidence; `scripts/benchmark-0.0.25.json`; `scripts/phase8-conformance.test.mjs`; migration `0.0.24 → 0.0.25` |
| 0.0.26 | `v0.0.26` (lightweight, at `77fac7e`) | Roadmap Phase 9 completion evidence; `scripts/benchmark-0.0.26.json`; `scripts/phase9-conformance.test.mjs`; migration `0.0.25 → 0.0.26` |
| 0.0.27 | `v0.0.27` (lightweight, at `9d49625`) | Roadmap Phase 10 completion evidence; `scripts/benchmark-0.0.27.json`; `scripts/phase10-conformance.test.mjs`; migration `0.0.26 → 0.0.27` |
| 0.0.28 | **no tag (HEAD is 0.0.28 scope)** | Roadmap Phase 11 completion evidence; 0.0.28 publish handoff above; `scripts/benchmark-0.0.28.json`; `scripts/phase11-conformance.test.mjs`; migration `0.0.27 → 0.0.28` |
| 0.1.0 | `v0.1.0` **signed** (operator action at publication) | Phase 12 plan 012 records; `node scripts/release.mjs publish --version 0.1.0 --dry-run --allow-untagged` semantics verified (dry-run proceeds untagged; real publication refuses `--allow-untagged`/`--allow-dirty`) |

Machine check: `git tag --points-at <commit>` and the roadmap phase completion blocks above are the evidence trail; `node scripts/release.mjs check --version 0.1.0` validates the exact version graph at bump time (plan 012 Task 7).

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

## 0.1.x compatibility and support matrix

Frozen by Phase 12 Task 0 in `scripts/phase12-freeze-manifest.json` (schema gate `node --test scripts/phase12-freeze.test.mjs`; docs agreement tripwired in the docs test suite). Any change requires a recorded freeze deviation in plan 012.

### Supported and measured

| Dimension | Supported | Measured evidence |
| --- | --- | --- |
| Node | 20, 24 (`engines.node >=20`) | `release.yml`: `verify` runs SDK readiness on Node 24; `node20-compat` builds and imports every public root export on Node 20. Docs examples need Node >=22.6 native TypeScript stripping. Node 22 is engines-supported but not measured in CI at freeze. |
| PostgreSQL | 16 | `release.yml` `postgres-integration` job with image `pgvector/pgvector:pg16`; driver `pg@^8.22.0`; schema version 6. The pgvector extension is required only by the `@arnilo/prism-memory` path. Range claims beyond 16 need an added protected leg before they may be documented. |
| Platform | linux-x64 | Every CI leg runs on `ubuntu-latest` (x64). All other OS/arch combinations are untested: run `npm run sdk:ready` on the target platform before production adoption. |
| Providers | every published `@arnilo/prism-provider-*` plus the OpenAI-compatible transport | Per-package conformance suites in the default network-free `npm test`; live canaries stay credential-gated (`PRISM_LIVE_PROVIDER_TESTS=1`). |
| Protocol SDKs | exact pins below | MCP 38-test suite, AG-UI/ACP/A2A protocol conformance, NATS JetStream event-source conformance. |

| Package | Frozen pin |
| --- | --- |
| `@modelcontextprotocol/sdk` | `1.30.0` |
| `@agentclientprotocol/sdk` | `1.3.0` |
| `@ag-ui/core` | `0.0.57` |
| `@nats-io/jetstream` | `^3.4.0` |
| `@nats-io/transport-node` | `^3.4.0` |

### Unsupported combinations

- Node below 20 (engines floor).
- PostgreSQL server majors outside the supported list (only 16 measured at freeze).
- ACP v2 experimental APIs — stable v1 only.
- Cedar policy engine — OPA adapter only.
- Redis/Kafka queues or backplanes — PostgreSQL and NATS JetStream event sources only.
- Forges beyond GitHub.
- Object stores beyond the S3-compatible reference adapter.
- Remote-browser vendors, hosted cloud, Studio/control plane, and channel catalogs (Phase 13 demand-gated).

### Security-support boundary

Audit fixes, dependency updates, and security patches land only for the supported lines above. The 0.1.0 audit target is moderate-or-higher (`releasePolicy.auditLevelTarget` in the freeze manifest); since plan 012 Task 6 both `security.yml` and the `release.yml` supply-chain job enforce `npm audit --audit-level=moderate` (0 vulnerabilities at every severity recorded for the 0.1.0 tree). Unsupported combinations receive no fixes. Supply-chain gates are listed in [host security](host-security.md).

## Extension and configuration notes

- **Required `@arnilo/prism` peer.** Every first-party code package declares a non-optional `@arnilo/prism@0.0.28` peer (`peerDependenciesMeta` must not mark `@arnilo/prism` optional; other peers such as `playwright-core` may be optional). The range stays pinned to `0.0.28` for the current 0.x release and will widen to `^1.0.0` at the 1.x stable release. Inside the workspace each package also declares `"@arnilo/prism": "file:../.."` in `devDependencies` so `npm install` resolves the peer locally; that devDependency is stripped from consumer installs and is not a runtime dependency.
- **Public access.** All 49 manifests (root + 48 workspace packages: 42 code packages + 6 pure-manifest family/profile packages) declare `"publishConfig": { "access": "public" }`; the publisher also passes `--access public` explicitly because scoped packages otherwise default to restricted on first publish.
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
- **Packed-install e2e journeys (plan 012 Task 3).** `scripts/e2e-enterprise-journey.test.mjs` and `scripts/e2e-coding-journey.test.mjs` pack the first-party packages for their journey, install the exact tarballs into a fresh consumer project, and run the journey script inside that consumer — public exports only, no workspace-relative resolution (asserted per run). The **enterprise journey** composes OIDC identity → OPA policy decision (durable ledger) → agent run with durable events (memory, or real PostgreSQL when `PRISM_TEST_POSTGRES_URL` is set) → batched approval → OpenAPI side effect with idempotency → artifact upload + signed delivery, with policy-deny and hash-mismatch fail-closed injections. The **coding journey** composes an ACP editor session (init capability negotiation, session new + load/resume) → bounded coding tools (git-aware list/search, glob, read-before-write write, delete, move) → sandboxed process session → forge handoff with idempotent PR creation, with execution-policy and read-before-write denial paths. Each fixture asserts the installed version matches the packed manifest graph and stays within the frozen `e2eJourneyFixtureMsCeiling` (120 s in `scripts/phase12-freeze-manifest.json`).
- **Protected restart-recovery leg (plan 012 Task 4).** `scripts/phase12-restart-recovery.test.mjs` (run by `npm run test:postgres` after the Phase 7 suite) spawns two real processes against one PostgreSQL schema: replica A runs a durable agent, suspends on a batched tool approval, appends durable events and is then SIGKILLed by the driver; replica B reconnects and resumes. Operators re-run the leg with `PRISM_TEST_POSTGRES_URL="postgresql://…" npm run test:postgres` against a disposable PostgreSQL 16 (e.g. `pgvector/pgvector:pg16`). Without the URL the gate records a named `BLOCKED GATE` failure instead of skipping. Reconnect p95 and 16-worker append contention p95 are asserted against the frozen `reconnectP95Ms` / `pointOpP95Ms` ceilings; set `PRISM_PHASE12_RECORD_EVIDENCE=1` to refresh the checked-in evidence file `scripts/phase12-restart-recovery.json`.
- **Offline test budget.** The default `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) is pinned at **< 60s on Node 20** with a measured local baseline of ~45s (build ~18s + network-free tests/workspace tests/packaging smoke ~27s). The full CI `sdk:ready` gate runs on Node 24 because docs tests execute `examples/*.ts` via native TypeScript stripping. `npm run sdk:ready` also runs typecheck, pack dry-run, and the coverage summary, so it is allowed to exceed the `npm test` budget while remaining network-free. `npm run test:coverage` additionally runs the combined coverage summary (`npm run coverage:summary`, ~25s local: core + each workspace suite once with `--experimental-test-coverage`; measured total ~70s on Node 24) — additive reporting only, the core gate stays the only hard threshold. The CI `sdk:ready` step has `timeout-minutes: 5` as a hang backstop; the separate Node 20 compatibility step has `timeout-minutes: 3`. The budget was raised from 30s after the default suite grew to include every first-party package, offline install smoke, packaging guards, docs examples, and workspace tests; optimize before raising it again.

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
