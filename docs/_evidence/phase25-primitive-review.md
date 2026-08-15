# Phase 25 — Primitive Review (Plan 025 Task 0)

Plan: `plans/025-Release-0-2-5-Maintainability-And-Bounded-Performance.md` (roadmap §0.2.5).
Baseline: `@arnilo/prism` **0.2.4** (`scripts/phase24-baseline.json.exitGate.green: true`; 50-package graph; `npm test` 3567/3534/33/0; `security:threat-suites` 50/50; `test:postgres` 91/91; core coverage 90.53/84.20/90.54; `release:gate` 0 breaking deltas; Node 20 packed imports 24/24; `npm audit` 0; Biome 0 diagnostics).
Status: **Task 0 evidence — produced before any source/manifest/test edit.** All line counts/symbols below were read from HEAD at 0.2.4 on 2026-08-15.

This document inventories the primitives the five 0.2.5 bullets touch, records what can be fixed with them, freezes the per-task approach, records a six-threat model, maps each threat to a concrete test in Tasks 1–5, and ratifies the owner/migration/budget/protected decisions. It is the gate Task 0 acceptance criteria require before Task 1 begins.

---

## 1. Primitive Inventory

### 1.1 Publish graph

`scripts/package-truth.json` (generated, 50 publishable manifests = root + 49 workspace — 14 provider + 9 `prism-*` + 26 capability). The graph is unchanged by 0.2.5 (no package added/removed, no export subpath added/removed). 43 code packages pin exact `@arnilo/prism: 0.2.4` peers; the 6 pure-manifest peerless packages are `prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, `prism-sdk`. Peer-version policy is the 0.2.4-ratified **Decision A** (exact pins through 0.2.x, widen to `^1.0.0` at 1.x, atomic-upgrade rule, ERESOLVE refusal) — 0.2.5 only advances the literal `0.2.4 → 0.2.5`; the policy is unchanged.

### 1.2 God-modules (the six 0.2.5 split targets)

| File | Lines | Dominant structure | Cohesive state machines / families |
|---|---|---|---|
| `src/agent-session.ts` | 2,049 | `RuntimeAgentSession` class spans **137–1787** (1,650 lines); `EventSubscriber` class 1787–1856; ~16 free functions 1856–2049 | run-setup · provider-turn · durable-suspension · tool-round/pending-decisions · persistence/ledger+subscribers · compaction · abort/usage/ids |
| `src/contracts-core.ts` | 1,719 | ~205 top-level exports (interfaces/types/classes/functions/consts); residue after the 0.1.4 split into `contracts-protocol.ts` (575 L) and `contracts-run-state.ts` (353 L) | content/messages · model/usage · run-limits · guardrails · prompt-cache · **session-search** (11 `HARD_MAX_*`/`DEFAULT_*` consts + 3 error classes + `resolveSessionSearchQuery`/`isSessionSearchUnsupported`/`isSessionMetadataConflict`/`isSessionAppendConflict`/`assertSessionMetadataKey`) · artifacts · checkpoints · leases · persistence · OAuth/credential · provider · realtime · compaction · extensions · instructions · skills · branches · run-feedback · retention · migrations |
| `packages/workflows/src/run.ts` | 1,227 | `runWorkflow`/`resumeWorkflow`/`suspend` public; `executeScheduler(·)`/`executeSchedulerBody`/`runNode`/`executeNode`/`createContext` private | scheduler · node-execution · checkpoint/persist · skip/conditional (skipTransitive/skipNode/releaseSuccessors/markRemaining/applyConditionalSkip) · validation (validateRunOptions/validateState/resolveMaxFanOut) · helpers (resolveTool/toAgentInput/isMessage/awaitSignal/cloneState/parseStateHistory) |
| `packages/server/src/handler.ts` | 1,005 | `createPrismHandler` public; routing/authorize/read* helpers; sse/json/errorResponse | request-routing (parseRoute/Route) · authorize/ownership (authorize/hasOwnership/sameOwnership) · session-create · request-readers (readJsonObject/readAgentInput/readAgentDecisions/readAgentResume/readResume/read*String) · sse-stream (sseAgentEvents/sse/sseStream) · response (json/errorResponse/addHeaders) · policy/signal (assertRequestPolicy/ownedSignal/awaitWithSignal) |
| `packages/coding-agent/src/repository.ts` | 974 | `createLocalRepositoryOperations` + the `Repository*` interfaces/types; `walkRepository`/`listLocal`/`searchFileLines`/`searchLocal`/`globLocal` private | types/limits · walk (walkRepository/shouldSkipName/kindFromDirent) · list · search (compileSearchPattern/searchFileLines/searchLocal) · glob (globLocal) · path-safety (toRepoRelative/isPathInsideRoot/resolveRepoPath) · abort/deadline (assertNotAborted/assertDeadline) · binary (isBinaryBuffer) |
| `packages/ag-ui/src/acp/agent.ts` | 836 | `createPrismAcpAgent` public (158–524, the big block); session/coding/permission/elicit helpers | lifecycle+create (createPrismAcpAgent/validateModeSeam/validateConfigOptionsSeam) · coding (buildAcpCoding) · session-registry (registerSession/sessionState/resolveSessionInputs/session/parseCursor/toSessionInfo) · forward/notify · permission/elicit/decision (permission/elicit/decisionForElicitation/decisionFor/ACP_OUTCOMES) · prompt (toPrismPrompt/truncate) · abort (abortOn) |

`src/agent-session.ts` method map (the 1,650-line class): public surface `restoreLoadedSkills`/`restoreLoadedSkillBodies`/constructor/`get leafId`/`subscribe`/`run`/`steer`/`resumeDurable`/`recordDurableResumption`/`recordDurableDenial`/`prompt`/`compact`/`abort`/`entries`/`checkout`/`fork`/`clone`; private `buildRunResult`/`matchNestedSticky`/`matchStickyDecision`/`buildPendingDecision`/`branchReader`/`resolveRunProvider`/`resolveRunSkills`/`emit`/`closeSubscribers`/`invalidateSnapshot`/`redactProviderRequest`. The ~830-line gap between `recordDurableDenial` (line 308 abs) and `prompt` (line ~967 abs) is the core provider-turn + tool-round loop — the single largest cohesive block and the primary split candidate. Free functions 1856–2049: `providerContent`/`reconstructMissingToolCalls`/`inputToMessages`/`messageTextBytes`/`SteerSoftInterrupt`/`isSteerSoftInterrupt`/`finalAssistantMessage`/`errorFromInfo`/`ProviderTurnFailure`/`mergeRetry`/`mergeCompaction`/`isDurableLoop`/`mergeGuardrails`/`withoutTrailingInput`/`stableMessageKey`/`bridgeAbort`/`throwIfAborted`/`throwIfAbortedSignal` (public)/`jsonBytes`/`createUsageAccumulator`/`randomId`.

### 1.3 `session-store-codecs` and the Postgres/SQLite duplication

`packages/session-store-codecs/src/index.ts` (426 lines, dependency-free) currently owns the **row-mapping codecs**: `RedactedCodec<R>`, `SessionEntryRow`, `RunRow`, `AgentEventRow<R>`, `ToolCallRow<R>`, `UsageRow`, `SessionRowMappers<R>`, `createSessionRowMappers<R>`. It is a **direct runtime dependency** (not merely a peer) of both adapters:
- `packages/session-store-postgres/package.json`: `dependencies: { "@arnilo/prism-session-store-codecs": "0.2.4", "pg": "^8.22.0" }`, `peerDependencies: { "@arnilo/prism": "0.2.4" }`.
- `packages/session-store-sqlite/package.json`: `dependencies: { "@arnilo/prism-session-store-codecs": "0.2.4", "better-sqlite3": "^12.11.1" }`, `peerDependencies: { "@arnilo/prism": "0.2.4" }`.
- `packages/session-store-codecs/package.json`: `dependencies: {}`, `peerDependencies: { "@arnilo/prism": "0.2.4" }`.

**→ No peer/dependency change is required by Task 2** (both adapters already depend on `session-store-codecs` at `0.2.4`; the bump advances the literal to `0.2.5` via `scripts/release.mjs bump`). The plan's "add a peer pin if missing" clause is **moot** — recorded as ratified decision D2 below.

Parallel Postgres (`packages/session-store-postgres/src/`, 2,515 total) and SQLite (`packages/session-store-sqlite/src/`, 2,398 total) files and the **confirmed duplicated mechanics**:

| Family | Duplicated symbols (present in both adapters, near-identical) | Extract to `session-store-codecs`? | Stays per-adapter |
|---|---|---|---|
| ownership | `assertOwnership` (checkpoints, leases, lifecycle), `assertSameOwnership` (lifecycle), `ownership` normalizer (lifecycle) | **yes** — pure ownership-scope assertion/normalization | `buildOwnershipFilters` SQL-fragment emission (Postgres builds `"... = $n"` parameterized; SQLite returns `string[]` + separate `ownershipParams`) — dialect-specific |
| cursor codecs | `decodeCursor` (checkpoints), `encodeBranchCursor`/`decodeBranchCursor` (persistence) | **yes** — pure encode/decode of integer offsets | — |
| checkpoint stale | `stale`/`staleExpected`/`staleFence`/`encodeJson`/`rowToRecord` shape (checkpoints) | **yes** — pure conflict helpers + row shape | the SQL `INSERT`/`SELECT`/version CAS per adapter |
| lifecycle shapes | `rowToHold`/`rowToQuota`/`assertReason`/`pageLimit` (lifecycle) | **yes** — pure row mappers + validators | retention/archive SQL per adapter |
| metadata parsing | `parseSessionMetadata`/`safeSearchMetadata`/`entrySearchFields`/`clipSearchSnippet` (persistence) | **yes** — pure parsers/clippers | FTS5 phrase (`fts5Phrase`, SQLite-only) stays per-adapter |
| schema/migration checks | `MIGRATION_CONTRACT = createPersistenceMigrationContract()` (migrations) **already shared** via `src/testing/persistence-schema.ts` (`@arnilo/prism/testing/persistence-schema`); `PersistenceSchemaShape*` types already there | **partially already shared** — Task 2 extracts any remaining pure check helpers; the contract + shape + assertions stay where they are | `listAppliedMigrations`/`backfillLegacyChecksums`/`readSchemaShape` are execution-shaped (Pool vs Database) — **stay per-adapter** |
| DDL | `ADAPTER_TABLE_NAMES`/`ADAPTER_INDEX_NAMES` (ddl) appear in both | **candidate** — extract if byte-identical (verify in Task 2) | the DDL string templates (`buildMigration00xDdl`/`MIGRATION_00x_*`) are dialect-specific — stay per-adapter |
| misc | `deepFreeze`/`parseStringArray`/`stringArray`/`throwIfAborted` (checkpoints/persistence/migrations) | **yes** — pure helpers | — |

`createPersistenceMigrationContract` and `PersistenceSchemaShape` already live in `src/testing/persistence-schema.ts` (line 787+) and both adapters import them. **The migration *contract* is already shared**; Task 2 does not re-extract it. Task 2's migration scope is limited to any remaining pure check helper not already in the testing module.

### 1.4 `Buffer.concat` accumulators (the three 0.2.5 perf sites)

| Site | Line | Pattern | Status |
|---|---|---|---|
| `packages/coding-agent/src/language/framing.ts` | 39 | `this.buf = Buffer.concat([this.buf, chunk])` inside `push(chunk)` (parse loop at 41 `for (;;)`) | **quadratic** — re-concats the whole buffer on every chunk; replace with chunk-array + retained counter + bounded single concat per parse |
| `packages/coding-security/src/sandbox-tar.ts` | 196 | `pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])` inside `for await (const chunk of stream)` (parse loop `while (true)` at 198) | **quadratic** — re-concats pending on every stream chunk; replace with chunk-array + sliding `subarray` window over pending bytes |
| `packages/work-tools/src/cli.ts` | 150/168 | `collectOutput(limit, onOverflow)` — chunk-array collector, one final `Buffer.concat(chunks, retained)` (plan 020 Task 3) | **already linear** — audit and keep; no change unless a residual site is found |

Bounds each site must retain: framing `maxMessageBytes` cap + overflow fail-closed; tar `bounds.maxBytes` + `SandboxTarError` + fail-closed tar-entry-type rejection (line 231); CLI `limit` + `onOverflow`. The 0.2.1 bounded-response-reader invariants (`packages/*` strict-completion + bounded body readers) are **not** on these three paths but are adjacent — Task 3 must not weaken them.

### 1.5 Dead-code tooling and current reports

Two existing zero-dependency scans (both `scripts/`, both wired into `npm test`):

- **`scripts/sweep-unused.mjs`** (plan 015 Task 3): runs `tsc --noEmit --noUnusedLocals --noUnusedParameters` over core + every workspace tsconfig, writes `scripts/unused-report.json` + `scripts/unused-sweep-report.txt`, **always exits 0** (report-only). Fresh run (2026-08-15): **44 tsconfigs, 5 diagnostics, ALL in test files**:
  - `src/__tests__/agent-config.types.test.ts(9-11)`: `_AgentConfigHasNoExtensions`/`_AgentConfigHasNoSettings`/`_AgentConfigHasNoCredentials` (TS6196 — intentionally-unused type assertions, `_`-prefixed).
  - `packages/browser/src/__tests__/evaluate.test.ts(13)`: `_mgr` (TS6133 — `_`-prefixed test placeholder).
  - `packages/provider-alibaba/src/__tests__/embeddings.test.ts(11)`: `_assignable` (TS6133 — `_`-prefixed).
  - **`agent-session.ts`, `cache-telemetry.ts`, `skill-load.ts` report ZERO unused locals.** The roadmap's named "stale `agent-session` imports/constants, `cache-telemetry` locals, `skill-load` map/scans" are **not currently detectable by `--noUnusedLocals`** — they are either already-cleaned, or refer to dead branches / redundant-but-technically-used scans (a deeper manual audit). Recorded as ratified decision D4a below.
- **`scripts/dead-exports.mjs`** (plan 015 Task 3, `ponytail:` naive regex scan): counts word-boundary references across all repo `*.ts`; reports symbols with ≤1 reference (definition-only). Fresh run: **62 dead-export candidates**. Full list (grouped):
  - **`src/` internal candidates**: `statusFromState` (agent-run-state.ts), `isInitProvider` (cli-init.ts), `SessionBranchHandle` (contracts-core.ts — a public contract type), `parseContextFile`/`parseToolFile`/`defaultUserConfigPath`/`loadConfigFiles`/`defaultUserSettingsPath`/`loadSettingsFiles` (node/*), `createJsonlSessionStore` (node/session-store-jsonl.ts), `resolveProviderMediaBlock` (providers/media.ts), `parseJsonObjectArguments` (providers/transport.ts).
  - **`src/testing/*` public conformance surface** (~15): `assertCompactionStrategyConforms`, `assertExtensionConforms`, `runFeedbackConformance`, `assertAdapterSchemaMatchesModel`, `assertParameterizedQuery`, `assertPersistenceQueryPaginationConforms`, `assertTenantScopedQueryIsolation`, `PARAMETERIZED_QUERY_GUIDANCE`, `tenantScopedUniqueKey`, `assertAbortIsObserved`, `assertNoSecretLeak`, `assertProviderOwnedHeadersWin`, `assertProviderStreamConforms`, `assertSerializedRequestCoversContent`, `assertToolCallDeltasReconstruct`, `ProviderSecretLeakConformanceOptions`, `runSessionStoreConformance`, `assertStateConcurrencyConforms`, `assertToolDispatchConforms`, `runToolEffectStoreConformance`. **These are the public `@arnilo/prism/testing/*` surface consumed by adapter conformance suites — allow-listed "public testing surface."** (The `dead-exports.mjs` regex cannot see cross-package `@arnilo/prism/testing/...` imports, hence the false positives — the `ponytail:` ceiling note on the script names exactly this.)
  - **`packages/coding-agent/`**: `codingSha256Hex` (coding-checkpoint.ts), `expandPath`/`resolveReadPath` (path-utils.ts), `truncateHead` (truncate.ts).
  - **`packages/coding-security/`**: `resolveUnderRoot` (sandbox-tar.ts).
  - **`packages/credentials-node/`**: `secureCompare`/`zeroBuffer` (envelope.ts), `assertRestrictiveFileMode`/`removeFileIfExists` (file-io.ts), `OidcIdentityVerifierResult` (oidc.ts).
  - **`packages/mcp/`**: `assertMcpContentWithinLimit` (content.ts).
  - **`packages/prism-caveman/`**: `writeCavemanConfig` (config.ts).
  - **`packages/prism-ponytail/`**: `PONYTAIL_PEER_RANGE` (upstream.ts).
  - **`packages/provider-neuralwatt/`**: `createNeuralWattProviderPackage` (index.ts).
  - **`packages/provider-openrouter/`**: `withOpenRouterCacheMarker` (cache.ts).
  - **`packages/server/`**: `createS3ArtifactBodyStore` (artifact-bodies.ts).
  - **`packages/session-store-postgres/` + `sqlite/`**: `PostgresPersistenceCloseOptions`/`SqlitePersistenceCloseOptions` (types.ts).
  - **`packages/supervisor/`**: `canonicalizeA2AAgentCard`/`signA2AAgentCard`/`verifyA2AAgentCard`/`createA2AClient`/`createA2AAgentEventSource`/`deliverA2APushEvent`/`createSupervisor`.
  - **`packages/workflows/`**: `assertOwnershipForLoad`/`assertOwnershipForSave`/`assertVersionAdvance`/`parseListOffsetCursor` (checkpoint-core.ts), `nodeKindOf` (util.ts).

### 1.6 Test / conformance / gate harnesses (reuse targets)

- `src/__tests__/public-export-contract.test.ts` (882 lines) — the frozen public-export surface snapshot; the compat gate.
- `scripts/compat-baseline/` — per-package `.d.ts` snapshots (`arnilo__prism-*.txt`, 44 files); `BASELINE_DIR` in `scripts/release-gates.mjs`; the release gate diffs built `.d.ts` against these. **Zero breaking deltas is the 0.2.5 contract.**
- `scripts/coverage-summary.mjs` + `scripts/coverage-thresholds.json` (plan 023 corrected denominator): core gate 60/70/75 (hard floor); recorded core 90.53/84.20/90.54; per-package baselines with `marginPp: 3`.
- `packages/session-store-postgres/src/__tests__/state-concurrency-conformance.integration.test.ts` + `packages/session-store-sqlite/src/__tests__/state-concurrency-conformance.test.ts` — the plan 022 cross-store conformance harness (memory + Postgres + SQLite). **The Task 2 before/after proof.**
- `src/__tests__/install-smoke.test.ts`, `scripts/benchmark-0.1.0.mjs`/`benchmark-0.1.0.test.mjs` (40 legs/scenarios), `scripts/budgets.json` (root packed 800042 / unpacked 2782640 / fileCount 326, 5% tolerance; aggregate 10%; startup importMsCeiling 250; benchmark medians 25% tolerance — `openai-hosted-continuation` p95 0.2907, `ai-sdk-v4-stream-mapping` p95 0.0734, `provider-package-metadata` p95 0.0394).
- `npm test` gate segment (from `package.json` scripts): `sweep-unused.test.mjs`, `phase*-freeze.test.mjs` (8–24), `benchmark-0.1.0.test.mjs`, `e2e-*-journey.test.mjs`, `phase23-quality-gates.test.mjs`, `phase24-truth.test.mjs`, `phase23-build-race.test.mjs`, then `npm run test --workspaces`. Task 3 appends `phase25-bounded-accumulation.test.mjs`; Task 6 appends nothing new (the bump reuses the existing segment).
- `security:threat-suites`, `test:postgres` (env-gated on `PRISM_TEST_POSTGRES_URL`), `sdk:ready`, `npm audit`, `git ls-files | scan-secrets.mjs`, `release:gate`, Node 20 packed imports — all reused as-is.
- `docs/_evidence/` is tarball-excluded (`package.json: "!docs/_evidence"`); this file and the Task 4 triage doc live there.

### 1.7 Precedents

- **`plans/016`** (0.1.4): split `agents.ts`/`contracts.ts` into cohesive modules behind barrel re-exports preserving the public import surface — the exact pattern for Task 1. (The `contracts-protocol.ts`/`contracts-run-state.ts` split already used this; `contracts-core.ts` is the remaining residue.)
- **`plans/020` Task 3**: `collectOutput` chunk-array collector in `work-tools/cli.ts` — the exact pattern for Task 3 framing/tar.
- **`plans/021`**: bounded response readers (strict completion, bounded bodies, byte caps, overflow fail-closed) — the invariants Task 3 must not weaken.
- **`plans/022`**: cross-store state-concurrency conformance (memory + Postgres + SQLite) — the Task 2 before/after proof harness.
- **`plans/023`**: corrected coverage denominator + `coverage-thresholds.json` baselines — the Task 5 floor.
- **`plans/015` Task 3**: `sweep-unused.mjs` + `dead-exports.mjs` — the Task 4 tooling.
- **`plans/024` Task 0/6**: primitive-review evidence-doc format + `release.mjs bump` + exit-gate sequence — the Task 0/6 template.

---

## 2. What Can Be Fixed + Approved Gaps + Rejected Approaches

**Approved (minimum reusable gaps):**
- (a) God-module splits into cohesive internal modules behind preserved public barrels (0.1.4 precedent; no new interface/factory).
- (b) Extraction of proven shared pure codecs/shapes/parsers/checks into the existing `session-store-codecs` (duplication proven in §1.3; package exists and is already a runtime dep of both adapters; no ORM/query builder).
- (c) Chunk-array / sliding-window replacement of the two remaining quadratic `Buffer.concat` accumulators (framing, tar); CLI capture audited and kept (020 `collectOutput` precedent).
- (d) Dead-code removal driven by `sweep-unused.mjs` + `dead-exports.mjs` + a reviewed allow-list (tools exist; no `knip`).
- (e) Focused runnable `node:test` regressions for low-coverage behavior (built in; no line-count padding; one regression per new branch/loop/parser/security path).

**Rejected (roadmap non-goals / ponytail ladder):**
- A generic ORM, query builder, SQL DSL, or shared SQL execution layer (roadmap: "no generic ORM/query builder or new runtime dependency").
- A shared SQL string-emission layer (DDL templates, `buildOwnershipFilters` fragments stay per-adapter — dialect-specific).
- A new runtime dependency anywhere (`knip`, AST-rewrite library, streaming framework, tar parser dep). `session-store-codecs` stays dependency-free; splits + `Buffer.concat` replacements use only `node:buffer`/`Uint8Array`/`TextEncoder`.
- A one-implementation interface or factory to "enable future splitting" (e.g. a `SessionPhase` interface with one impl) — speculative abstraction.
- A new published package, a new export subpath, or a public API removal without migration evidence (0.2.5 is additive-only).
- Re-extracting `createPersistenceMigrationContract`/`PersistenceSchemaShape` (already shared in `src/testing/persistence-schema.ts`).
- Any change that weakens the 0.2.1 bounded-reader invariants, the ownership/redaction/secret-scan controls, or the compat baseline (zero breaking deltas).

---

## 3. Frozen Decisions (per task)

### D1 — God-module split plan (Task 1)

Each god-module becomes a barrel over cohesive internal sibling modules; public exports stay on the same path.

- **`src/agent-session.ts`** → barrel re-exporting `createAgent`, `createAgentSession`, `RuntimeAgentSession`, `throwIfAbortedSignal`, and any other public symbol. Internal modules under `src/agent-session/`: `create-agent.ts`, `session.ts` (or split the class into `run-setup.ts`/`provider-turn.ts`/`durable-suspension.ts`/`tool-round.ts`/`persistence-ledger.ts` — Task 1 decides class-keep vs class-split; the 1,650-line class may stay in `session.ts` with phase helpers extracted, **but** the roadmap says "split by cohesive state machine" so at minimum the phase logic moves to siblings and `session.ts` coordinates), `event-subscriber.ts`, `provider-turn-helpers.ts` (the 1856–2049 free functions grouped: `providerContent`/`reconstructMissingToolCalls`/`inputToMessages`/`messageTextBytes`/`finalAssistantMessage`/`errorFromInfo`/`ProviderTurnFailure`/`mergeRetry`/`mergeCompaction`/`isDurableLoop`/`mergeGuardrails`/`withoutTrailingInput`/`stableMessageKey`/`bridgeAbort`/`throwIfAborted`/`jsonBytes`/`createUsageAccumulator`/`randomId`), `steer.ts` (`SteerSoftInterrupt`/`isSteerSoftInterrupt`). Target: no new module > ~600 lines without a recorded reason.
- **`src/contracts-core.ts`** → barrel; split residue by family into `src/contracts-core/*.ts`. Priority family: **session-search** (the 11 `HARD_MAX_*`/`DEFAULT_*` consts + 3 error classes + `resolveSessionSearchQuery`/`isSession*`/`assertSessionMetadataKey`) is a self-contained cluster → `contracts-core/session-search.ts`. Other families (content/messages, model/usage, run-limits, guardrails, prompt-cache, artifacts, checkpoints, leases, persistence, OAuth, provider, realtime, compaction, extensions, instructions, skills, branches, run-feedback, retention, migrations) grouped into a small number of cohesive modules. **Do not** re-move anything already in `contracts-protocol.ts`/`contracts-run-state.ts`.
- **`packages/workflows/src/run.ts`** → barrel; split into `run/scheduler.ts` (executeScheduler*), `run/node-execution.ts` (runNode/executeNode/createContext/resolveTool/toAgentInput/isMessage), `run/checkpoint.ts` (persistCheckpoint/isWorkflowSuspension/resultFromRecord/cloneState/parseStateHistory), `run/skip.ts` (applyConditionalSkip/skipTransitive/skipNode/releaseSuccessors/markRemaining), `run/validation.ts` (validateRunOptions/validateState/resolveMaxFanOut/awaitSignal). Public `runWorkflow`/`resumeWorkflow`/`suspend` stay on the barrel.
- **`packages/server/src/handler.ts`** → barrel; split into `handler/routing.ts` (parseRoute/Route/normalizeBasePath), `handler/authorize.ts` (authorize/hasOwnership/sameOwnership), `handler/readers.ts` (readJsonObject/readAgentInput/readAgentDecisions/readAgentResume/readResume/read*String/readPositiveInteger/readOptionalObject/readOptionalId/validId/readScheduleStatus/replayCursor), `handler/sse.ts` (sseAgentEvents/sse/sseStream), `handler/respond.ts` (json/errorResponse/addHeaders), `handler/policy.ts` (assertRequestPolicy/ownedSignal/awaitWithSignal). Public `createPrismHandler` stays on the barrel.
- **`packages/coding-agent/src/repository.ts`** → barrel; split into `repository/walk.ts` (walkRepository/shouldSkipName/kindFromDirent), `repository/list.ts` (listLocal), `repository/search.ts` (compileSearchPattern/searchFileLines/searchLocal), `repository/glob.ts` (globLocal), `repository/path.ts` (toRepoRelative/isPathInsideRoot/resolveRepoPath/assertNotAborted/assertDeadline), `repository/binary.ts` (isBinaryBuffer). Public `Repository*` types + `createLocalRepositoryOperations` + `resolveRepositoryLimits` + `RepositoryError` stay on the barrel.
- **`packages/ag-ui/src/acp/agent.ts`** → barrel; split into `agent/lifecycle.ts` (createPrismAcpAgent/validateModeSeam/validateConfigOptionsSeam), `agent/coding.ts` (buildAcpCoding), `agent/registry.ts` (registerSession/sessionState/resolveSessionInputs/session/parseCursor/toSessionInfo), `agent/forward.ts` (forward/notify), `agent/permission.ts` (permission/elicit/decisionForElicitation/decisionFor/ACP_OUTCOMES), `agent/prompt.ts` (toPrismPrompt/truncate), `agent/abort.ts` (abortOn). Public `createPrismAcpAgent` + the `Acp*` interfaces stay on the barrel.

**Constraint (all six):** no new public subpath in any `exports` map; internal modules are not re-exported publicly; `ponytail:` comments preserved verbatim on moved code; `public-export-contract.test.ts` + compat-baseline zero deltas after every extraction.

### D2 — Persistence-dedup scope (Task 2)

**Move to `session-store-codecs`** (pure, dependency-free helpers — additive to the existing row-mapper surface):
- ownership: `assertOwnership`, `assertSameOwnership`, ownership-scope normalizer.
- cursor codecs: `decodeCursor` (checkpoint), `encodeBranchCursor`/`decodeBranchCursor` (persistence).
- checkpoint stale: `stale`/`staleExpected`/`staleFence`/`encodeJson` + the `rowToRecord` shape helper.
- lifecycle shapes: `rowToHold`/`rowToQuota`/`assertReason`/`pageLimit`.
- metadata parsing: `parseSessionMetadata`/`safeSearchMetadata`/`entrySearchFields`/`clipSearchSnippet`.
- misc: `deepFreeze`/`parseStringArray`/`stringArray`/`throwIfAborted` (where duplicated).
- DDL constants `ADAPTER_TABLE_NAMES`/`ADAPTER_INDEX_NAMES` — extract **only if** byte-identical between adapters (verified in Task 2); else keep per-adapter.

**Stay per-adapter** (dialect/execution): `buildOwnershipFilters` SQL-fragment emission + `ownershipParams` (SQLite); all DDL string templates (`buildMigration00xDdl`/`MIGRATION_00x_*`); `listAppliedMigrations`/`backfillLegacyChecksums`/`readSchemaShape` (Pool vs Database); `fts5Phrase` (SQLite FTS5); connection/pooling; all query execution.

**Already shared (do not re-extract):** `createPersistenceMigrationContract`, `PersistenceSchemaShape*` in `src/testing/persistence-schema.ts`.

**No peer/dep change**: both adapters already depend on `@arnilo/prism-session-store-codecs: 0.2.4` (runtime dep); the bump advances the literal. `session-store-codecs` stays dependency-free. **Persisted shapes (checkpoints, leases, cursors, metadata, search rows) stay byte-identical** — cross-store conformance proves it before/after.

### D3 — `Buffer.concat` replacement scope (Task 3)

- **framing** (`language/framing.ts:39`): chunk-array + `retained` counter; append chunk unless over `maxMessageBytes` (overflow fail-closed, same error as 0.2.4); parse over a single bounded `Buffer.concat(chunks, retained)` per parse attempt (not per-push accumulation). Observable parsed values unchanged.
- **tar** (`sandbox-tar.ts:196`): chunk-array of stream chunks + retained window; advance the pending view by `subarray`; no whole-`pending` re-concat per chunk; retain `bounds.maxBytes` + `SandboxTarError` + fail-closed entry-type rejection. Observable entries + hash unchanged.
- **CLI** (`work-tools/cli.ts`): audit-only — `collectOutput` (line 150) is already linear; record the audit result; fix only if a residual quadratic site is found.
- **Probe** (`scripts/phase25-bounded-accumulation.test.mjs`): near-cap + over-cap inputs to framing + tar; assert linear copying (time scales linearly with chunk count, measured), bounded peak memory (retained ≤ cap), overflow fail-closed (over-cap aborts, no partial output). Wired into the `npm test` gate segment.

### D4 — Dead-code scope (Task 4)

- **D4a (named internals — audit, likely no-op):** `sweep-unused.mjs` reports **zero** unused locals in `agent-session.ts`, `cache-telemetry.ts`, `skill-load.ts` at 0.2.4 (the only 5 diagnostics are `_`-prefixed test placeholders). Task 4 (1) re-runs the sweep to confirm, (2) does a targeted manual audit of those three modules for dead branches / redundant-but-used scans (e.g. a `.map()` whose result is only partially read, a constant imported only by a dead branch), (3) removes anything confirmed dead, (4) records the rest on the allow-list with the reason "audit-clean at 0.2.4; no dead code found." If the audit finds nothing, the named-internal-cleanup is a **recorded no-op** — not a failure (the roadmap named candidates; the sweep proves they are already gone or were never there).
- **D4b (dead-exports triage):** the 62 `dead-exports.mjs` candidates → remove or allow-list-with-reason in `docs/_evidence/phase25-dead-exports-triage.md`. Default allow-list reasons: "public `@arnilo/prism/testing/*` surface consumed by adapter conformance suites" (the ~15 `src/testing/*` helpers — false positives of the regex scan per its `ponytail:` note); "public contract type" (`SessionBranchHandle`); "public package surface exported for host/adapter use" (supervisor a2a-*, `createS3ArtifactBodyStore`, `createSupervisor`, `createNeuralWattProviderPackage`, `withOpenRouterCacheMarker`, `writeCavemanConfig`, `PONYTAIL_PEER_RANGE`, `Postgres/SqlitePersistenceCloseOptions`); "internal helper, retained — referenced dynamically or by string-built name" (the `ponytail:` ceiling on the scan). A candidate is **removed** only when a deeper reference search (grep across all `*.ts` incl. `__tests__` + a string-reference check) confirms definition-only. **No public export is removed without `docs/migration.md` `0.2.4 → 0.2.5` evidence + a compat-baseline delta** — 0.2.5 is additive-only; any public removal halts the release pending an amendment. **Expected outcome: zero public removals; internal removals only where confirmed.**
- **Preserve:** intentionally-public exports, documented `ponytail:` shortcut ceilings (roadmap: "`ponytail:` comments are intentional shortcuts, not dead code; keep"), and any symbol that is a security guard at a trust boundary (allow-listed "security guard, retained").

### D5 — Coverage-close scope (Task 5)

Named low-coverage areas + the specific branches/loops/paths each new runnable regression covers (behavior, not line count):
- **conversations**: create/branch/archive/delete/retention + the plan 022 concurrent races (branch+branch, branch+archive, duplicate create, delete/retention/legal-hold) at the behavior level (assert valid state preserved or explicit conflict returned; no archive resurrection).
- **artifacts**: create/update/body-store/retention/legal-hold (assert body-store round-trip, retention enforcement, legal-hold blocks delete).
- **approval**: pending-decision/approve/deny/timeout/legacy-migration (assert timeout denies, deny is terminal, legacy migration path stays green — the 0.2.0 resume-decision invariants at the behavior level).
- **compaction**: observational-memory + llm strategies + the weak branches (fact retention, strategy selection, the `toolResultFold`-off default).
- **weak conformance-helper branches**: the under-covered branches in `src/testing/*-conformance.ts` (provider/session-store/state-concurrency/tool/tool-effect-store/compaction/extension/feedback) — assert each helper catches the violation it is named for.

**Floor:** core ≥ 90.53/84.20/90.54 (lines/branches/functions); per-package above `scripts/coverage-thresholds.json` baselines with `marginPp: 3`. A threshold drop fails the gate. One runnable `node:test` regression per new branch/loop/parser/security path; no line-count padding.

### D6 — Budget / performance / docs (Task 6)

- 50-package graph unchanged; no new runtime dependency; no `exports`/`files` change except the additive `session-store-codecs` helpers (already a runtime dep).
- Expected packed delta: neutral-to-negative (code moves between files inside the same packages; `session-store-codecs` grows, adapters shrink by ~the same; `agent-session.ts` shrinks but new internal files add — net ~zero within `@arnilo/prism`). Re-baseline `scripts/budgets.json` only if measured outside the 5%/10% tolerance, with a dated `$comment`.
- Hot-path: framing/tar **improve** (quadratic → linear); splits/dedup not on the provider hot path. Frozen p95 ceilings in `budgets.json` (`openai-hosted-continuation` 0.2907, `ai-sdk-v4-stream-mapping` 0.0734, `provider-package-metadata` 0.0394, 25% tolerance) must not regress. Tree-shaking: measured bundle-size or export-reach delta recorded; improvement expected, regression fails.
- Bump: `node scripts/release.mjs bump --from 0.2.4 --to 0.2.5` (exact peers per Decision A); regenerate + assert `scripts/package-truth.json` (50 packages, counts unchanged); zero breaking compat deltas; `docs/release-and-install.md` 0.2.5 section; `docs/migration.md` `0.2.4 → 0.2.5` note **only if** D4b confirms a public removal (expected: "no runtime contract delta; internal-only maintainability release"); `docs/0.1.0-readiness.md` current-line → 0.2.5; roadmap 0.2.5 checkboxes after gates pass.
- Protected evidence: `test:postgres` incl. the Task 2 cross-store conformance legs (env-gated on `PRISM_TEST_POSTGRES_URL`, blocked-visible else per the 0.2.3 skip manifest); the Task 3 near-limit probe; `security:threat-suites`; `sdk:ready`; `audit`; `secret-scan`; pack-dry-run-twice-byte-identical; Node 20 packed imports.

---

## 4. Threat Model (T1–T6)

| ID | Threat | Actor | Asset | Entry point | Trust boundary | Mitigation | Test mapping |
|---|---|---|---|---|---|---|---|
| T1 | Compat-silent break: a split changes a public export shape and ships undetected | maintainer (honest mistake) | public `.d.ts` of `@arnilo/prism` + affected workspace packages | any Task 1 extraction | public import surface / consumers | `public-export-contract.test.ts` (frozen snapshot) + `scripts/compat-baseline/` zero-delta diff + `.d.ts` byte-identity (built vs snapshot, modulo version literal); run after every extraction; unexpected delta halts the release | Task 1: "public surface unchanged" + "compat baseline zero deltas" |
| T2 | Semantics-silent dedup: a moved codec changes a cursor/metadata/checkpoint shape and corrupts durable state | maintainer | persisted shapes (checkpoints, leases, cursors, metadata, search rows) | a Task 2 extraction into `session-store-codecs` | durable state / cross-tenant isolation | cross-store conformance (plan 022 harness) before/after + byte-identical persisted-shape snapshot; ownership-filter extraction proven by tenant-isolation cases; no SQL emission moves | Task 2: "cross-store conformance unchanged" + "persisted shapes byte-identical" + "ownership preserved" |
| T3 | Bounds-silent regression: a `Buffer.concat` replacement weakens the byte cap or overflow-abort | maintainer | the 0.2.1 bounded-reader invariants (byte caps, overflow fail-closed) | a Task 3 framing/tar rewrite | trust boundary for unbounded buffering | near-limit + overflow-fail-closed probe (linear copying, bounded peak memory, over-cap aborts with existing error, no partial output); existing framing/tar tests assert observable output unchanged | Task 3: "linear copying" + "bounded peak memory" + "overflow fail-closed" |
| T4 | Dead-export false removal: a "dead" public export is removed and breaks a consumer | maintainer | public package surface / third-party adapters | a Task 4 removal | public API / consumers | reviewed allow-list + migration-evidence requirement for any public removal; deeper reference search (grep + string-built name check) before removal; `public-export-contract.test.ts` catches a removed public export; 0.2.5 additive-only → any public removal halts the release | Task 4: "no public removal without migration" + "post-removal scan clean" |
| T5 | Coverage-as-padding: tests chase line count not behavior | maintainer | the coverage floor as a quality contract | a Task 5 test addition | test-suite honesty | one-runnable-regression-per-branch rule; behavior-named test cases (assert observable outcomes, not private state/call counts); threshold floor enforced (a drop fails) | Task 5: "behavior-backed" + "coverage gate" |
| T6 | Tree-shaking / benchmark regression: a split moves code in a way that grows a bundle or regresses a p95 | maintainer | frozen budget/benchmark ceilings | a Task 1 split or Task 2 dedup | release budget | measured tree-shaking delta + the frozen `budgets.json` p95 ceilings (25% tolerance) + pack-dry-run-twice-byte-identical; regression fails the gate | Task 1: "hot-path benchmarks do not regress" + "tree-shaking delta measured"; Task 6: "measurement recorded" |

---

## 5. Owner / Migration / Budget / Protected Matrix

| Item | Owner | Migration | Rollback | Budget | Protected env |
|---|---|---|---|---|---|
| Task 1 splits | `src/` + per-package maintainers | none (barrel-preserving; `.d.ts` byte-identical) | restore 0.2.4 monolithic files | neutral-to-negative packed; tree-shaking measured | none |
| Task 2 dedup | `session-store-codecs` + adapter maintainers | none (persisted shapes byte-identical; cross-store conformance) | restore 0.2.4 duplicated code | `session-store-codecs` grows, adapters shrink ~same | `PRISM_TEST_POSTGRES_URL` (cross-store conformance legs) |
| Task 3 perf | `coding-agent` (framing) + `coding-security` (tar) maintainers | none (observable output + caps unchanged) | restore 0.2.4 quadratic accumulators | framing/tar improve; no benchmark regression | none |
| Task 4 dead-code | `sweep-unused`/`dead-exports` maintainers + module maintainers | none for internal; migration note only if a public removal (expected none) | restore 0.2.4 dead code | neutral-to-positive (smaller parse) | none |
| Task 5 coverage | `src/__tests__` + per-package `__tests__` maintainers | none (additive tests) | restore 0.2.4 (removes tests) | coverage rises; floor enforced | none |
| Task 6 bump/exit | release owner (`arn`) | `0.2.4 → 0.2.5` version literal (exact peers, Decision A) | restore 0.2.4 literals | 50 packages; counts unchanged | `PRISM_TEST_POSTGRES_URL` (cross-store + postgres legs) |

**Overall:** zero breaking compat deltas; no new runtime dependency; no new package; no public API removal (expected). Signed `v0.2.5` tag + npm OIDC publication remain operator-gated after clean protected CI (same as 0.2.0–0.2.4).

---

## 6. Test Mapping (threat → Task test)

- **T1** → Task 1: `public-export-contract.test.ts` green; compat-baseline zero deltas; `.d.ts` byte-identity (built vs snapshot modulo version literal); typecheck green after every extraction.
- **T2** → Task 2: `state-concurrency-conformance.integration.test.ts` (Postgres) + `state-concurrency-conformance.test.ts` (SQLite) green before/after; persisted-shape snapshot byte-identical; tenant-isolation cases green (no cross-tenant leak after shared ownership helper).
- **T3** → Task 3: `scripts/phase25-bounded-accumulation.test.mjs` (linear copying, bounded peak memory, overflow fail-closed); existing framing/tar tests green (observable output unchanged).
- **T4** → Task 4: `docs/_evidence/phase25-dead-exports-triage.md` complete (every candidate remove or allow-list-with-reason); post-removal `dead-exports.mjs` clean or only allow-listed; `docs/migration.md` note present only if a public removal (else "no runtime contract delta"); `sweep-unused.mjs` clean or only `_`-prefixed test placeholders; full `npm test` green.
- **T5** → Task 5: core ≥ 90.53/84.20/90.54 + per-package above `coverage-thresholds.json` baselines (3pp margin); behavior-named test cases; a threshold drop fails the gate.
- **T6** → Task 1 + Task 6: `benchmark-0.1.0.test.mjs` + `budget-gate.test.mjs` green (frozen p95 ceilings); tree-shaking delta recorded; pack-dry-run-twice-byte-identical; `release:gate` 0.2.5 / 50 packages / 0 breaking deltas.

---

## 7. Decisions Ratified

1. **D1** — God-module splits are cohesive-internal-modules-behind-preserved-barrels (0.1.4 precedent); no one-implementation interface/factory; per-module target ≤ ~600 lines; `ponytail:` comments preserved verbatim.
2. **D2** — Persistence dedup moves only pure codecs/shapes/parsers/checks into the existing `session-store-codecs` (already a runtime dep of both adapters — no peer/dep change); SQL dialect/execution + DDL templates + `buildOwnershipFilters` fragments stay per-adapter; `createPersistenceMigrationContract`/`PersistenceSchemaShape` already shared — not re-extracted; persisted shapes byte-identical; no ORM/query builder/SQL DSL.
3. **D3** — framing + tar linearized (chunk-array / sliding window); CLI audited and kept; near-limit probe wired into `npm test`; 0.2.1 bounded-reader invariants retained.
4. **D4a** — named stale internals (`agent-session`/`cache-telemetry`/`skill-load`) audited via `sweep-unused.mjs` + manual review; **already clean at 0.2.4** (zero unused locals in those modules); recorded no-op if the manual audit confirms.
5. **D4b** — 62 dead-export candidates triaged remove/allow-list; `src/testing/*` helpers allow-listed "public testing surface" (regex false positives per the script's `ponytail:` note); no public removal without migration evidence; expected zero public removals.
6. **D5** — coverage close is behavior-backed; one runnable regression per new branch/loop/parser/security path; core ≥ 90.53/84.20/90.54; per-package above baselines (3pp margin); no line-count padding.
7. **D6** — 50-package graph unchanged; zero new runtime deps; zero breaking compat deltas; bump `0.2.4 → 0.2.5` (exact peers, Decision A); `package-truth.json` regenerated + asserted; `test:postgres` incl. cross-store conformance is the protected evidence; signed tag/OIDC operator-gated.
8. **No new code-wiki task** — `.agents/skills/project-wiki/` does not exist (same as 0.2.0–0.2.4).
9. **Fail-closed posture** — a compat break (T1), a semantics change (T2), a bounds regression (T3), a false public removal (T4), a coverage drop (T5), or a benchmark/budget regression (T6) blocks the 0.2.5 gate; nothing is skipped silently; protected evidence is present or blocked-visible per the 0.2.3 skip manifest.

All ratifications are asserted by the Tasks 1–5 test mapping in §6. Task 0 is complete; Task 1 may begin.