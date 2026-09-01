# Migration guide

## 0.3.3 → 0.4.0 package reorganization (breaking)

Prism 0.4 consolidates package names into explicit family subpaths. It is a dependency and import-specifier migration, not a persisted-data migration. See the complete [legacy 0.3 → 0.4 guide](migrate-to-0.4.md) for all 54 retired package mappings, profile replacements, optional peers/host binaries, security checks, rollback, and npm legacy-warning behavior.

## 0.3.1 → 0.3.2: bounded workflow loop durability (additive, no migration)

`@arnilo/prism-workflows@0.3.2` adds the bounded `loopNode` durable extension. It adds optional `WorkflowNodeCheckpoint.iterations` records, each carrying `schemaVersion: 1`, a zero-based `iteration`, stable `iterationId`, and bounded/redacted output. Existing `WorkflowCheckpointValue.schemaVersion` remains `1`; older checkpoints without `iterations` remain readable through the legacy `iteration`/`lastOutput` cursor, and older hosts ignore the additive field. No SQL or generic checkpoint-store migration is required. Replay creates a new run and never mutates source iteration evidence. Hosts using saga compensation keep one saga step/aggregate and register per-iteration compensation by `iterationId` in reverse order.

This independent package patch freezes budget accounting: `maxNodes` counts declared DAG nodes once, while loop body executions consume only the required hard-capped `maxIterations` budget. Rollback is package-version rollback; no persisted migration is needed.

## 0.3.2 → 0.3.3: run-ledger prompt provenance (additive, schema version 9)

Plan 042 adds an optional typed `promptVersion` ref (`{ name, version, hash }`) to `RunOptions` and `RunRecord`. Hosts resolve a prompt from `@arnilo/prism-prompts` and stamp the run: the ref is copied onto the start/finish ledger records and persisted by the first-party SQLite/PostgreSQL stores as a nullable `prompt_version` JSON column (shared schema migration `009_run_prompt_version`, schema version 8 → 9, forward-only and applied automatically by the adapters' checksummed `prism_migrations`). Strictly additive: unset `promptVersion` produces byte-identical rows and records, legacy rows read back without the field, and no exported declaration was removed. The ref carries identity only (`sha256:` body hash) — prompt bodies stay in the separate `@arnilo/prism-prompts` tables and out of run rows, metadata, and telemetry.

## 0.3.2 → 0.3.3: tool progressive disclosure (additive, no migration)

Plan 041 adds opt-in progressive tool loading to `@arnilo/prism`: `toolsDisclosure` (default `"all"`, byte-identical to previous releases) and `toolsSearch.topK` on `AgentConfig` / `RunOptions`, plus the generated `search_tools` tool in search mode. Strictly additive — no exported declaration removed, no persisted shape repurposed. Durable run state gains an optional `sessionState.activatedToolNames` (names only, capped at 128); stores that ignore it resume exactly as before. Set nothing and behavior is unchanged; see [Tools](tools.md#tool-disclosure-progressive-tool-loading).

## 0.3.1 → 0.3.2 memory package: composite recall scoring (additive, no migration)

`@arnilo/prism-memory@0.3.2` adds opt-in `RecallOptions.scoring`: sum-normalized similarity/recency/importance blending, with a positive `halfLifeMs` required only when `recencyWeight > 0`. Default recall (no `scoring`) keeps its existing ordering and query count. `MemoryVectorRecord.importance?` persists through an additive nullable `importance REAL` column (`ADD COLUMN IF NOT EXISTS`); legacy NULL rows score neutral `1.0`, so no re-index or data migration is required. At write, hosts may pass a clamped `[0,1]` `entry.importance` or an `importanceFrom` hook over a redacted reflection; it runs once at write, never at recall. Rollback is package-version rollback only: old readers ignore the nullable column, and new readers treat absent values neutrally.

## 0.3.0 → 0.3.1 production RAG engine (independent patch)

Only `@arnilo/prism-rag`, `@arnilo/prism-memory`, and `@arnilo/prism-observability-opentelemetry` move to `0.3.1`. Keep every other first-party package on `^0.3.0` — those ranges already satisfy `0.3.1`.

**Required for Embedder implementers.** `Embedder.id` is now a required `readonly id: string` (stable model/deploy identity, ≤256 chars). Hosts that construct their own embedder must set it; `createHashEmbedder` defaults to `"prism-hash-embedder"` and the Alibaba embedder uses `options.model`. `retrieveContext` fails closed with `ERR_PRISM_RAG_EMBEDDER_MISMATCH` when a stored `embedderId` is missing or differs (or dimensions differ). Re-index the source after an embedder/model change. Existing 0.3.0 rows without `embedderId` also fail closed until re-indexed.

Everything else is additive and opt-in: `createPostgresVectorStore`, hybrid `lexical` retrieve, `contentHash` skip, heading metadata, generation pointers, `createRagTelemetry`, `createTeiReranker`, multi-scope retrieve (`scopes` — pass `scope` for one corpus or `scopes` for one-or-many exact corpora; `scope` stays valid, both or neither throws). Default `retrieveContext` / `replaceSource` paths without those options stay 0.3.0-compatible (vector-only, single-scope, no skip, no telemetry).

Postgres DDL is additive (`IF NOT EXISTS` columns/indexes/tables). 0.3.0 rows remain readable. Rollback = restore the 0.3.0 package versions; no down migration.

## 0.2.9 → 0.3.0 lockstep cut and independent package versions (additive)

Release **0.3.0** is the final lockstep cut on the 0.3.x line: all 57 publishable manifests move from `0.2.9` to `0.3.0`, then internal first-party `dependencies`, `optionalDependencies`, and `peerDependencies` use `^0.3.0`. The package graph is now **Decision B**: changed packages may patch/minor independently inside `>=0.3.0 <0.4.0`; unchanged packages keep their version.

- **Release commands:** default `release.mjs check`, `publish`, and `gate` are independent. Use `--lockstep --version 0.3.0` only for the final cut or the one emergency lockstep train. Later publication tags are `@arnilo/<package>@<version>`; a generic `v*` tag does not publish the monorepo.
- **Consumer installs:** keep first-party peers inside `^0.3.0`. A package at `0.3.1` can be installed with other unchanged `0.3.0` packages; a `0.4.0` package requires the next coordinated peer-range cut.
- **New optional packages:**
  - `@arnilo/prism-antigravity-agent` delegates autonomous coding sessions to the official `agy` CLI with per-run loopback MCP capability exposure, AG-UI timeline projection, and `--conversation` continuation; host owns binary and `agy login` authentication state; omitted from umbrellas.
  - `@arnilo/prism-computer-use-linux` wraps a host-owned Linux `computer-use-linux` MCP binary. It is Linux-only, deny-by-default through `DeviceAdapter`, outside umbrella profiles, and never auto-connects on import.
- **Coding/ACP closeouts:** `read.findText`, visible fuzzy edit matches/miss context, ACP editor-buffer filesystem operations, spawnable per-session coding registries, and delete/move result locations are additive and require no store migration. Client filesystem mode remains text-only: image/document reads fail closed and never fall back to host disk.

No persisted store migration. Before publication, rollback by restoring the 0.2.9 manifests/tag. After publication, roll forward with an additive 0.3.x package patch; npm unpublish is not a rollback strategy.

## 0.2.8 → 0.2.9 provider adoption and behavior packages (additive)

Release **0.2.9** (plan 029) adds three provider packages, SuperGrok device-code OAuth, `@arnilo/prism-impeccable`, Ponytail 4.9.0 empty-args status, and Caveman v2.1 extra skills. **Additive-only: no exported declaration removed, no persisted 0.2.8 shape repurposed.**

- Install `@arnilo/prism-provider-deepseek`, `@arnilo/prism-provider-xai`, or `@arnilo/prism-provider-clinepass` (or `@arnilo/prism-providers`) for the new adapters. SuperGrok login is host-invoked RFC 8628 at `auth.x.ai`; no `XAI_API_KEY` required when OAuth credentials are stored.
- Bare `/ponytail` now reports current+default mode and does not change mode. Use `/ponytail lite|full|ultra|off` to set mode.
- Caveman still requires the original seven skills; extra `skills/*/SKILL.md` register. Caveman 2 engine is not a Prism runtime.
- `@arnilo/prism-impeccable` needs `upstreamPath` to a compiled `SKILL.md`. Not in `prism-all`.

No store migration. Rollback = restore the 0.2.8 manifests/tag.

## 0.2.7 → 0.2.8 ACP adoption fixes (additive)

Release **0.2.8** (plan 028) tightens ACP coding-host interop and adds the spawnable `@arnilo/prism-acp-agent` entrypoint. **Additive-only: no exported declaration removed or changed, no persisted 0.2.7 shape repurposed.**

Hosts that already speak ACP should re-check these wire behaviors (deny-by-default unchanged unless a new seam is wired):

- `usage_update` is omitted when the host cannot report a context window (never `size = used`).
- A terminal run `error` rejects `session/prompt` with `ERR_PRISM_ACP_RUN` instead of an `Agent error:` transcript chunk.
- Only boolean config options are advertised; `set_config_option` on a select option fails `ERR_PRISM_ACP_CAPABILITY`.
- Permission option kinds on the wire are `allow_once` / `allow_always` / `reject_once` / `reject_always`.
- New optional seams (`sessions.transcript`, `sessions.title`, `commands.list`, `capabilities.usage.contextWindow`, `createCodingToolProjection`, image `toolResult`) emit nothing when unwired.

No store migration. Rollback = restore the 0.2.7 manifests/tag. The added exports and `@arnilo/prism-acp-agent` simply disappear.

## 0.2.6 → 0.2.7 enterprise ERP production readiness (additive)

Release **0.2.7** (plan 027) adds the enterprise ERP production-readiness primitives behind optional host-activated seams: the transactional outbox/inbox + bounded dispatcher, the durable saga compensation/reconciliation engine, multi-party separation-of-duties approvals, signed hash-chained audit export with WORM/SIEM sinks, field-level classification + fail-closed redaction, and the deterministic ERP invariant evals. **Additive-only: no exported declaration removed or changed, no persisted 0.2.6 shape repurposed.**

New ERP tables use **separate forward-only migrations** (no down migrations exist; production rollback is roll-forward repair only):

- `prism_erp_outbox` / `prism_erp_inbox` (migration `004_erp_messaging`, version 4) — transactional outbox/inbox with `FOR UPDATE SKIP LOCKED` claim, `ON CONFLICT DO NOTHING` idempotent append, claim-token CAS, and three partial indexes. Outbox append must run in the caller-owned `PoolClient` transaction with the business mutation (atomicity is the host's responsibility).
- `prism_erp_approvals` (migration `005_erp_approvals`, version 5) — multi-party approval requests with decisions stored as JSONB, `FOR UPDATE` row locking for atomic quorum recomputation, rejection as any-party veto, expiry checked at every protected transition, and atomic grant consumption in the host transaction.

Saga state persists as a surrogate `WorkflowCheckpointRecord` through the existing `WorkflowCheckpointAdapter` (private workflow id `__prism_saga__/<key>`) — no saga-specific SQL or 0.2.6 shape is repurposed. Audit export, field policy, and ERP invariant evals are stateless or in-memory and add no persisted shape. Secret-manager adapters (Vault/AWS/Azure/GCP) stay **deferred** behind the demand gate; no adapter ships and no ambient credential discovery is added.

**Rollback notes.** Rollback = restore the 0.2.6 manifests/tag. The two new ERP migrations are forward-only; before downgrading, stop all 0.2.7 workers (outbox dispatcher, saga engine, audit exporter) and drop or ignore the `prism_erp_outbox`/`prism_erp_inbox`/`prism_erp_approvals` tables (they hold no 0.2.6 data). No 0.2.6 persisted shape changed, so an ordinary downgrade is store-safe; the added exports and ERP tables simply disappear. **"ERP production ready" remains blocked until the 0.3.0 live-service matrix is recorded** — this release adds the primitives and the protected journey evidence, not the live-service matrix.

## 0.2.5 → 0.2.6 durable recovery, workspaces, and coding-agent readiness (additive)

Release **0.2.6** (plan 026) adds the coding-agent readiness capabilities behind optional host-activated seams: host-selected PTY backends, the indexed/semantic repository-search seam, the ownership-scoped multi-repository/worktree lifecycle, durable process/ACP recovery, and the patch-review/diagnostics workflow. **Additive-only: no exported declaration removed or changed, no persisted 0.2.5 shape repurposed.**

New durable records use **separate versioned checkpoint namespaces**, never the 0.2.5 shapes:

- `prism.coding-agent.process.v1` (schemaVersion 1) — managed-process recovery records. Readers reject unknown schema versions and corrupt/foreign records fail closed (dropped, never recovered).
- `prism.coding-agent.workspace.v1` (schemaVersion 1) — coding workspace lifecycle records.
- `prism.coding-agent.cancel.v1` (schemaVersion 1) — durable ACP run-cancel markers.

`CodingCheckpointMetadata` (schemaVersion 1, `prism.coding-agent`) is **never silently repurposed**; 0.2.5 readers reject unknown schema versions as before.

**ACP active-run references (Task 5 decision: additive optional field).** `PersistedAcpSession` gains an optional bounded `activeRun` ref (frozen 512-byte cap) recorded while a durable run is live. The decision recorded here: an additive optional field, not a separate recovery namespace, because the ref is advisory metadata — the authoritative run status is always re-queried from `AgentRunLifecycle.status` at restore time, and 0.2.5 hosts safely ignore the field. `PersistedAcpSession.activeRun` stays optional; 0.2.5 records remain readable and a 0.2.5 host reading a 0.2.6 record does not lose required recovery state (the run state itself lives in the existing `prism.agent-run` records, which are untouched).

**Downgrade to 0.2.5** is safe only after stopping 0.2.6 workers/replicas and marking any live 0.2.6 process/workspace records `unknown` (their leases expire within TTL); durable state never serializes a PTY fd, browser context, process object, controller, pending promise, raw terminal output, env, token, or credential, and no exact-process-survival claim is made (attach-if-attested, otherwise unknown).

## 0.2.4 → 0.2.5 maintainability and bounded performance (no migration)

Release **0.2.5** (plan 025) is the maintainability-and-bounded-performance cut: the six remaining implementation god-modules split into cohesive internal family files behind preserved barrels (compat-preserving, no `exports`-map subpath), 21 pure persistence helpers moved into the dependency-free `session-store-codecs` package (ownership scope/assertion, checkpoint stale/encode/decode, branch cursors, lifecycle quota/reason/page-limit, search metadata/clipping, deepFreeze/string-array/throwIfAborted, feedback row mapping), the quadratic per-push `Buffer.concat` loops in language framing and tar parsing became chunk-array readers (linear; caps and fail-closed overflow byte-identical), two internal dead type aliases removed (`PostgresPersistenceCloseOptions`, `SqlitePersistenceCloseOptions` — never re-exported from their adapter indexes), and 76 behavior-backed coverage regressions closed the low-coverage core areas (core 91.43/84.80/91.60 lines/branches/functions). **No runtime contract change and no migration**: no exported declaration was removed or changed (the plain reviewed compat gate at 0.2.5 shows the version literal plus 105 additive internal-helper exports), no persisted shape/schema/default/behavior changed, no new runtime dependency. Store compatibility with 0.2.4: **compatible in both directions** — no migration step; rollback = restore the 0.2.4 manifests/tag (stores never change; the added exports disappear on downgrade). The 20 dead-but-compat-tracked exports deferred from Task 4 are the 0.3.0 breaking-cut removal list (see `docs/_evidence/phase25-dead-exports-triage.md`).

## 0.2.3 → 0.2.4 package, documentation, and compatibility truth (plan 024)

Release **0.2.4** (plan 024) is the package-documentation-and-compatibility-truth cut: umbrella wording now states the manifest closures (`@arnilo/prism-providers` = 11 of 14 first-party provider adapters, omitting Azure/Bedrock/Vertex; `@arnilo/prism-all` = 20 direct / 43 transitive first-party packages with the named omission set), and `scripts/package-truth.json` (generated by `scripts/package-truth.mjs`) is the manifest-derived single source for counts, provider membership, umbrella closures, and profile closures. **Peer-version policy (Decision A — exact pins):** every code package peers the bare exact `@arnilo/prism@0.2.4` version (no range, no `*`); all `@arnilo/prism-*` packages move at the same version (**atomic-upgrade rule** — a partial upgrade fails clearly at install time with npm `ERESOLVE` naming the conflicting peer); the range widens to `^1.0.0` at the 1.x stable release; third-party `@arnilo/prism-*` adapters peer on the documented exact current version (full policy in the release-and-install Extension notes). **No runtime code path, persisted shape, event schema, default, or exported declaration changed** (the plain reviewed compat gate at 0.2.4 shows the version literal only). Store compatibility with 0.2.3: **compatible in both directions** — no migration step; rollback = restore the 0.2.3 manifests/tag.

## 0.2.2 → 0.2.3 build, coverage, and release evidence integrity (no migration)

Release **0.2.3** (plan 023) is a **tooling-and-evidence-only cut**: build serialization (`scripts/with-build-lock.mjs` — one `O_EXCL` lockfile serializing every emit/test leaf so concurrent compilers never expose a partial live `dist/`), corrected workspace coverage denominators (package-local `--test-coverage-include=dist/**`, evidence-based per-package thresholds with `protectedException` durable-leg rows), the machine-auditable release skip manifest (`scripts/release-skip-manifest.mjs` → `scripts/release-evidence.json` with `pass`/`skip`/`blocked`/`protected` states; required surfaces without evidence record `blocked` and fail the release gate), and stabilized quality gates (Biome 2.x `preset` config migration with zero lint diagnostics, deterministic timing-assertion barriers, machine-readable `lint-report.sarif` + `unused-report.json`). **No runtime code path, persisted shape, event schema, default, or exported declaration changed** (the plain compat gate at 0.2.3 shows the version literal only). Store compatibility with 0.2.2: **compatible in both directions** — no migration step; rollback = restore the 0.2.2 manifests/tag (stores never change; rollback reopens only the partial-`dist` race and the polluted coverage denominator, both CI/tooling defects, never data defects).

## 0.2.1 → 0.2.2 concurrent state and durability integrity (plan 022)

Release **0.2.2** (plan 022) makes four concurrency/durability boundaries atomic or fail-loud. The API surface is **additive-only** (plain reviewed compat gate at 0.2.2: expected deltas are the version literal, `ModelRouterStateStore.reserveBudget`/`commitBudget`/`releaseBudget` plus `ModelRouterReservation`/`ModelRouterBudgets.reservationTtlMs`/`ModelRouterLimits.maxRateKeys`/`maxBudgetKeys` (memory + Postgres), `SessionRecord.version` with `appendSession` `expectedVersion`, `EventMultiplexerError` with code `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`, and the `@arnilo/prism/testing/state-concurrency-conformance` subpath; no removal, no `--allow-break`). Three of the four changes tighten behavior where 0.2.1 silently accepted a race — concurrent hosts may now see an explicit conflict where 0.2.1 lost an update or oversubscribed a budget:

1. **Atomic model-budget reservation (`model-router`, `enterprise-postgres`).** Admission is now reserve/commit/release: `reserveBudget` runs at admission and fails the request when `used + reserved + requested` would exceed the window max, returning `{ reservationId, fencingToken, admitted, retryAfterMs? }`; `commitBudget` applies the actual usage delta at the outcome (an expired reservation still charges the reserved amount with `unknownUsage: true` so a late commit can never disappear from accounting); `releaseBudget` frees an uncommitted reservation. `readBudget`-based admission stays for requests with no per-request cap, and the 0.2.1 post-hoc `addUsage` remains as retrospective accounting only — it is no longer admission authority.

   ```js
   // 0.2.1: readBudget then consumeRate then addUsage — concurrent admissions could collectively oversubscribe
   // 0.2.2: admission reserves the full per-request cap, outcome commits/releases actuals
   const reservation = await store.reserveBudget({
     key: { tenantId, principalId, provider, model },
     tokens: request.maxTokens, costUsd: request.maxCostUsd, // per-request caps, when set
     windowMs: 24 * 60 * 60 * 1000, reservationTtlMs: 60_000,
   });
   if (!reservation.admitted) { /* denied; retry after reservation.retryAfterMs */ }
   // ... run the request ...
   await store.commitBudget({
     key, reservationId: reservation.reservationId,
     fencingToken: reservation.fencingToken, tokens: actualTokens, windowMs: 24 * 60 * 60 * 1000,
   });
   ```

   Reservations expire after `reservationTtlMs` (default 60,000 ms, bounded to 31 days) even if a host never commits, so a crashed request cannot hold capacity forever. Rate/budget/circuit key maps are now capped (`maxRateKeys`/`maxBudgetKeys`, default 4,096, hard cap 65,536; circuits stay 1,024/16,384) with LRU eviction on insert; a budget row holding an active reservation is never evicted (the eviction candidates exclude held rows, and if nothing is evictable the insert fails with `ERR_PRISM_MODEL_ROUTER_STATE` `capacity-exhausted`). The durable Postgres store keeps reservations in a new `reservations` JSONB column on `prism_model_router_budgets` (migration 003, forward-only, applied automatically by `applyEnterpriseMigrations`; existing rows are untouched and read as no reservations).

2. **Atomic conversation metadata (`session-store-postgres`, `session-store-sqlite`, core `SessionRecord`).** `SessionRecord` gains `version` (fresh rows start at 1; migration 008 backfills legacy 0-version rows to 1) and `appendSession` accepts `expectedVersion`: `0` = create-only, `N > 0` = exact-version CAS update-only, omitted = the 0.2.1 last-write-wins behavior for untyped/legacy callers. A stale write throws `SessionMetadataConflictError` (`metadata_conflict`) carrying only `{ id, expectedVersion, currentVersion }` — never metadata content — and the HTTP server maps it to 409. Concurrent create/branch/archive are now single-statement: the branch `maxActiveBranches` cap is enforced inside the CAS write (a concurrent branch at cap-1 fails its version guard instead of silently dropping the oldest ref), archive wins over a stale concurrent write, and a retention-deleted session is never resurrected (the update arm requires the row to still exist).

   ```js
   // 0.2.1: create could race to the last metadata write; concurrent branch calls could lose a ref
   // 0.2.2: exactly one concurrent writer wins per version; losers get metadata_conflict
   const { version } = await persistence.appendSession({
     id: sessionId, ...ownership, createdAt, updatedAt, metadata: { state: "active" },
     expectedVersion: 0, // create-only: conflict if the session already exists
   });
   try {
     await persistence.appendSession({ ...record, metadata: { state: "archived" }, expectedVersion: version });
   } catch (error) {
     if (error.code === "metadata_conflict") { /* re-read the winning version and retry */ }
   }
   ```

3. **Single-consumer `EventMultiplexer` (core).** `createEventMultiplexer().subscribe()` now rejects a second concurrent consumer with `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER` instead of parking both consumers on one queue and silently losing events. The slot frees when the active consumer's iterator completes, is `return()`ed at a yield, or the multiplexer closes. Hosts that previously relied on multiple `subscribe()` calls sharing one multiplexer must either serialize consumption or use the event source's own broadcast `subscribe` (agent-events), which still supports multiple subscribers. `createWorkflowEventBus` and the supervisor (the only in-repo consumers) are unaffected — each already uses a single subscriber.

4. **Restart-stable NATS durable consumer identity (`session-store-nats`).** The durable consumer name is now exactly `prism_<hmac16 of tenantId|sessionId|runId>` — the 0.2.1 random suffix is gone, so a crashed durable subscribe is reused at its last-acked position by a restarting process (cursor resume, at-least-once). Clean stops still delete the durable consumer (resume then relies on the HMAC-signed cursor); only a crash leaves the consumer in place. Pre-0.2.2 consumers minted with the random suffix (`prism_<digest>_<random>`) are orphaned and reclaimed by the existing `deleteConsumer`/consumer-enumeration cleanup path on the next clean stop of a same-subject subscribe.

5. **Bounded, non-durable active-run registries (`workflows`).** The in-process workflow active-run registry is documented as non-durable (no timer, no background service): `registerActiveWorkflowRun` sweeps aborted/leaked entries before every insert and fails closed with `WorkflowRuntimeError` `ERR_PRISM_WORKFLOW_RUN_REGISTRY_OVERFLOW` at the 512 cap instead of evicting a live entry (a live eviction could silently allow a duplicate run). A run whose promise never settles is reclaimed only when it is aborted or the cap forces a sweep — there is no durable recovery of active runs in 0.2.2 (see Further Actions: 0.2.6).

**Store compatibility:** 0.2.2 is **not** rollback-compatible with 0.2.1 in the Postgres/SQLite persisted shape: `prism_sessions` gains a `version` column (migration 008) and `prism_model_router_budgets` gains a `reservations` column (enterprise migration 003). Both migrations are forward-only and additive — 0.2.2 code reads 0.2.1 databases correctly after migration (backfill included); a 0.2.1 binary pointed at a 0.2.2 database still works because the new columns are nullable/defaulted, but it will not maintain versions or reservations. The NATS durable-name change touches no persisted data (consumers are runtime state; orphaned 0.2.1 consumers are reclaimed on the next clean stop).

**Rollout:** upgrade core and the session stores together (migration 008 runs automatically via the existing checksummed `prism_migrations`; the version column must exist before any host writes CAS updates). Then `enterprise-postgres` (migration 003) and `model-router` (reservation admission can be enabled per-host; hosts that never call `recordUsage` rely on TTL expiry). Then `workflows`/`server` (conversation CAS is transparent to clients except new 409 responses), then `session-store-nats`. Branch/archive callers that intentionally lost races in 0.2.1 must now handle `metadata_conflict` (re-read + retry) where they previously accepted last-write-wins.

**Rollback risk:** restoring 0.2.1 against a 0.2.2 database is safe for reads and last-write-wins writes (the new columns are ignored) but silently reopens all four race windows: oversubscription, conversation lost updates, silent multi-subscriber event loss, and non-restart-stable NATS resume. Rollback is therefore only a stopgap, not a mitigation — prefer fixing the failing host on 0.2.2.

## 0.2.0 → 0.2.1 provider completion and outbound trust boundaries (plan 021)

Release **0.2.1** (plan 021) tightens the streaming-completion, outbound-fetch, and credential/signing/upload boundaries. The API surface is **additive-only** (plain reviewed compat gate at 0.2.1: the only deltas are the version literal and `@arnilo/prism-mcp` transport helpers `boundResponse`/`defaultResolver`/`isLoopbackAddress`/`isLoopbackHostname`/`normalizeHostname`/`raceAbort`/`requestPinned`/`resolvePinnedAddress` becoming re-exports of the lifted core primitives — same names, same signatures, no removal; no `--allow-break`), with five documented security-motivated behavior tightenings. Untyped/legacy callers may now fail where 0.2.0 silently proceeded:

1. **Strict stream completion is the shared default (all OpenAI-compatible adapters).** `createOpenAICompatibleProvider` now defaults `strictCompletion: true` — a stream that ends without a `[DONE]` marker AND a choice-level `finish_reason` (EOF, network cut, provider truncation) emits a `ProviderTransportError` (`incomplete_delta`) instead of a successful `providerDone`, and a successful done never fabricates usage. This applies to every inheriting adapter: Azure, Bedrock, Vertex, OpenRouter, ZAI, NeuralWatt (Alibaba/Kimi/Ollama/OpenCode-go had already opted in).

   ```js
   // 0.2.1: truncated stream fails closed
   for await (const event of provider.generate(request)) {
     if (event.type === "error") {
       event.error.code; // "incomplete_delta"
     }
   }
   // explicit opt-out stays available where hosts own truncation detection:
   createOpenAICompatibleProvider({ ..., strictCompletion: false });
   ```

2. **Bounded success bodies on non-stream JSON endpoints.** `readBoundedResponseJson` (exported from `@arnilo/prism/providers/transport`) replaces unbounded `response.json()` on all model-discovery `/models` calls, NeuralWatt quota, Alibaba embeddings, OpenAI uploads, and the OAuth success paths. Defaults: 65,536-byte UTF-8 ceiling, max JSON depth 32, max properties 4096, caller-supplied shape gate, abort support, secret-redacted errors. Oversized or malformed bodies abort with `ProviderTransportError` `response_body_overflow`/`response_body_shape` instead of buffering unbounded input.

3. **DNS-pinned OIDC JWKS, OPA, and content fetches; redirects rejected.** The default fetch paths of `credentials-node` JWKS (`@arnilo/prism-credentials-node/oidc`), `policy` OPA decisions, and core content/media fetches now resolve the hostname once (1–32 addresses), validate every candidate against the SSRF policy, and connect only to a pinned address via a lookup-hook socket (no re-resolution). **3xx redirects are rejected outright** (`MediaContentError` code `redirect`) — a redirected fetch is never re-validated or followed. Private/metadata/loopback addresses fail closed (`MediaContentError` `ssrf_denied`). The MCP transport helpers were lifted to the shared core primitive (`pinnedFetch`, `resolvePinnedAddress`, `requestPinned` from `@arnilo/prism`) with byte-identical behavior and are re-exported from `@arnilo/prism-mcp`.

4. **Shared bounded OAuth device/token polling.** Core OpenAI OAuth (`@arnilo/prism-provider-openai`) and `@arnilo/prism-credentials-node` now share `pollDeviceCodeToken` (RFC 8628 poll loop with `authorization_pending` continue, `slow_down` +5 s backoff, expiry deadline, cancellation, bounded success/error reads, fail-closed token-shape gates, `[REDACTED]` secret redaction). No public change — the device/token flows keep their messages and cadence; provider-specific fields stay adapter options.

5. **Credential, signing, upload, and cache edge fixes.** (a) Azure and Vertex resolve a rotating/single-use credential **exactly once per request** — the inner provider signs with the same token the wrapper validated (a `CredentialValueSource` is never consumed twice). (b) Bedrock SigV4 canonicalization lowercases and merges duplicate-case request headers last-wins and sorts query parameters by encoded key then value — duplicate-case or reordered input can no longer produce a malformed signature. (c) OpenAI upload cleanup retains a file id until its `DELETE` succeeds — a failed/skipped cleanup leaves the id registered for a retried cleanup instead of leaking the remote file. (d) The cache-telemetry `__overflow__` bucket never carries cost — it reports requests and token totals only, so one model's cost metadata cannot mix into mixed-model overflow tokens.

**Store compatibility:** 0.2.1 is store-compatible with 0.2.0 in both directions — no persisted-shape change, no migration step. Checkpoint, session-store, approval, and registry payloads are byte-identical; only fetch/stream/credential behavior changed.

**Rollout:** upgrade core first (strict completion and bounded readers apply to all hosts immediately; truncated-stream callers must add `strictCompletion: false` only if they intentionally accept incomplete streams), then `@arnilo/prism-credentials-node` + `@arnilo/prism-policy` (DNS-pinned fetches; ensure JWKS/OPA hosts resolve to public addresses and never redirect), then the provider adapters (Azure/Vertex credential handling, Bedrock signing), then `@arnilo/prism-mcp` (re-export-only change).

**Rollback risk:** restoring 0.2.0 restores all five boundary gaps — rollback is **not** a mitigation. Hosts that must roll back should disable truncated-stream acceptance, unbounded-body endpoints, redirect-following fetches, rotating-credential reuse, and upload cleanup at their own boundary until they can return to 0.2.1.

## 0.1.7 → 0.2.0 fail-closed runtime and sandbox security (plan 020)

Release **0.2.0** (plan 020) is the first cut of the 0.2.x review-remediation line: it closes the three security blockers found in the 2026-08-12 comprehensive review. The API surface is **additive-only** (plain compat gate at 0.2.0 shows zero removed/changed declarations; no `--allow-break`), but three behaviors are deliberately tightened for security, so untyped/legacy callers may now fail where 0.1.7 silently proceeded:

1. **Durable-resume decision validation (core).** `resumeAgentRun`/`resumeAgentRunStream` (and the lifecycle/resume-stream entrypoints behind them) now validate the resume payload **before any state claim, checkpoint write, or tool execution**. Unknown legacy decisions (anything other than `approve`/`deny`), malformed decision batches, oversized reasons/elicitation, and duplicate approval ids fail closed with a stable `AgentDecisionError` (`ERR_PRISM_DECISION_INVALID`/`ERR_PRISM_DECISION_LIMIT`/`ERR_PRISM_DECISION_DUPLICATE`), leave the checkpoint version untouched, and execute no tool. In 0.1.7 an unknown decision string (e.g. `"sideways"`) was accepted, the checkpoint was CAS-claimed to `running`, and the suspended tool executed. The HTTP server parser (`readAgentDecisions`) is unchanged — it remains defense in depth, not the security boundary.

   ```js
   // 0.2.0: fails closed, no side effect, version untouched
   try {
     await resumeAgentRun(agent, ref, { expectedVersion: v, decision: "sideways" }, opts);
   } catch (error) {
     error.code; // "ERR_PRISM_DECISION_INVALID"
   }
   ```

2. **Work-tool subprocess environments (`@arnilo/prism-work-tools`).** `createCliRunner` no longer inherits the full host `process.env`. The child environment is now: fixed base allow-list (`PATH`, `LANG`, `LC_ALL`, `TZ`; Windows adds `SYSTEMROOT`/`SystemRoot`/`TEMP`/`TMP`/`PATHEXT`/`COMSPEC`), then explicit validated `options.env`, then forced controls (`HOME` = `configDir`, `CLIMICROSOFT365_DISABLETELEMETRY=1`), then the late-bound per-identity token layer (`M365_ACCESSTOKEN`/`GOOGLE_ACCESS_TOKEN` style). Caps: 64 names / 64 KiB total (`ERR_PRISM_WORK_ENV`). `binary` and `configDir` must now be **absolute paths** (`path.isAbsolute`), and output capture is linear (single final `Buffer.concat`, capped at `maxStdoutBytes`/`maxStderrBytes`). In 0.1.7 the child inherited every ambient host variable.

3. **Explicit sandbox capabilities (`@arnilo/prism-coding-security`).** `SandboxAdapter` gains the optional `capabilities` field — `workspaceCoherent`/`filesystemIsolated`/`networkIsolated`/`processIsolated`/`privilegeIsolated`/`egressRestricted` (immutable booleans). Omission or malformed metadata resolves every isolation field `false` (fail-closed). `SandboxCodingComposition` now carries a resolved `capabilities` object; the old boolean `containmentClaim` is **deprecated** and is the conservative projection `workspaceCoherent && filesystemIsolated && networkIsolated && processIsolated`. Built-ins: Docker reports `filesystemIsolated: true`/`processIsolated: true`/`networkIsolated: true` only for `--network=none`/attested networks, `privilegeIsolated: false` by default; native sandbox reports `networkIsolated: true`/`egressRestricted: true` but **never** filesystem/process/privilege isolation. In 0.1.7 any `DisposableSandbox`-shaped adapter could make `containmentClaim` report `true` with no isolation-capability inspection; in 0.2.0 an un-attested adapter claims `workspaceCoherent` at most. Authorization should read the individual capabilities, never the deprecated boolean.

**Store compatibility:** 0.2.0 is store-compatible with 0.1.7 in both directions — no persisted-shape change, no migration step. Checkpoint, session-store, approval, and registry payloads are byte-identical; only the resume *input* validation is new.

**Rollout:** upgrade core first (resume validation applies immediately to all hosts), then `@arnilo/prism-work-tools` (pass absolute `binary`/`configDir` and any ambient keys your connector needs via `options.env` — the allow-list is deny-by-default by design), then `@arnilo/prism-coding-security` (capability-aware policy code; the deprecated `containmentClaim` keeps working with the stricter semantics).

**Rollback risk:** restoring 0.1.7 restores all three defects — rollback is **not** a mitigation. Hosts that must roll back should disable resume side effects and work-tool execution at their own boundary until they can return to 0.2.0.

## 0.1.4 → 0.1.5 deprecated-option removal (documented breaking cut)

Release **0.1.5** (plan 017) removes the deprecated compatibility surface that 0.1.x kept after 0.0.19: the inert provider timeout/retry knobs, the `maxToolRounds` run-option alias, the pre-0.0.19 observational-memory flat keys and worker aliases, the read-tool `autoResizeImages` flag, and the `INIT_PROVIDERS` constant. This is the **documented breaking cut** announced in the 0.1.4 migration section; every other 0.1.x release keeps the compat baseline green. Three roadmap labels from the original 0.1.5 task were corrected during planning and are honored here:

1. **`RunOptions.maxToolRounds`** (not `AgentConfig.maxToolRounds`) is the removed alias → use `RunOptions.limits.maxToolRounds`. `AgentConfig.limits.maxToolRounds` and `RunLimits.maxToolRounds` stay supported.
2. **`ReadToolOptions.autoResizeImages`** is the removed flag; `transformImage` is the supported replacement (the roadmap text had the direction reversed).
3. **`INIT_PROVIDERS`** is the removed constant; `listInitProviders()` is the supported replacement that remains (the roadmap said to remove `listInitProviders`).

### Removed symbols and replacements

| Removed | Replaced by | Fail-closed behavior |
| --- | --- | --- |
| `ProviderRequestOptions.timeoutMs` | `ProviderRequest.signal` / `RunOptions.signal` (host-side abort) | removed from the type; untyped callers are refused with a `TypeError` naming the replacement before any provider call |
| `ProviderRequestOptions.maxRetries` | `AgentConfig.retry` / `RunOptions.retry` | same |
| `ProviderRequestOptions.maxRetryDelayMs` | `AgentConfig.retry` / `RunOptions.retry` | same |
| `RunOptions.maxToolRounds` | `RunOptions.limits.maxToolRounds` | removed from the type; untyped `{ maxToolRounds }` run input is refused before the agent starts |
| `ObservationalMemorySettingsInput.observeAfterTokens` | `observation.messageTokens` | flat key removed from the type; settings-provider JSON or untyped overrides carrying it throw a `TypeError` naming the nested replacement before any worker/provider call, compaction, or session append |
| `ObservationalMemorySettingsInput.reflectAfterTokens` | `reflection.observationTokens` | same |
| `ObservationalMemorySettingsInput.compactAfterTokens` | `context.compactAfterTokens` | same |
| `ObservationalMemorySettingsInput.keepRecentEntries` | `context.recentMessages` | same |
| `ObservationalMemorySettingsInput.recentMessageMaxTokens` | `context.recentMessageMaxTokens` | same |
| `ObservationalMemorySettingsInput.observationsPoolMaxTokens` | `context.observationsPoolMaxTokens` | same |
| `ObservationalMemorySettingsInput.observationsPoolTargetTokens` | `context.observationsPoolTargetTokens` | same |
| `ObservationalMemorySettingsInput.workerModel` | `observation.model` / `reflection.model` / `dropper.model` | same |
| `ObservationalMemorySettingsInput.thinkingLevel` | `observation.thinkingLevel` / `reflection.thinkingLevel` / `dropper.thinkingLevel` | same |
| `ObservationalMemorySettingsInput.requireExplicitModel` | `observation.requireExplicitModel` / `reflection.requireExplicitModel` / `dropper.requireExplicitModel` | same |
| `CreateObservationalMemoryOptions.workerProvider` / `workerModel` | `observation.provider` / `observation.model` (and the `reflection` / `dropper` equivalents) | removed from the type; the factories throw synchronously naming the replacement |
| `ObservationalMemoryRuntimeOptions.workerProvider` / `workerModel` | `observation` / `reflection` / `dropper` worker configs | same |
| `ReadToolOptions.autoResizeImages` | `transformImage` | removed from the type; `createReadTool` throws naming `transformImage` before any path resolution or filesystem access |
| `INIT_PROVIDERS` (root export) | `listInitProviders()` | removed; init parsing, usage text, validation, and tests all use the function |

### Before / after

Provider knobs were inert in first-party providers (hosts were always expected to abort/retry at their own layer):

```ts
// 0.1.4
const session = await agent.createSession();
await session.run("Hi", {
  provider: { timeoutMs: 30_000, maxRetries: 3, maxRetryDelayMs: 250 },
});

// 0.1.5
const session = await agent.createSession();
await session.run("Hi", {
  retry: { maxAttempts: 3, baseDelayMs: 250 },
  signal: AbortSignal.timeout(30_000),
});
```

`maxToolRounds` moves into the limits group (the CLI flag `--max-tool-rounds` is unchanged and maps to the nested limit):

```ts
// 0.1.4
await session.run("Hi", { maxToolRounds: 2 });

// 0.1.5
await session.run("Hi", { limits: { maxToolRounds: 2 } });
```

Observational-memory settings and workers become nested-only (0.0.19 already introduced the nested groups; the flat keys were kept for pre-1.0 hosts):

```ts
// 0.1.4
createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  workerProvider,
  sessionModel: agent.config.model,
  overrides: { observeAfterTokens: 1, thinkingLevel: "low" },
});

// 0.1.5
createObservationalMemoryRuntime({
  session,
  appendEntry: (entry) => store.append(entry),
  observation: { provider: workerProvider, model: { provider: "neuralwatt", model: "glm-5.2-fast" } },
  sessionModel: agent.config.model,
  overrides: { observation: { messageTokens: 1, thinkingLevel: "low" } },
});
```

The read tool keeps only the host-owned resize callback:

```ts
// 0.1.4
createReadTool(cwd, { autoResizeImages: true });

// 0.1.5
createReadTool(cwd, {
  transformImage: async ({ buffer, mimeType }) => resize(buffer, mimeType),
});
```

### Dynamic-config refusal behavior

Removed members are also removed from the runtime resolver paths, so **untyped** callers (plain JS, `as any`, settings-provider JSON, persisted run input) are caught before any side effect:

- Provider request knobs and `maxToolRounds`: refused at the top of the run entry point (`runInternal`) with a `TypeError` naming `RunOptions.limits.maxToolRounds` (or the abort/retry replacement) — before the agent starts, no tool/provider call happens.
- Observational-memory flat keys: `assertNoRemovedFlatKeys` runs before any worker/provider call, compaction, or session append; it names the first offending key and its nested replacement. The worker aliases are refused synchronously at both factory boundaries.
- `autoResizeImages`: refused at `createReadTool` construction, before path resolution or `access`/`statFile`/`readFile`.
- `INIT_PROVIDERS`: reads of the removed constant yield `undefined`; use `listInitProviders()`.

### Store compatibility

**Compatible — no persisted shape change.** None of the removals touch the session-store schema, run-state checkpoint shape, event schema, or default behavior: the removed options were inert aliases, and the nested replacements resolve to the same active values (e.g. `maxToolRounds` default 8 / hard cap 64 in `DEFAULT_RUN_LIMITS` / `HARD_RUN_LIMITS` are unchanged).

### Rollback

Restore the 0.1.4 manifests/tag (or revert this commit) — no data migration. Configs and code written against 0.1.5 nested forms also work on 0.1.4 (the nested members are not new in 0.1.5), but `@ts-expect-error`-free code must drop any removed-key usage first. Stores never change.

## 0.1.3 → 0.1.4 internal reorganization behind barrel re-exports (no migration)

Release **0.1.4** (plan 016) is an **internal file reorganization behind barrel re-exports**: the root `src/agents.ts` and `src/contracts.ts` god-modules were split by concern into sibling modules (`contracts-core` / `contracts-run-state` / `contracts-protocol` behind the `contracts.ts` barrel; `agent-session` / `agent-run-lifecycle` / `agent-approval` / `agent-tool-dispatch` / `agent-run-state` / `agent-loops` / `compaction` behind the `agents.ts` barrel). **Public declaration surface unchanged** — the root entry surface is byte-identical to 0.1.3 (zero added/removed/changed on the public entry; the only union-surface additions are 14 internal cross-module helper exports that are not consumer-importable, see `scripts/compat-baseline/arnilo__prism.txt`). The optional `@arnilo/prism-browser` package extends additively with Chrome DevTools Protocol capabilities (0.1.4): `browser_evaluate`, `browser_observe`, and the `block_urls`/`unblock_urls`/`throttle`/`emulate` act actions on Chromium hosts, plus raw `{ css }`/`{ xpath }` targets — new exports and two optional structural interface members only, zero removals. **Store compatibility: compatible** — no persisted shape, event schema, or default behavior changed (no runtime path changed; the split is declaration-level). no migration step; rollback = restore the 0.1.3 manifests/tag (stores never change). The next line, **0.1.5**, is the documented **breaking cut** (deprecated-option removal); its migration section will list the removed symbols (the public-but-unused export candidates from `scripts/dead-exports.mjs`).

Release **0.1.3** (plan 015) is the dead-code and deprecation hygiene patch on the frozen 0.1.x line: benchmark-runner consolidation (one parameterized `scripts/benchmark.mjs --scenario <name>` replaces the per-version runners; 16 orphaned `benchmark-0.0.{8..16}` runner/test files removed, all `benchmark-*.json` evidence kept), the 12 `docs/review-coverage-2026-07-*.md` evidence files archived to the tarball-excluded `docs/_evidence/`, a non-blocking unused-code sweep (`npm run sweep:unused`, always exits 0, report to `scripts/unused-sweep-report.txt`), and opt-in checkpoint persistence (`persistSessionState: true` on durable run/resume options persists the loaded-skill name catalog ≤64 names in the run-state checkpoint and restores it on resume — bodies re-resolve from the live registry; `createReadPathSetPersistence` in `@arnilo/prism-coding-agent` persists the read-before-write path set through the host `CheckpointStore`, ≤1024 paths, ownership-scoped). **Store compatibility: compatible** — the persisted run-state schema stays at version 1 (the optional `sessionState` field is absent by default, so 0.1.2 checkpoints parse unchanged and opt-out checkpoints are byte-identical); no upgrade or rollback step exists (rollback = restore the 0.1.2 manifests/tag; stores never change). Declaration surface is additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.3 with zero breaking deltas, enforced by `node scripts/release.mjs gate`). No breaking defaults.

## 0.1.0 → 0.1.1 post-release hardening (additive, no migration)

Release **0.1.1** (plan 013) is a hardening patch on the frozen 0.1.x line: five scoped fixes — build single-flight (`npm run clean` removed from `npm run build`, standalone), deterministic MCP SSE relay test (`relayStatelessBody` internal export in `@arnilo/prism-mcp`, not in the package entry surface), combined core + workspace coverage summary (`scripts/coverage-summary.mjs`), canonical manifest-count narrative (49 publishable manifests = root + 48 workspace packages), and ACP modes/config ownership-scoped persistence guidance (the agent never persists `modeId`/`configValues`; host stores MUST key by `sessions.ownership`). **Store compatibility: compatible** — no persisted shape, event schema, or default behavior changed; the 0.0.28 → 0.1.0 → 0.1.1 lines all stay on the same checksum-protected contract, so no upgrade or rollback step exists (rollback = restore the 0.1.0 manifests/tag; stores never change). Declaration surface is additive-only vs the frozen 0.1.x contract (`scripts/compat-baseline` regenerated at 0.1.1 with zero breaking deltas, enforced by `node scripts/release.mjs gate`). No breaking defaults.

## 0.0.28 → 0.1.0 release-candidate hardening (no migration)

Release **0.1.0** (Phase 12) is a release-candidate hardening cut of the **0.0.28** graph: no new packages, public exports, schema migrations, or runtime dependencies (frozen in `scripts/phase12-freeze-manifest.json`; deviations require a recorded plan 012 Task 0 entry). No persisted shape, event schema, or default behavior changed. **Store compatibility: compatible** — session-store and enterprise PostgreSQL schemas stay at the checksum-protected contract shipped in 0.0.24–0.0.28; no upgrade or rollback step exists for 0.0.28 → 0.1.0. No breaking defaults. 0.1.x patch releases promise additive-only declaration deltas vs `scripts/compat-baseline` (enforced by `node scripts/release.mjs gate`).

## 0.0.17 → 0.1.0 upgrade matrix

| Release line | What changed | Store compatibility | Breaking defaults |
| --- | --- | --- | --- |
| 0.0.18 | `repo_search` literal-only, atomic write/edit, context-budget eviction, MCP SDK 1.30.0 | compatible (no persisted shape change) | default `inputLayout` → `cache_aware` |
| 0.0.19 | observational-memory lifecycle, nested OM settings | compatible (no persisted shape change) | none |
| 0.0.20 | skills progressive disclosure, `load_skill` | compatible (no persisted shape change) | `SkillRegistry` activates **zero** skills unless `activateAllSkills`; disclosure default `progressive` |
| 0.0.21 | coding-tool capability gaps (`outputMode`, `glob`, delete/move, read-before-write) | compatible (no persisted shape change) | none |
| 0.0.22 | Caveman/Ponytail behavior packages | compatible (no persisted shape change) | none |
| 0.0.23 | enterprise-postgres state adapters | **tested migration** (enterprise migration 001, checksum-protected, per-schema advisory lock) | none |
| 0.0.24 | durable `AgentEventSource`, `ToolEffectStore` | **tested migration** (session-store 006/007; enterprise 002; backup before upgrade) | none |
| 0.0.25 | durable custom loops, batched approvals | **tested refusal** — persisted 0.0.24 runs fail closed on 0.0.25 resume (fingerprint `{name, revision}`) | durable-loop fingerprint shape |
| 0.0.26 | coding intelligence, process sessions, forge, egress | compatible (no persisted shape change) | none |
| 0.0.27 | ACP coding-host interop | compatible (no persisted shape change) | none |
| 0.0.28 | OIDC/OPA/MCP-OAuth/OpenAPI/artifact adapters | compatible (no persisted shape change) | none |
| 0.1.0 | RC hardening | compatible (no migration) | none |

Verification: `PRISM_TEST_POSTGRES_URL=... npm run test:postgres` runs the disposable PostgreSQL suites including the upgrade-chain and refusal tests below; `node scripts/release.mjs gate` enforces the additive-only compat promise. Each release-line section below documents its changes in detail.

## 0.0.27 → 0.0.28 enterprise auth, policy, MCP OAuth, API, and artifact adapters (additive)

Release **0.0.28** (Phase 11) adds five optional enterprise adapter seams: an OIDC/JWKS identity verifier, an OPA policy evaluator with durable ledger entries, MCP OAuth client/server support, host-selected OpenAPI operations compiled into effect-gated tools, and an S3-compatible artifact body store behind a new core body contract. Everything is **additive and opt-in** — hosts that wire none of it keep exact prior behavior (the Phase 11 conformance suite asserts the adapter-absent baseline). Publishable graph stays **48** manifests.

1. **OIDC identity verifier is a new subpath.** `createOidcIdentityVerifier` from `@arnilo/prism-credentials-node/oidc` returns a core `IdentityVerifier`: RS256/ES256 over native WebCrypto, host-pinned JWKS URL with SSRF policy, one bounded refetch on unknown `kid`, fail-closed `IdentityError` reasons `ERR_PRISM_OIDC_*`. SSRF denials surface as the core `MediaContentError` (`ssrf_denied`), not as verification failures. The SDK never stores tokens; hosts map claims to `AgentIdentity` themselves.
2. **OPA evaluator is a new subpath.** `createOpaPolicyEvaluator` from `@arnilo/prism-policy/opa` returns a core `PolicyEvaluator` for use with `createPolicyEvaluator`/`evaluateAndAppend` (the Phase 6 durable ledger). Timeouts and transport failures fail closed to `deny` by default (`onFailure: "escalate"` rethrows); the mapped input never carries prompts, tokens, or credentials; `requirePolicyVersion` pins the OPA bundle revision.
3. **MCP OAuth client wiring is opt-in per transport.** `createMcpOAuthTransport`/`createMcpOAuthFetch` (from `@arnilo/prism-mcp`) add RFC 9728/8414 discovery, PKCE interactive flow, RFC 8707 resource-bound tokens, and RFC 7009 revocation over the existing pinned fetch policy. Hosts supply persistence through `McpClientAuthState` (tokens/discovery/client-information/code-verifier); refresh tokens belong in encrypted/keychain-backed stores. Transports without an `auth` option are unchanged.
4. **`createPrismMcpWebHandler` takes a server factory and gains `protectedResource`.** The first argument now accepts `McpServer | (() => McpServer | Promise<McpServer>)`. Stateless operation **requires** a factory: the previous shared stateless transport threw `Stateless transport cannot be reused across requests` on the second request, so this is a correctness fix; stateful callers may keep passing an instance. The new `protectedResource` option serves RFC 9728 metadata at `/.well-known/oauth-protected-resource` and adds `WWW-Authenticate: Bearer resource_metadata=...` challenges to 401s; `resource` is required (fail closed at configuration time). Handlers without the option behave exactly as before.
5. **OpenAPI tools are a new package.** `@arnilo/prism-openapi-tools` `createOpenApiTools({ document, operations, server, ... })` compiles only host-listed `operationId`s from an OpenAPI 3.1 document at setup time (never model-driven discovery): GET-family operations get `effect: { kind: "none" }`, mutation operations get `{ kind: "external_mutation", idempotency: "required" }` so the core run loop gates approval and idempotency; responses are bounded, redacted, and marked `trust: "untrusted_external"`; the server origin is pinned and drift fails closed.
6. **Artifact bodies stay host-owned, with a new optional contract.** Core gains `ArtifactBodyStore`/`ArtifactBodyRef`/`ArtifactBodyStoreError` (types only, storage-free) and an optional `size` on `ArtifactRevision`. `createArtifactService` accepts an optional `bodies` store; `deliveryLink` then resolves a presigned `url` through `bodies.presign` and fails closed when the revision has no recorded size. `@arnilo/prism-server/artifact-bodies` ships the reference S3-compatible adapter (hand-rolled SigV4, optional host KMS callback, legal hold blocks delete). Services without a body store behave exactly as before (no `url` on delivery links).
7. **No migration steps required.** No persisted shape, event schema, or default behavior changed; all seams are inert until configured. Errors: `ERR_PRISM_OIDC_*`, `ERR_PRISM_OPA_*`, `ERR_PRISM_MCP_OAUTH_*`, `ERR_PRISM_OPENAPI_*`, `ERR_PRISM_ARTIFACT_BODY_*`, `ERR_PRISM_S3_*`.

Conformance: `node --test scripts/phase11-conformance.test.mjs`; evidence: `scripts/benchmark-0.0.28.json`; freeze: `scripts/phase11-freeze-manifest.json`. Docs: [agent identity](agent-identity.md), [policy and audit](policy-and-audit.md), [MCP tools](mcp-tools.md), [OpenAPI tools](openapi-tools.md), [work artifacts and review](work-artifacts-and-review.md), [host security](host-security.md).

## 0.0.26 → 0.0.27 ACP coding-host interop (intentional advertise/surface changes)

Release **0.0.27** (Phase 10) turns `@arnilo/prism-ag-ui/acp` from a text/tool/usage/approval glue layer into a full coding-host adapter over the Phase 8/9 primitives: host-seam capability advertisement, session persistence, modes and config options, client fs/terminal, MCP bridging behind a host gate, coding lifecycle events, and elicitation. ACP stays stable **v1** on `@agentclientprotocol/sdk@1.3.0`; UNSTABLE fields are never advertised or consumed. Publishable graph stays **48** manifests.

1. **`initialize` advertisement is now a pure function of host seams — hosts that parsed the old response must re-check.** Previously the agent advertised only `sessionCapabilities.close` (plus `loadSession` when a lifecycle seam existed). Now: `loadSession` iff `sessions.load` is wired, `sessionCapabilities.list`/`delete`/`resume`/`additionalDirectories` iff the matching seam exists (`close` stays always-on), `promptCapabilities.image`/`audio`/`embeddedContext` iff the matching `capabilities.prompt` policy seam exists, and `mcpCapabilities.http`/`sse` iff `mcp.select` is wired with that transport. Removing a seam withdraws the method — there is no separate capability flag. Clients must treat every session method they call as capability-gated.
2. **New session surface.** `session/load`, `session/resume`, `session/list`, `session/delete` register only with their seams; `session/new` input carries policy-checked `cwd`/`additionalDirectories`/`mcpServers`; `session/resume`/`session/load` responses carry `modes`/`configOptions` state when wired. Resuming a still-registered session rejects with `ERR_PRISM_ACP_INPUT` ("ACP session already exists") — reconnect after a replica change must resume a stored session, not a live one. `session/set_mode` and `session/set_config_option` are new when `modes`/`configOptions` are wired; `set_config_option` additionally requires the client to advertise `session.configOptions.boolean`.
3. **Client fs/terminal are opt-in per client.** When the client advertises `fs.readTextFile`/`writeTextFile` (or `terminal`), `sessionFactory` input gains `coding.filesystem`/`coding.processes` adapters over the client's methods, keyed by a pre-generated session id. Hosts that do not use them keep prior behavior; clients that do not advertise them never see the methods called.
4. **MCP servers require a host gate.** `mcpServers` on `session/new`/`load` are accepted only when `mcp.select` is wired and approves; the UNSTABLE `acp` transport is always rejected, stdio has no capability advertisement (accepted when the gate exists), and http/sse must match an advertised transport. Unapproved or unconfigured servers fail closed.
5. **Lifecycle events map to updates.** With `coding.lifecycle` wired, `file_changed` → `tool_call_update` with `locations` (diff only from the `fileDiff` projection allow-list), `worktree_changed`/process events → projection-gated `agent_message_chunk`, `permission_denied` → `failed` status, `configuration_changed` → `config_option_update`. Nothing is emitted without a projection or a streaming session.
6. **Elicitation, when the client advertises it.** All-elicitation suspensions surface as `elicitation/create` (form mode, bounded schema); otherwise they stay on the shared four-option permission path. Permission semantics are unchanged: `allow_once`/`allow_always`→`allow_for_run`/`reject_once`/`reject_always`→`reject_for_run`, cancel and unknown options deny.
7. **Frozen caps.** Sessions 32/128, additional directories 8/32, MCP servers 8/32 (config 16 KiB/256 KiB), modes 16/64, config options 16/64, list page 20/100, diff 64 KiB/1 MiB, locations 32/128 per update, media parts 16/64 and 64 KiB/1 MiB, terminal chunks at Phase 9 `process.outputChunkBytes`. Exceeded caps fail closed with `ERR_PRISM_ACP_LIMIT`.
8. **Errors.** `AcpError` codes `ERR_PRISM_ACP_INPUT` / `LIMIT` / `POLICY` / `CAPABILITY` / `MCP`; over the wire the SDK wraps them as JSON-RPC `-32603` with the message in `data.details` (the code string itself is transport-local). Unadvertised methods surface as `-32601 method not found`.

No core, coding-agent, or AG-UI behavior changed; hosts that never wire the new seams see the old minimal advertisement and all prior mappings. Conformance: `node --test scripts/phase10-conformance.test.mjs`; example: `node examples/acp-coding-host.ts`; docs: [ACP coding-host interop](acp.md).

## 0.0.25 → 0.0.26 coding intelligence, managed processes, forge, and safe egress (additive)

Release **0.0.26** (Phase 9) adds four opt-in capability families to `@arnilo/prism-coding-agent` and `@arnilo/prism-coding-security`: Git-aware repository enumeration, host-selected LSP language intelligence, managed process sessions, a reference GitHub forge adapter with idempotent handoff, and an allow-list egress proxy with DNS-rebinding defense. All are **additive** — no existing export, event, or persisted shape changes; hosts that do not activate the new factories keep prior behavior. Publishable graph stays **48** manifests.

1. **Git-aware enumeration is opt-in.** `createLocalRepositoryOperations` keeps the native walker. `createGitAwareRepositoryOperations(cwd, options?)` runs a fixed `git ls-files --cached --others --exclude-standard -z` and falls back to native enumeration when the directory is not a Git work tree or git is unavailable. `includeIgnored` is host-only (never surfaced to tools). No change to `listLocal`/`searchLocal`/`globLocal` callers.
2. **Language intelligence is host-activated.** `createLanguageIntelligence(options)` spawns the host-selected LSP server lazily (no spawn at construction) and speaks LSP 3.17 over bounded JSON-RPC. Unsupported languages fail closed with `ERR_PRISM_LSP_UNSUPPORTED`; out-of-workspace URIs fail with `ERR_PRISM_LSP_WORKSPACE`. Rename applies through `ExecutionPolicy` (kind `edit`, risk `high`) and atomic writes; hosts that never call it are unaffected.
3. **Process sessions are a new contract.** `createProcessSessions(options)` manages start/output/input/wait/signal/kill/release with ownership scoping and expiry sweep. Sessions may run natively or through an optional sandbox `startProcess` backend; sandbox loss marks sessions `unknown` for host reconciliation. PTY is not supported (`ERR_PRISM_PROCESS_PTY_UNSUPPORTED`). No change to the existing `shell`/`bash` primitives.
4. **Forge adapter is a new contract.** `createGitHubForge(options)` is GitHub-first by freeze decision; mutations require durable context (`identity`/`ownership`/`sessionId`/`runId`) and a `ToolEffectStore`, and are gated by `ExecutionPolicy`. Push injects the token via `GIT_CONFIG_*` environment variables — never argv, never persisted. `CreateGitHubForgeOptions.fetch?` (new in 0.0.26) lets hosts route forge traffic through the egress proxy or inject a mock; it defaults to `globalThis.fetch`.
5. **Egress is deny-all by default.** `createEgressPolicy()` allows nothing; presets (`npm-registry`, `github`) are explicit allow-lists. `createAllowListEgressProxy` pins DNS and verifies the socket peer before tunneling (rebinding defense), denies private/metadata IPs unless `allowPrivate`, re-validates redirects per hop, and caps bytes/time/concurrency. `composeEgressSandboxNetwork` records the attestation as `prism.egress.*` container labels; `denyDirectEgress` is asserted on sandbox start.
6. **No migration steps required.** No persisted shape, event schema, or default behavior changed. Hosts upgrading from 0.0.25 can adopt any subset of the new factories; the previous `docs/migration.md` sections remain accurate for their releases.

```ts
import { createGitAwareRepositoryOperations } from "@arnilo/prism-coding-agent";
const repo = createGitAwareRepositoryOperations(process.cwd());
const { entries } = await repo.listLocal({ maxDepth: 3 });
```

Examples: `node examples/phase9-coding-intelligence.ts` (composed, network-free).
7. **Durable `AgentEventSource` root export (FR-6/FR-7).** `@arnilo/prism-session-store-postgres` now re-exports `createPostgresAgentEventSource`, `ClosablePostgresAgentEventSource`, and `PostgresAgentEventSourceOptions` from the package root — previously reachable only via a `dist/...` subpath. `persistence.events` remains the canonical bundled path and is unchanged. Placement answer: the durable event source stays in this package for the 0.0.26 line; PostgreSQL `LISTEN`/`NOTIFY` remains the reference durable implementation. Any future relocation ships a replacement export with a deprecation note before removal — no migration action today. See [agent events](agent-events.md) and `prism-agent-event-source-export-and-location.md`.
8. **NATS JetStream `AgentEventSource` (FR-5).** New sibling package `@arnilo/prism-session-store-nats` implements the durable `AgentEventSource` contract over JetStream: per-run subjects, per-subject replay, durable pull consumers with explicit acks (at-least-once, 30s redelivery), idempotent `append` by `record.id` within the stream dedupe window, HMAC-signed resumable cursors, and ownership-scoped `page`/`subscribe`/`cleanup`. The host provisions the stream (`prism.agent-events.>`, retention limits, dedupe window); the package is inert on import. Postgres remains the reference durable implementation — NATS is a sibling adapter for JetStream backbones. See [agent events](agent-events.md).
9. **A2A server-side exposure (Task 13).** `createAgUiA2AServer()` in `@arnilo/prism-ag-ui` fronts one host-selected local AG-UI agent as an A2A 1.0 server: remote A2A clients start and stream local runs through the AG-UI input allow-list and event mapper (same projection/redaction/caps as the AG-UI SSE path), reusing `@arnilo/prism-supervisor` `createA2AHandler` transport. No new runtime, task store, or worker; no route added to `createPrismHandler()` (A2A stays separately mounted). Optional `durable` wiring replays finished runs from an `AgentEventSource` with cursor event ids. Requires the optional `@arnilo/prism-supervisor` peer only when the factory is called (lazy import). See [A2A interoperability](a2a.md).
10. **Reference frontend renderer (Task 14).** `@arnilo/prism-ag-ui/renderer` subpath export ships a framework-free client renderer: it consumes an AG-UI event stream (SSE or in-memory `AsyncIterable`) and renders `a2ui-surface` snapshots/deltas into DOM surfaces from a host component catalog. DOM-free core (`reduceA2UiOps` operation state machine) plus a thin binding layer with a built-in default text/container catalog; server-side A2UI caps are enforced client-side (ops/message, op bytes, surfaces/run, component depth); invalid/oversized ops drop closed with a bounded error event; unknown components render an explicit placeholder; remote HTML is never executed (createElement/text nodes only). The main `@arnilo/prism-ag-ui` entry stays runtime-agnostic — DOM code lives only behind the `renderer` subpath. Requires no new dependency and no host build step. See [AG-UI](ag-ui.md).
11. **Async `AgUiProjection` hooks (Task 15).** Every `AgUiProjection` callback return is now `Awaitable<T>` (`T | Promise<T>`), so projectors can call async host APIs like `session.entries()` directly; the AG-UI and ACP mappers await hooks in event order (never `Promise.all`) with per-event fail-closed exactly like sync throw handling. `createMessagesFromSessionProjection({ getMessages })` accepts an async transcript source and emits `MESSAGES_SNAPSHOT` at `agent_started`/`message_finished`. Sync-only hosts keep exact prior behavior — sync values short-circuit, no behavior change, and the sync-path mapper p95 is budget-gated. `projectCoWorkEvent` is now async (it may await the `coWork` hook). See [AG-UI](ag-ui.md).

## 0.0.24 → 0.0.25 durable custom loops and human-in-the-loop (intentional pre-1.0 contract changes)

Release **0.0.25** makes custom loops durable and replaces sequential binary approvals with one shared pending-decision model. Protocol adapters (AG-UI, ACP, MCP, coding `ask_user_decision`, server resume, supervisor nesting) map onto that model. Opt-in A2UI painting and standard AG-UI projectors ship in `@arnilo/prism-ag-ui`. Publishable graph stays **48** manifests.

1. **Custom loops on durable runs need hooks.** Built-in `single-shot` / `generate-validate-revise` stay durable. A custom `AgentLoopStrategy` on `runState` must expose `snapshot` + `restore` (and usually `revision`) or the run fails closed with `AgentLoopStateError` / `ERR_PRISM_LOOP_NOT_DURABLE` before any provider call. Snapshots must be JSON-compatible and fit the run-state byte/depth caps (`ERR_PRISM_LOOP_SNAPSHOT`).
2. **Fingerprint loop entry shape changed.** Durable fingerprints now store `{ name, revision }` instead of a bare loop name string. Persisted **0.0.24** runs fail closed on **0.0.25** resume (fingerprint mismatch / `ERR_PRISM_LOOP_REVISION`). Finish or abandon in-flight 0.0.24 durable runs before upgrading, or rebuild from a fresh suspension under 0.0.25.
3. **Batch resume.** `AgentRunResume` accepts either legacy `{ decision: "approve" | "deny" }` or `{ decisions: RunDecision[] }` — exactly one. Outcomes: `allow_once` / `allow_for_run` / `reject_once` / `reject_for_run`, optional `reason`, `modifiedArguments`, `elicitation`. One CAS transition applies the whole batch; partial batches re-suspend with remaining pendings. Sticky decisions expire at run end and match exact scope (tool/effect/identity/arguments hash + nested attribution path).
4. **Elicitation.** Tools may declare an `elicitation` hook; coding `ask_user_decision` uses it on durable gates. MCP hosts use `mcpElicitationDecision` / `mcpElicitationResultFromDecision` with required `humanInteraction: true` on accept.
5. **Nested approvals.** Supervisors with `checkpoints` + `definitionRevision` surface child approvals to the root as hashed attributed ids; `resumeNestedRun` routes decisions without widening child permission. Root sticky decisions are path-scoped.
6. **AG-UI / ACP / server.** Interrupts carry redacted `pendingDecisions` in metadata; resume may return a batch. ACP permission offers four outcomes (`allow_always` → `allow_for_run`, `reject_always` → `reject_for_run`); cancelled stays terminal deny. Server `/resume` validates the same shapes at the boundary.
7. **Opt-in generative UI.** `createAgUiHandler({ a2ui })` paints A2UI v0.9 surfaces; A2UI actions return through existing `input.project` (not an automatic tool loopback). Standard projectors (`createMessagesFromSessionProjection`, `createStateFromStoreProjection`, `createActivityFromToolProgressProjection`, `composeAgUiProjections`) are explicit opt-in.

```ts
await resumeAgentRun(checkpoints, {
  runId,
  decisions: [
    { approvalId: "a1", outcome: "allow_for_run" },
    { approvalId: "a2", outcome: "reject_once", reason: "external recipient" },
  ],
}, { ownership, expectedVersion });
```

Examples: `node examples/durable-loops-and-approvals.ts`, `node examples/ag-ui-a2ui.ts`. Hosts that never set `runState` / interrupt gates keep prior behavior aside from the fingerprint shape for any already-persisted durable runs.

## 0.0.23 → 0.0.24 distributed events and recoverable tool effects (intentional pre-1.0 contract changes)

Release **0.0.24** adds a replaceable durable `AgentEventSource`, recoverable `ToolEffectStore`, full AG-UI 0.0.57 compatibility, and AG-UI fronting for MCP / MCP Apps / remote A2A. Core remains dependency-free; PostgreSQL adapters and effect stores stay opt-in. Delivery is at-least-once with consumer deduplication — not exactly-once.

1. **Open persistence for durable events.** `createPostgresPersistence({ pool, eventCursorSecret })` exposes `persistence.events` (`AgentEventSource`). Migration **006** adds `prism_agent_event_streams`; migration **007** adds the exact-owner retention index. Share one HMAC `eventCursorSecret` across replicas. SQLite gains sequence compatibility only (no distributed subscribe). Backup before upgrade; rollback restores both session-store and enterprise migration histories.
2. **Reconnect through the shared source.** Prefer `events.subscribe({ ownership, sessionId, runId, after })` or transport cursors (`Last-Event-ID` / `?cursor=` / A2A `afterEventId` Prism extension). Live `session.subscribe()` remains process-local. Consumers must dedupe `record.id`; sticky sessions are optional.
3. **Opt into tool effects.** Pass `effectStore` on the agent/run. Declare `tool.effect` (`kind` + `idempotency`). Core derives `idempotencyKey` — model keys are ignored. Required effects without a store fail closed. Ambiguous post-dispatch outcomes become `unknown` and need `resolveUnknown`; they never auto-replay.
4. **Enterprise tool effects.** `createPostgresEnterpriseState` applies enterprise migration **002** (`prism_tool_effects`) and exposes `state.toolEffects`. Cleanup remains host-scheduled via `state.cleanup`.
5. **Package adapters.** Coding/browser/work/MCP/supervisor tools ship effect declarations or host policies. Work mutations require the core key + store. MCP defaults remote tools to unsupported unless the host policy classifies them.
6. **AG-UI.** Handler accepts full RunAgentInput with host `input.project` / `frontendTools` / interrupt resume; optional `mcp` / `a2a` adapters. Direct Prism MCP/A2A APIs remain independent.

```ts
const persistence = await createPostgresPersistence({ pool, eventCursorSecret: secret });
const enterprise = await createPostgresEnterpriseState({ pool });
const agent = createAgent({ model, provider, tools, runLedger: persistence, effectStore: enterprise.toolEffects });
for await (const { record, cursor } of persistence.events.subscribe({ ownership, sessionId, runId, after })) {
  save(cursor); // dedupe record.id; reconnect never reruns completed effects
}
```

Example: `node examples/distributed-events-and-tool-effects.ts` (network-free memory reference). Hosts that never open an event source or effect store keep prior behavior.

## 0.0.22 → 0.0.23 production enterprise state adapters (intentional pre-1.0 contract changes)

Release **0.0.23** adds `@arnilo/prism-enterprise-postgres` and makes work-mutation idempotency plus durable model-router state explicit. Core agent/session behavior stays unchanged; install/configure this package only when a host needs PostgreSQL coordination.

1. **Install and open deliberately.** Add `@arnilo/prism-enterprise-postgres` with `@arnilo/prism`, the four domain packages, and `pg`. Call `await createPostgresEnterpriseState({ pool, schema })`; import is inert. Open applies/verifies the checksum-protected enterprise migration under a per-schema advisory lock. Keep its migration history separate from session-store PostgreSQL history; backup/restore-test both. Configure TLS, credentials, pool limits, roles, and a deployment migration principal in the host.
2. **Use one composition, not ad-hoc SQL.** Wire `state.policy`, `state.evaluations`, and `state.workIdempotency` into existing package APIs. Policy/work/router operations require active verified identity; hosts must project evaluation records and queries from verified ownership. Every query needs tenant scope; owner-bound cursors cannot cross tenants. Memory/JSONL stores remain test/single-process adapters, not production substitutes.
3. **Replace work `get`/`put` with claim transitions.** `IdempotencyStore` now uses async `begin`, `complete`, `fail`, `markUnknown`, and `resolveUnknown` (plus reconciliation `get`). Call `begin` before an approved external connector effect and use returned claim token/version for CAS transitions. Treat **absent**, `in_progress`, `completed`, `failed_retryable`, `failed_terminal`, and `unknown` differently. Only completed summaries replay; ambiguous `unknown` requires connector/operator reconciliation and is never auto-replayed. This is not exactly-once delivery.
4. **Make router paths asynchronous when state is durable.** Pass `stateStore: state.modelRouter` to `createModelRouter`. Await `resolve`, `recordUsage`, and `recordOutcome`, pass a verified identity to each, and retain any `circuitProbeToken` from `resolve` for outcome recording. `providerSource` is memory-only; with a durable state store it throws `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE` rather than bypassing rate/budget/circuit state.
5. **Own cleanup.** No background worker starts. Schedule bounded `await state.cleanup({ tenantId, accountId?, userId?, principalId, limit })` from an authorized host job; expired work claims become `unknown` and expired circuit probes reopen safely. Do not make a global sweep or auto-resolve unknown outcomes.
6. **Keep request roles narrow.** Request state SQL is limited to `SELECT`/`INSERT`/`UPDATE`/`DELETE` on six state tables plus schema `USAGE`; DDL/catalog/advisory-lock work belongs to controlled migration setup. Never persist prompt/body/tool-argument material, raw connector/provider results, JWTs, or credentials. See [Enterprise PostgreSQL state](enterprise-postgres-state.md) for bounds, cleanup, SQL inventory, and recorded performance evidence.

```ts
const state = await createPostgresEnterpriseState({ pool, schema: "prism" });
const router = createModelRouter({ resolver, stateStore: state.modelRouter });
const selected = await router.resolve({ model, identity });
await router.recordOutcome({ identity, provider: selected.provider.id, model: selected.model.model, success: true, circuitProbeToken: selected.circuitProbeToken });
await state.close(); // caller-owned pool stays open
```

## 0.0.21 → 0.0.22 third-party behavior integrations (additive)

Release **0.0.22** adds two optional behavior packages; core `@arnilo/prism` runtime behavior is unchanged.

1. **New packages (opt-in).** `@arnilo/prism-caveman` and `@arnilo/prism-ponytail` wire upstream Caveman and Ponytail into Prism extension contracts. They are **not** included in `@arnilo/prism-code`, `@arnilo/prism-sdk`, or `@arnilo/prism-all` by default — install explicitly when needed.
2. **Inert until loaded.** Import registers nothing. Host calls `createExtensionKernel().load([createCavemanExtension(...)])` / `createPonytailExtension(...)`.
3. **Session attach required.** Both factories require host `appendEntry` and `getEntries` callbacks (same pattern as observational memory `attach`) for mode/level persistence (`caveman-level`, `ponytail-mode` custom entries).
4. **Progressive disclosure.** Keep `skillsDisclosure: "progressive"` and register `createLoadSkillTool`; mode/level slices come from `caveman-mode` / `ponytail-mode` instruction injectors, not eager full `SKILL.md` bodies.
5. **Upstream resolution.** Caveman requires `upstreamPath` to a [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) checkout (`skills/` marker). Ponytail resolves optional peer `@dietrichgebert/ponytail@^4.8.4` or `upstreamPath`. Missing upstream → `setup` throws; zero contributions registered.
6. **Publish graph.** Publishable manifest count is **46** (was 44).

Example: `node examples/caveman-ponytail.ts` (network-free fixture upstream trees).

```ts
import { createCavemanExtension } from "@arnilo/prism-caveman";
import { createPonytailExtension } from "@arnilo/prism-ponytail";

await kernel.load([
  createCavemanExtension({ upstreamPath: "/path/to/caveman", appendEntry, getEntries }),
  createPonytailExtension({ defaultMode: "full", appendEntry, getEntries }),
]);
```

No breaking changes for hosts that do not install the new packages.

## 0.0.20 → 0.0.21 coding-tool capability gaps (small intentional breaks)

Release **0.0.21** completes Phase 4 coding-tool capability gaps in `@arnilo/prism-coding-agent` / `@arnilo/prism-coding-security`:

1. **`repo_search` gains `outputMode`.** Optional `outputMode?: "content" | "files_with_matches" | "count"` (default `"content"`). Files-only and count modes omit match body text from model content; invalid values fail closed.
2. **Bounded `glob` tool.** `createGlobTool` / aggregator membership; `*` / `?` / `**` only (no brace expansion); reuses repository walk limits; files only.
3. **Optional read-before-write.** Host sets `requireReadBeforeWrite: true` with a shared `ReadPathSet` on read/write/edit; unread paths fail unless `force: true`. In-memory / session-scoped only — not checkpoint-persisted.
4. **Bounded `delete` and `move`.** File or empty directory delete (no recursive); move with `overwrite` default `false`; high-risk `ExecutionPolicy` kinds; host undo is not automatic.
5. **Aggregator membership.** `createCodingTools` → **9** tools (adds `glob`, `delete`, `move`); `createReadOnlyTools` → **4** (adds `glob`). Hosts asserting exact `.length` must update.
6. **Approval / sandbox.** `isMutatingKind` includes `delete` and `move` (not `glob`). Full sandbox custom ops must supply delete/move backends; `RepositoryOperations` requires `glob`.

Example: `node examples/coding-tools-capability-gaps.ts` (network-free).

```ts
const tools = createCodingTools(cwd); // length 9
const search = createRepoSearchTool(cwd);
await search.execute({ query: "TODO", outputMode: "files_with_matches" }, ctx);

const readPathSet = createReadPathSet();
const write = createWriteTool(cwd, { requireReadBeforeWrite: true, readPathSet });
```

Fuzzy edit may still succeed silently on a normalized whitespace/unicode match — docs state that tradeoff; ambiguous multi-match already fails closed. No PDF/trash/PTY/LSP in 0.0.21.

## 0.0.19 → 0.0.20 skills and context progressive disclosure (small intentional breaks)

Release **0.0.20** completes Phase 3 progressive skill disclosure in core `@arnilo/prism`:

1. **Default skill prompt is catalog-only.** Active skills render `Skill <name>: <description>` every turn (`skillsDisclosure: "progressive"` default). Full `instructions` appear only after a successful `load_skill` for that session or when the host sets `skillsDisclosure: "eager"`.
2. **Runtime `SkillRegistry` without activation is empty.** When `AgentConfig.skills` is a `SkillRegistry` and neither `RunOptions.activeSkills` nor `RunOptions.skills` is set, **zero** skills activate (was `SkillRegistry.list()`). Migration: `activateAllSkills: true` on the run or agent restores list-all activation (still subject to disclosure rules). Plain `Skill[]` configs are unchanged.
3. **`load_skill` is host-opt-in.** Export `createLoadSkillTool({ registry, loaded })` from `@arnilo/prism`; register on the active tool set. Unknown names, inactive required tools, oversize bodies, and duplicate loads fail closed; load cannot widen tools or permissions.
4. **Context budget honors `ContextBlock.priority`.** Within `context` and `skills` victims, lower priority drops first (missing = 0), then LIFO. Skills with loaded bodies may demote to description-only (`skill_body` omission) before full removal.
5. **Optional `toolResultFold`.** Off by default; host `summarize` + thresholds fold aged large tool results in provider view only (session store untouched). Summarizer failure keeps raw results.

Example: `node examples/skills-progressive-disclosure.ts` (network-free).

```ts
// Migration for hosts that relied on activate-all registry behavior:
await session.run("Hi", { activateAllSkills: true });

// Migration for hosts that want full bodies every turn without load_skill:
const agent = createAgent({ model, provider, skills: registry, skillsDisclosure: "eager" });
```

Declarative `activateAllCapabilities: true` is unchanged and does **not** set runtime `activateAllSkills`.

## 0.0.18 → 0.0.19 observational memory lifecycle (small intentional breaks)

Release **0.0.19** completes Phase 2 observational memory in `@arnilo/prism-compaction-observational-memory` only; core `@arnilo/prism` runtime behavior is unchanged.

1. **Preferred host path: `createObservationalMemory().attach()`.** Post-run observe/reflect/drop and `compactAfterTokens` compaction run automatically after proxied `run`/`prompt`/`stream`/`compact` (and via `wrapResumeRun` / `wrapResumeStream`). Manual `createObservationalMemoryRuntime().flush()` remains on `attached.runtime` for advanced hosts.
2. **Nested settings replace flat keys.** Use `observation` / `reflection` / `dropper` / `context` / `retrieval` groups from `resolveObservationalMemorySettings()`. Legacy flat keys still map (`observeAfterTokens` → `observation.messageTokens`, `reflectAfterTokens` → `reflection.observationTokens`, `compactAfterTokens` → `context.compactAfterTokens`, `keepRecentEntries` → `context.recentMessages`, flat `workerModel` → all workers when nested models absent). **Throw** if flat and nested values conflict.
3. **Separate observer/reflector/dropper models.** Pass per-worker `provider` / `model` / `instruction` / `thinkingLevel` under `observation`, `reflection`, and `dropper`. `dropper.policy: "lowest-relevance"` drops without a model; default is `"model"`.
4. **Reflection recall reads the full ledger.** Supporting observations dropped from the active pool still resolve in `recallObservationalMemory()` with `dropped` / `missingSourceEntryIds` status instead of being invisible.
5. **Recall tool adds current-branch paging.** `createRecallMemoryTool()` accepts either `{ id }` or `{ cursor, limit?, direction?, detail? }` (default limit 20, hard cap 100). Both `id` and `cursor` together fail closed.
6. **Coverage and eligibility fixes.** Observer input is eligible `user`/`assistant`/`tool` messages only; bookkeeping/compaction/custom OM entries advance scan coverage without entering the prompt. Empty observer passes still append `coversUpToId`. Compaction `fullFold` actively trims lowest-relevance observations to hard byte caps.

Example: `node examples/observational-memory-lifecycle.ts` (network-free). Live worker canary: `PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS=1` (Task 7 gate).

## 0.0.17 → 0.0.18 restore integrity (small intentional break)

Release **0.0.18** removes model-facing regex from `repo_search`:

1. **`repo_search` literal only.** The tool schema no longer advertises `mode: "regex"`. Passing `mode: "regex"` returns a bounded tool error. `compileSearchPattern(query, caseSensitive, maxPatternBytes)` dropped the `mode` argument; hosts calling it with the old signature must update imports. Use literal substring search or a host-owned search backend for regex needs.
2. **`write` / `edit` crash-safe replace.** Default local operations write to a same-directory `.prism-write-*` temp file then `rename` onto the target, so a crash mid-write cannot truncate the original. Happy-path ToolResult shape unchanged. Custom `WriteOperations` / `EditOperations` should provide equivalent durability.
3. **`contextBudget` history eviction.** Under pressure, `applyContextBudget` drops oldest history messages first (not newest). Hosts that relied on newest-first history retention under budget should revisit eviction expectations.
4. **Default `inputLayout` is `cache_aware`.** Unset `AgentConfig.inputLayout` / `RunOptions.inputLayout` now use cache-stable ordering (attachments/resources and tool results before current input). Set `inputLayout: "legacy"` to restore the prior order.
5. **`@arnilo/prism-mcp` SDK bump.** `@modelcontextprotocol/sdk` is pinned to **1.30.0** (from 1.29.0), clearing the moderate `@hono/node-server` path-traversal advisory on the MCP HTTP transport. No Prism MCP public API signature changes; hosts pinning the SDK independently should align to 1.30.0+.

Docs-only: README provider inventory (14 adapters), optional `@arnilo/prism-browser` wording, and `docs/0.1.0-readiness.md` current-line status were corrected; no runtime behavior change beyond the items above.

## 0.0.16 → 0.0.17 code-review hardening (small intentional breaks)

Release **0.0.17** implements the 2026-07-29 full implementation review (plan 081): twenty fixes across durable runs, guardrails, retry, extension lifecycle, CLI, and provider plumbing. Most changes are additive or internal; four intentionally change existing behavior:

1. **CLI: inert flags now rejected.** `--config`, `--resource`, `--extension`, and `--tool` were parsed-and-recorded without effect; `parseCliArgs` now throws `CliUsageError("<flag> is not supported in this build")`. The dead `config` / `resources` / `extensions` / `tools` fields were removed from `CliOptions`. Hosts passing those flags must drop them until a CLI-harness plan wires them.
2. **`ExtensionKernel.load()` returns handles.** `load(extensions)` now resolves to `LoadedExtension[]` (`{ name, dispose() }`) instead of `void`; callers ignoring the return value are unaffected. A failed `setup` now unwinds that extension's partial registrations. Contribution registries, `ProviderRegistry`, and `ModelRegistry` gain `unregister(...)` (additive).
3. **Default prompt builder omits the tool text list for tool-capable models.** When `model.capabilities.tools === true`, the `Available tools:` system message is no longer emitted (schemas already travel via `request.tools`); unknown/`false` capability keeps it. Saves duplicated tokens per turn; observable only in prompt text.
4. **Default retry policy applies jitter and honors Retry-After.** `createDefaultRetryPolicy` now applies ±25% jitter (`jitter`/`random` options) and honors `error.retryAfterMs` (populated from provider `Retry-After` headers), capped by `maxDelayMs`. Delays are no longer deterministic unless `random` is injected.

Additive-only highlights: `MemoryCredentialStoreOptions.allowProviderFallback` (strict provider scoping opt-in), `createMemoryCheckpointStore` `maxRecords`/`maxValueBytes` bounds, `ShellToolOptions.envAllowlist`, guardrail `steer_rejected` event, `ErrorInfo.retryAfterMs`, agent fingerprint now covers instructions/system prompt/skills (existing durable runs resume or fail fingerprint exactly as before — the fingerprint only got stricter).

## What it does

Prism 0.0.6 preserves documented 0.0.3 agent construction except for two intentional Phase 3 public-API cleanups:

1. **`session.run()` / `session.prompt()` return `AgentRunResult`** and `session.stream()` starts one owned run after subscribing. Callers that ignored the previous `Promise<void>` keep working; failed/aborted runs reject with `AgentRunError` (`.result` attached).
2. **`AgentConfig.extensions` / `settings` / `credentials` are removed.** Wire extensions through `createExtensionKernel()`, read settings in the host, and pass credential resolvers to the provider edge.

## 0.0.15 → 0.0.16 simplification, shared survivors, and release gates (additive, pre-release)

Release **0.0.16** is a simplification/readiness release: no runtime behavior changes, no package retired, and the only public-surface change is one additive export plus one internal package. The published root tarball is smaller and the release now runs offline pre-publish gates. See [Phase 11 evidence](_evidence/review-coverage-2026-07-26-phase-11.md).

### New shared export: `resolveRedactor` (additive)

`@arnilo/prism` now exports `resolveRedactor(redactor?, secrets?)` from `src/redaction.ts` — the single survivor of four private copies previously duplicated across `evals`, `memory`, `rag`, and `workflows`. Those packages now source it from core; no package previously exported it, so this is purely additive (added to the frozen value-export surface deliberately). Hosts that resolved a redactor by hand can use it directly:

```ts
import { resolveRedactor } from "@arnilo/prism";
const redactor = resolveRedactor(undefined, [apiKey, process.env.SECRET]);
```

Provider JSON cleanup (`cleanJson`) was deliberately **not** consolidated: the nine provider copies are private one-liners with real wire-shape variants (neuralwatt/openrouter also strip `null`), so they remain per-package. Checkpoint codecs were already consolidated in `workflows/src/checkpoint-core.ts`, and the executable `spawn` sites stay per-domain because each encodes distinct security invariants.

### New internal package: `@arnilo/prism-session-store-codecs`

The two 409-line SQLite/Postgres row-mapper files (which differed only in the `redacted` boolean representation) were replaced by a shared `createSessionRowMappers<R>(codec)` factory in the new `@arnilo/prism-session-store-codecs` package (44th manifest). It is an internal implementation detail of the two session stores — not enrolled in `prism-all` or any profile family — so no install recipe or import changes for consumers.

Surface note: `@arnilo/prism-session-store-sqlite` and `@arnilo/prism-session-store-postgres` no longer re-export the individual row-mapper functions (`rowToSessionRecord`, `sessionEntryToRow`, `encodeEntryCursor`, `decodeEntryCursor`, `parentKey`, and the other `*ToRow`/`rowTo*` helpers). These were persistence internals; the supported entry points remain `createSqlitePersistence` / `createPostgresPersistence` and friends. If you imported a mapper directly, build the equivalent with `createSessionRowMappers(codec)` from `@arnilo/prism-session-store-codecs` (pass the SQLite INTEGER or Postgres BOOLEAN `redacted` codec).

### Profiles: all six retained (no migration)

Adoption evidence (manifest dependents + docs/examples) froze all six profiles — `prism-all`, `prism-base`, `prism-code`, `prism-compaction`, `prism-providers`, `prism-sdk` — as **retain**; zero retirements. Task 0's "compaction/base zero dependents" was a measurement error (profiles are manifest-only and never imported in `src`). The profiles form a layered DAG (`all → {code, sdk, providers}`, `code/sdk → base → compaction`). Install recipes are unchanged except a new standalone `prism-compaction` recipe in [release-and-install.md](release-and-install.md). No profile migration is needed.

### Smaller root tarball + offline release gates (no runtime impact)

The root package no longer ships the historical `docs/review-coverage-*.md` evidence (11 files, ~283 KB): the packed tarball dropped from 659,478 to ≈575,680 bytes (281 → 270 files). `npm run release:gate` now runs offline pre-publish gates (API-surface `.d.ts` diff vs `scripts/compat-baseline/`, tarball deny-list, exact version ranges) and is part of `npm run sdk:ready`. Performance budgets are recorded in `scripts/budgets.json` and enforced by `scripts/budget-gate.test.mjs` (in `npm test`) and `scripts/benchmark-0.0.16.mjs`; see [performance.md](performance.md). None of this changes SDK runtime behavior.

## 0.0.14 → 0.0.15 OpenAI hosted tools, continuation, and realtime (additive, pre-release)

`@arnilo/prism-provider-openai` now distinguishes server-executed calls with `authority: "provider-hosted"`; host dispatchers must not execute or reply to them. Incomplete Responses streams self-resume with an opaque `previous_response_id` cursor (at most 4 KiB, at most eight hops) and surface `continuation_required`; cap or duplicate-cursor failure now ends with a provider error instead of a silent partial response.

Realtime is opt-in through `createOpenAIRealtimeSession({ model, ownerId, apiKey, ... })`. Supply a stable host-owned `ownerId`; the session uses documented WebSocket headers, waits for `session.created`, exposes audio/transcript/interrupt/close events, and fails closed on disconnect, identity, audio/byte, or wall-time limits. It does not add a vendor package or automatic voice capture/playback.

## 0.0.14 → 0.0.15 AI SDK adapter matrix (additive, pre-release)

`@arnilo/prism-provider-ai-sdk` now pins and verifies `@ai-sdk/provider@4.0.4` at setup (matrix also lists `4.0.3`) rather than accepting any v4 minor. Upgrade the peer package to the documented matrix entry. An unlisted installed version fails with typed `AiSdkProviderError` code `unsupported_version`; add a tested matrix row before changing it.

Stream output now maps `response-metadata.id` to `message_start`, preserves `providerExecuted` tool authority as `"provider-hosted"`, and rejects unsupported output parts or `structuredOutput.strict` with `unsupported_mapping` rather than dropping them. Pass `redactor` when using the adapter directly; agents retain their existing active-redactor behavior.

## 0.0.14 → 0.0.15 RAG source lifecycle and document adapters (additive, pre-release)

`@arnilo/prism-rag` now adds `replaceSource()`, `deleteSource()`, and `replaceDocument()` plus `DocumentLoader` / `Parser` seams. Existing `indexChunks()` behavior is unchanged; use `replaceSource()` when a source can shrink or must retain its old index if re-embedding fails.

Atomic replacement deliberately requires a scoped source-aware transaction (`getBySource()` + `transaction()`). The in-memory reference vector store supplies both; durable custom stores must add equivalent exact tenant/resource/corpus behavior before using replacement. Prism rejects a generic upsert-only store rather than offering a non-atomic fallback.

Reference parsers (`textParser`, `markdownParser`, `htmlParser`, `pdfParser`) are available from root and `@arnilo/prism-rag/parsers`; loaders are available from `@arnilo/prism-rag/loaders`. HTML removes script/style text. The PDF parser only accepts bounded uncompressed text PDFs (8 MiB / 256 pages / 30 s); install no new parser dependency—supply a host `Parser` for compressed or scanned files. `createWebFetchDocumentLoader()` accepts an existing `@arnilo/prism-web-tools` adapter and preserves its citation/untrusted metadata; it does not add a crawler.

RAG retrieval now optionally accepts host-owned `Reranker`; it receives redacted bounded hits and must return their exact IDs once each. Results add `trust`, `provenance`, and `retrievalRank`; context blocks now repeat untrusted/inert/injection-capable metadata. Add `statusStore` to indexing/replacement when hosts need per-source pending/indexed/failed/partial progress, use `listIngestionStatus()` for capped exact-scope pages, and supply durable storage if process restart durability matters. `createMemoryIngestionStatusStore()` is only a reference adapter.

## 0.0.14 → 0.0.15 memory export and rebuild (additive, pre-release)

`@arnilo/prism-memory` adds `exportMemory({ identity, cursor?, ... })` and `rebuildIndex({ cursor?, ... })`. Export is not a generic admin dump: provide the exact host-verified tenant/resource/thread identity used to construct `createMemory()`. It excludes revoked, invisible, and consent-less legacy entries, redacts each returned record, and caps one page at 100 entries / 4 MiB / 10 seconds by default (200 / 32 MiB / 60 seconds hard).

`rebuildIndex()` re-embeds one 32-record page by default (128 hard), validates existing and new finite vectors, and returns `nextCursor`; persist that cursor in host-owned authorized state and call again to resume after an abort/restart. Neither API scans a corpus or starts a background worker. They require a semantic `VectorStore.listByThread()` implementation; `applyRetention()` now also requires `countByThread()` for bounded oldest-first deletion. The shipped in-memory adapter and PostgreSQL/pgvector adapter conform. `@arnilo/prism-session-store-sqlite` remains a session/run persistence package, not a semantic-vector adapter.

## 0.0.13 → 0.0.14 personal/work-agent conversations, co-work review, and channel/device gates (additive, pre-release)

Release **0.0.14** is strictly additive: every surface extends a shipped package and reuses the AG-UI adapter shipped in 0.0.12. The only new packages are two optional provider adapters (41 → 43 manifests): `@arnilo/prism-provider-alibaba` and `@arnilo/prism-provider-ollama`, both enrolled via the `@arnilo/prism-providers` family. No permission broadening — channel/device/co-work features cannot widen consent, memory, network, file, browser, connector, or tool permissions (roadmap gate 8). See [Phase 9 evidence](_evidence/review-coverage-2026-07-25-phase-9.md).

| Surface | Before (0.0.13) | After (0.0.14) |
| --- | --- | --- |
| Conversations | n/a | `@arnilo/prism-server` `createConversationService` / `createConversationHandler`: durable user-scoped threads, reconnectable redacted replay, branch/archive caps |
| Memory consent/lifecycle | Scope only | `consent { source, scope, visible }` on records; `recall()` injection filter; `setConsent` / `correct` / `forget` / `applyRetention` |
| Artifacts / review | n/a | `createArtifactService` / `createArtifactHandler` over the existing checkpoint store: revisions, approve/reject, `lastValidated`, expiring authorized delivery links |
| AG-UI co-work events | Run events only | `mapCoWork()` (+ ACP parity) for artifact progress/approval/download-link, connector drafts, redacted browser snapshots |
| OAuth connectors | Codex only | `createMicrosoft365OAuthProvider` / `createGoogleWorkspaceOAuthProvider` (PKCE/device-code), least-privilege scope bundles, `revokeOAuthCredential`, per-identity `createOAuthWorkTokenProvider` |
| Browser composition | Run policy only | `createBrowserCheckpointLedger`: verified-state checkpoints + reload/verify-before-side-effect |
| Device adapters | n/a | Core `DeviceAdapter` contract + deny-by-default `resolveDevicePolicy` / `assertDeviceAdmit` + conformance (the first vendor wrapper arrives in 0.3.0) |
| Providers | 9 HTTP adapters in `@arnilo/prism-providers` | Optional `@arnilo/prism-provider-alibaba` (Model Studio / DashScope + Coding Plan, dynamic `listAlibabaModels`, explicit + implicit cache) and `@arnilo/prism-provider-ollama` (cloud/local, dynamic `listOllamaModels`, implicit-only cache); both join the `@arnilo/prism-providers` family (11 adapters) |

**Identity requirement:** every new conversation/artifact/memory/connector/browser/device surface starts from a host-verified `AgentIdentity` (0.0.13 `IdentityVerifier`); ownership is rechecked on resume and at schedule fire time. Caller-asserted identity fails closed.

**Deferred from the 0.0.14 line (historical demand gate):** Slack/Teams chat-channel packages, realtime-voice and desktop-control vendor packages were deferred (contract + conformance only in 0.0.14), Studio/control plane, local Office runtime, a second memory/event runtime, and memory production conformance canaries. The 0.3.0 Linux desktop wrapper is now the first vendor adapter; macOS/Windows desktop vendors remain deferred, and PostgreSQL/pgvector memory plus M365/GWS OAuth / Playwright / keychain live canaries remain explicit operator gates.

Benchmark placeholder: `node scripts/benchmark-0.0.14.mjs` (release Task 12). Caps documented in [Performance limits](performance.md).

## 0.0.12 → 0.0.13 enterprise identity, policy, routing, and work connectors (additive, pre-release)

Release **0.0.13** adds host-verified `Principal` / `AgentIdentity` on runs, tools, server/MCP/A2A/workflow seams. Hosts must supply an `IdentityVerifier` (`verify()` → `AgentIdentity` with `verified: true`); caller-asserted identity without host verification fails closed. See [Agent identity](agent-identity.md).

Optional `@arnilo/prism-policy` records allow/deny/modify/approval decisions with evidence refs only (no prompt/body/secret keys). Optional `@arnilo/prism-model-router` wraps `ProviderResolver` with allow-list, residency, token/cost budgets, rate limits, circuit breaking, and bounded fallbacks (`allowOpenRouterRouting` default false). See [Policy and audit](policy-and-audit.md) and [Model routing](model-routing.md).

| Surface | Before (0.0.12) | After (0.0.13) |
| --- | --- | --- |
| Run/tool identity | Ownership strings only | Optional verified `AgentIdentity`; `narrowIdentity` / propagation guards on delegation |
| Policy audit | Host-only logs | Optional append-only ledger + cursor export via `@arnilo/prism-policy` |
| Model governance | Host wraps resolver ad hoc | Optional `@arnilo/prism-model-router` before provider I/O |
| Work connectors | n/a | Optional `@arnilo/prism-work-tools` M365 + GWS; draft-then-approve; hard-coded CLI argv |

**Deferred to 0.0.14+:** conversation storage/service, Studio/control plane, internal auth DB, Redis/SQS queue adapters, local Office binaries. See [Phase 8 evidence](_evidence/review-coverage-2026-07-23-phase-8.md).

Benchmark placeholder: `node scripts/benchmark-0.0.13.mjs` (release Task 10). Caps documented in [Performance limits](performance.md).

## 0.0.12 → 0.0.13 enterprise cloud providers (additive, pre-release)

Release **0.0.13** adds optional `@arnilo/prism-provider-azure`, `@arnilo/prism-provider-bedrock`, and `@arnilo/prism-provider-vertex` for workload-identity enterprise endpoints. Consumer `@arnilo/prism-provider-anthropic` / `@arnilo/prism-provider-google` stay unchanged (API-key). Install enterprise packages explicitly; pass host Entra/IAM/ADC credential callbacks; preserve region/private-endpoint URLs. No database migration.

Release **0.0.13** also extends `@arnilo/prism-server` with optional `createPrismHealthHandler`, `createPrismDrainController`, handler `rateLimit` / `drain` options, `createPrismEventReplay`, and `createPrismDeploymentLease`. Existing routes stay compatible. Queue adapters remain absent (Postgres coordinator polling stays default).

Persistence schema **v5** adds `005_lifecycle_hold_quota` (`prism_legal_holds`, `prism_tenant_quotas`) plus `ProductionPersistenceStore.lifecycle` / `createMemoryPersistenceLifecycle`. Extension kernels accept optional `loadPolicy` allow-list/signature checks. Credentials-node adds optional `encryptWithHostKms` / `decryptWithHostKms`.

Optional `@arnilo/prism-work-tools` (+ `./microsoft365`, `./google-workspace`) adds identity-scoped Outlook/Gmail/calendar/file/task tools over host-pinned `@pnp/cli-microsoft365` and `@googleworkspace/cli` with hard-coded argv templates, draft-then-approve mutations, package-local `IdempotencyStore`, and shared result normalizers.

## 0.0.11 → 0.0.12 coding harness interoperability (additive, pre-release)

Release **0.0.12** adds optional `@arnilo/prism-ag-ui` (root AG-UI and stable `./acp` sibling), generic `resumeAgentRunStream()` / `AgentRunLifecycle.resumeStream()`, and `createCodingCompactionStrategy()` from `@arnilo/prism-compaction-llm`. It adds no core UI dependency, session/database migration, listener, tool, editor/filesystem bridge, conversation/artifact service, worker, or background reconnect loop.

| Surface | Before (0.0.11) | After (0.0.12) |
| --- | --- | --- |
| Durable approval stream | `resumeAgentRun()` returns final result | `resumeAgentRunStream()` and lifecycle `resumeStream()` subscribe before resume and emit selected redacted run events; existing direct resume remains compatible. |
| Browser/TUI protocol | Host maps events itself | Install optional `@arnilo/prism-ag-ui`; `createAgUiHandler()` is host-authorized Web Request → SSE, while `@arnilo/prism-ag-ui/acp` is stable ACP v1 text/tool/usage/permission glue. |
| Reconnect | Host-specific ledger query | `createPersistenceAgUiReplay()` adapts ownership-scoped redacted `queryEvents` pages. Replay is at-least-once; client de-duplicates stable event/message/tool IDs and terminal replay never reruns work. |
| Coding compaction | Generic LLM strategy | `createCodingCompactionStrategy()` keeps existing caps/history semantics while prioritizing paths, patch intent, checks, plan/todos, blockers, and next verification. |
| Subscription OAuth | Existing Codex OAuth | OpenAI Codex remains the only first-party subscription OAuth flow. Anthropic and Google packages stay API-key-only; do not import/reroute Claude Code or Gemini CLI credentials. |

**Host actions:** install the optional package only when a frontend protocol is needed; keep authorization, session/thread/run mapping, durable correlation, storage, redaction, and projection in the host. Reject frontend tools and state unless an explicit host policy accepts them. For a durable approval, persist protocol-run correlation before exposing the exact `${runId}:${version}` interrupt, then resume through the lifecycle with current ownership/version. Configure a redacted `ProductionPersistenceStore` before enabling replay. Use `createCodingCompactionStrategy()` only when the host already supplies a summary provider/model.

AG-UI defaults/hard caps: request 64 KiB/1 MiB; projected event 64 KiB/1 MiB; replay page 100/500; subscriber queue 128/4096; stream 10k/100k events and 10/64 MiB; wall time 120 seconds/30 minutes. Benchmark results remain a release-gate placeholder: `node scripts/benchmark-0.0.12.mjs` lands in Task 8. See [Frontend interoperability](ag-ui.md), [LLM compaction package](compaction-llm.md), and [Phase 7 evidence](_evidence/review-coverage-2026-07-22-phase-7.md).

## 0.0.10 → 0.0.11 coding harness fundamentals (additive)

Release **0.0.11** adds SessionIndex/search, assembler `contextBudget`, native Anthropic + Google provider packages, mid-run `steer`, coding-agent goal→verify + `ask_user_decision` (multi/free-text/suspend glue). Package count: **32 → 34** (adds `@arnilo/prism-provider-anthropic`, `@arnilo/prism-provider-google`). Version bump itself is Task 13 / release gate — treat this section as the behavioral migration map.

| Surface | Before (0.0.10) | After (0.0.11) |
| --- | --- | --- |
| Session search | No `searchSessions` / `SessionIndex` | Optional store search; SQLite/Postgres FTS migration `004_session_search` (schema **v4**); memory `sessionSearchMode: "linear" | "unsupported"` (default linear); JSONL throws `SessionSearchUnsupportedError` |
| Context budget | Assembler has no token/byte eviction | Opt-in `contextBudget` on `assembleProviderInput`; omission report via metadata helper |
| Providers | OpenCode Go Anthropic *route*; no first-party Google | `@arnilo/prism-provider-anthropic` (`createAnthropicProviderPackage`) + `@arnilo/prism-provider-google` (`createGoogleProviderPackage`); AI SDK remains escape hatch |
| Mid-run input | RPC `steer` unsupported / no queue | `AgentSession.steer` + RPC `steer` (queue 8 / 64 KiB; optional softInterrupt) |
| Coding helper | Compose manually from plan/checks/workflows | `runCodingGoalVerify` + `examples/coding-goal-verify.ts` |
| Ask user | n/a | Opt-in `createAskUserDecisionTool`; durable `suspendAskUserDecision` (no new agent interruption kinds) |
| Structured output + tools | Native schema attached every GVR provider turn | Opt-in `structuredOutputTiming: "final-turn-only"` (default `"every-turn"`): tool-eligible turns omit schema; artifact/revision turns schema-on / tools-off |

**Host actions:** reopen SQLite/Postgres stores so migration 004 applies; set `metadata.workspaceRoot` when filtering by workspace; wire Anthropic/Google packages explicitly; do not expect JSONL search. Benchmarks: `scripts/benchmark-0.0.11.mjs` (lands with release Task 13). See [Phase 6 evidence](_evidence/review-coverage-2026-07-22-phase-6.md).

## 0.0.9 / 0.0.96 → 0.0.10 coding workspace modes (breaking composition)

`@arnilo/prism-coding-security` composition now requires explicit `workspaceMode: "host" | "sandbox"`. Missing mode throws at construction. The `0.0.9` default that wired sandbox shell while keeping read/write/edit/list/search on the host cwd is **superseded** and fail-closed.

| Before (0.0.9) | After (0.0.10) |
| --- | --- |
| `createSandboxCodingTools(cwd, { sandbox })` — shell in sandbox, FS on host | Must pass `workspaceMode`. Prefer `createSandboxCodingComposition(...)`. |
| Silent split-brain treated as normal | Throws unless `allowMixedWorkspaceWiring: true` (warnings; `containmentClaim: false`). |
| No containment metadata | `composition.containmentClaim` / `warnings` / optional `treeIdentity`. Host mode never claims containment. |

```ts
// Contained: one disposable tree
const { tools, composition } = createSandboxCodingComposition(sourceRoot, {
  workspaceMode: "sandbox",
  sandbox, // DisposableSandbox auto-wires FS backends
});

// Explicit host (non-contained)
createSandboxCodingTools(cwd, { workspaceMode: "host" });

// Escape hatch (documented split; no containment claim)
createSandboxCodingTools(cwd, {
  workspaceMode: "sandbox",
  sandbox,
  allowMixedWorkspaceWiring: true,
});

// Same-tree Git
createGitTools(composition.workspaceRoot, {
  execFile: sandbox.execFile.bind(sandbox),
  commitIdentity: { name: "bot", email: "bot@example.com" },
});
```

Docker defaults unchanged: digest-pinned image, non-root user, network none, absolute Docker CLI, no host-env inheritance. Unified mode adds no unbounded sync; caps stay in `sandbox-limits.ts` / coding-agent limits. Benchmark evidence: `scripts/benchmark-0.0.10.mjs`.

## 0.0.8 → 0.0.9 release overview

All 32 first-party manifests and exact internal ranges move together to `0.0.9`; mixed first-party versions are unsupported. Core remains dependency-free at runtime and existing low-level agent/session APIs remain compatible. New coding sandbox, repository/Git, durable coding-plan, and browser surfaces are opt-in. `@arnilo/prism-browser` is included by `@arnilo/prism-all` but not by `@arnilo/prism-code` — install it explicitly when interactive browser automation is required. Office execution remains outside Prism packaging (host-selected skills/instructions only). No tag or publication is automatic from this migration.

### Malformed streamed tool-call arguments (recoverable)

Malformed streamed tool-call JSON (id+name present) no longer terminates the run as `ProviderTransportError("invalid_json_arguments")`. First-party providers emit a tool call carrying `argumentsError`; dispatch blocks with `tool_execution_blocked` / `invalid_arguments` (`error.code: "invalid_json_arguments"`), never calls `execute()`, and the model can self-correct within existing turn/tool-round budgets. Prefer `toolCallFromArgumentsText` / `tryParseJsonObjectArguments` in custom providers.

### Incomplete tool-call deltas (typed failure)

Tool-call deltas missing `id` and/or `name` at stream end no longer throw a bare `Error("Incomplete tool call delta...")`. Core reconstruction and the openai-compatible finalizer surface `ProviderTransportError` / `ErrorInfo.code: "incomplete_delta"`, fail the provider turn (no tool execution), and keep OpenCode Go / Kimi dangling fail-closed behavior. Distinguish from Defect 1a: missing identity fails the turn; present identity with bad JSON recovers via failed tool results.

### Empty call-free artifact candidates (parse_error)

`generateValidateReviseLoop` treats empty/whitespace-only call-free assistant text (including thinking-only/reasoning-only turns) as `parse_error` before the host parser/identity default. Session runs succeed only after `artifact_finished`; terminal `artifact_failed` fails the run (`AgentRunError`, typically `error.code: "parse_error"`).

## 0.0.9 coding-security Docker sandbox (additive)

`@arnilo/prism-coding-security` adds `createDockerSandbox()` / `DisposableSandbox` while preserving `SandboxAdapter.exec` and `createSandboxBashOperations()`. Hosts opt in with an absolute Docker executable and digest-pinned image; default network is none, host env is never inherited, and workspace export is an explicit bounded host callback. Existing approval-policy callers need no changes.

## 0.0.9 coding-agent repository list/search (additive behavior change)

`@arnilo/prism-coding-agent` adds native `repo_list` / `repo_search` tools. `createCodingTools()` / `createAllTools()` now return six tools. **`createReadOnlyTools()` deliberately expands from `[read]` to `[read, repo_list, repo_search]`** — update hosts that asserted the previous read-only membership. Prefer `createSandboxCodingComposition(cwd, { workspaceMode, sandbox, repository })` (or the tools-only wrappers) from `@arnilo/prism-coding-security`. Pass required `workspaceMode`; sandbox mode keeps shell and FS/list/search on one disposable tree. The 0.0.9 split (sandbox shell + host FS) is superseded — see **0.0.9 / 0.0.96 → 0.0.10 coding workspace modes** above.

Opt-in structured Git/check tools are available via `createGitTools(cwd, { commitIdentity, checks? })` and are **not** added to `createCodingTools()`/`createAllTools()`. Commits require an explicit host `commitIdentity`; PR handoff returns bounded metadata/artifacts only and never pushes.

Durable coding-task composition uses existing workflows plus coding-agent helpers (`writeCodingPlanFile`, `buildCodingCheckpointMetadata`, `assertCodingResumeAllowed`). Plan/todos remain workspace Markdown; checkpoint state keeps only references/hashes/summaries/fingerprints under `state.coding`. No `CodingRun` or todo database is introduced. See `examples/durable-coding-workflow.ts`.

## 0.0.9 browser automation (additive)

Install `@arnilo/prism-browser` explicitly (or through `@arnilo/prism-all`) for interactive browser tools. Hosts supply a pinned Playwright `Browser` (`playwright-core@1.61.0` optional peer); package import launches and downloads nothing. `createBrowserTools()` returns exactly `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close` (all `exclusive: true`). Network policy defaults to require contained-proxy attestation; configure `uploads`/`downloads` for file transfer; `browser_act` adds `upload`/`screenshot`/`download_release`. Use `createBrowserManager().closeRun(runId)` / `close()` on terminal/abort. Align with a disposable sandbox via `createSharedSandboxBrowserOptions()` and `assertBrowserSandboxNetwork()`. CSS/XPath/evaluate/CDP/persistent profiles remain unsupported.

## 0.0.7 → 0.0.8 release overview

All 31 first-party manifests and exact internal ranges move together to `0.0.8`; mixed first-party versions are unsupported. Core remains dependency-free at runtime and existing low-level agent/session APIs remain compatible. New telemetry, evaluation, MCP, A2A, ledger batching, and web research surfaces are opt-in. Release CI now requires CodeQL, dependency/license/SBOM/secret checks, packed-artifact attestations, PostgreSQL integration, and protected live-canary prerequisites; no tag or publication is automatic from this migration.

## 0.0.7 → 0.0.8 evaluations and ledger operation

`@arnilo/prism-evals` adds owner-scoped trace resolution, optional host model judges, deterministic pairwise reports, and `assertEvaluationThreshold()` without changing stored evaluation schemas. Hosts select all judge/provider credentials and should version rubrics. Core adds optional `createBatchedRunLedger()`; direct ledgers remain write-through. Choose `flush_on_terminal` only after accepting bounded pre-flush crash loss, and call `dispose()` during shutdown. Runtime snapshot caching is session/leaf-local and requires no persistence migration.

## 0.0.7 → 0.0.8 web research tools

Install `@arnilo/prism-web-tools` explicitly (or through `@arnilo/prism-all`) to add web capability; core and existing profiles remain inert. Select Brave or Exa at construction, provide Firecrawl separately for Markdown/schema extraction, and register returned `web_search`/`web_fetch`/`web_extract` tools through normal permission/trust/validation dispatch. Provider selection, credentials, target DNS policy, and extraction schema are host-only. All returned content is marked untrusted; no browser or vendor SDK is added.

## 0.0.7 → 0.0.8 A2A durable tasks

Existing text `createA2AHandler({ exposure })`, `client.send()`, and `client.stream()` remain compatible. Add host `tasks` to enable `GetTask`/`ListTasks`/`CancelTask`/`SubscribeToTask`, rich parts, interrupted states, and replay cursors; no task store or migration is created. Add host `push` for push-config CRUD and matching card capability. Raw/data/URL parts are disabled until selected in `parts`; URL/push endpoints additionally require host URL policy and are never fetched by part parsing. Push delivery/retries/idempotency remain host-owned.

## 0.0.7 → 0.0.8 MCP capabilities and sessions

`@arnilo/prism-mcp` now pins official SDK 1.29.0. Existing `connectMcpTools()` and stateless web handlers remain compatible. Use `connectMcpCapabilities()` for bounded resources/prompts and explicit roots/sampling/elicitation callbacks. Server resources/prompts must be selected explicitly and authorize every operation. Stateful Streamable HTTP additionally requires `sessionIdGenerator`, exact `allowedOrigins`, and host `resolveIdentity`; omission preserves stateless mode. `Last-Event-ID` replay is not enabled. Missing capability calls fail with `ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY`.

## 0.0.7 → 0.0.8 OpenTelemetry adapter

The optional observability package now emits OTel GenAI names and units instead of independent `prism.agent.run` / `prism.provider.turn` / `prism.tool.execute` spans and millisecond metrics. Update dashboards to `invoke_agent prism`, `chat {model}`, `execute_tool {tool}`, `gen_ai.*.duration` (seconds), and `gen_ai.client.token.usage`. Pass `{ context, trace }` as third `wrapOpenTelemetryApi()` argument for native parent context, and use `onTraceReference` or `traceId(runId)` for evaluation linkage. Core APIs and persistence schemas are unchanged.

## 0.0.7 → 0.0.8 Kimi provider alignment

`@arnilo/prism-provider-kimi` now matches the official contracts: featured Coding `k3` defaults to `reasoning_effort: "high"` (Open Platform `kimi-k3` keeps `"max"`); featured context windows use the official `262_144` for 256K-class models; the featured Moonshot catalog adds `kimi-k2.7-code-highspeed`, `kimi-k2.6`, and `kimi-k2.5` (K2.5 intentionally without Preserved Thinking). Provider-owned compat keys (`route`, `preserveThinking`, `preserve_thinking`) are stripped before the opaque compat spread and no longer leak into request bodies. The Coding route additionally sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers per the official third-party setup. Streams emit `done` only on protocol completion evidence (`message_stop` on the Coding route, `[DONE]` + `finish_reason` on the Moonshot route); truncated streams now surface as run failures.

## 0.0.7 → 0.0.8 artifact-loop parse failures

`generateValidateReviseLoop` no longer returns silently on artifact parse failure. A parser returning `{ ok: false }` (or no `value`) now consumes revision budget exactly like a validation failure: the repairer receives `value: undefined` plus a synthetic failure (`metadata.reason: "parse_error"`), and exhaustion ends with terminal `artifact_failed`. Host repairers must already tolerate `value: undefined` per the `ArtifactRepairer` contract; runs that previously ended after one silent parse failure now spend up to `maxRevisions` repair turns first.

## 0.0.7 → 0.0.8 OpenCode Go provider fixes

`@arnilo/prism-provider-opencode-go` no longer infers `structuredOutput: "json_schema"` from OpenAI-compatible routing alone. Only verified models (`mimo-v2.5`, `mimo-v2.5-pro`) advertise it; other OpenAI-route models (for example `deepseek-v4-pro`) now use the artifact-loop parsing/validation path, and requests that still pass `options.structuredOutput` for an unverified model fail before dispatch with `unsupported_model`. Hosts with their own verification evidence can set the capability explicitly through `defineOpenCodeGoModel({ capabilities })`. The Anthropic route additionally sends provider-owned `x-api-key` and `anthropic-version: 2023-06-01` headers alongside Bearer, fixing HTTP 401 on MiniMax/Qwen models; caller headers cannot override them. Streams now emit `done` only on protocol completion evidence (`[DONE]` plus a terminal `finish_reason` on the OpenAI route, `message_stop` on the Anthropic route) with no dangling tool-call accumulators; truncated connections and incomplete tool calls terminate with an `error` event, so hosts may see previously silent truncations surface as run failures.

## 0.0.6 → 0.0.7 secure run lifecycle

`createAgent()` remains backward-compatible. Version 0.0.7 adds opt-in typed `Guardrails` (`input`, provider `output`, `toolInput`, `toolOutput`) and narrowing-only `RunLimits`. Output guardrails and configured output-token/total-token/cost limits buffer provider output before exposure; blocked content is neither emitted nor persisted. A breach emits one redacted `run_limit_exceeded` event and rejects with `AgentRunError.result.limit`.

Built-in agent loops can opt into durable `runState` with a checkpoint store and stable `definitionRevision`. `interruptBeforeTool: true` suspends before any tool side effect. Resume requires exact ownership, current fingerprint/revision, and checkpoint `expectedVersion`; a crash after dispatch is ambiguous and requires operator resolution rather than replaying the tool. Custom `AgentLoopStrategy` objects are not durable. Persisted state is bounded/redacted and excludes credentials, raw input, callbacks, providers, and pending tool arguments.

`createSecureAgent()` is new and opt-in. Adopt it when every active tool must have a host validator/schema, trust and permission policies, secret redaction, finite limits, exact ownership, and durable pre-tool approval. Run options may narrow its limits and append guardrails, but cannot replace its redactor, validator, ownership, or checkpoint policy. To expose durable agent status/resume remotely, explicitly create `createAgentRunLifecycle({ checkpoints, resolveAgent })` and pass it to selected server `agentRuns` or MCP `agentRuns`; no route/tool is added otherwise.

```ts
const suspended = await agent.createSession().run("send", {
  runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  limits: { maxToolCalls: 1, maxTotalTokens: 50_000 },
});
const result = await resumeAgentRun(agent, { runId: suspended.runId }, {
  decision: "approve", expectedVersion: suspended.runState!.version!,
}, { checkpoints, definitionRevision: "1" });
```

Phase 4 adds optional `@arnilo/prism-evals` for deterministic scorers/datasets/experiments. It is not a core dependency; install it directly or through `@arnilo/prism-all`.

Phase 5 adds `prism init <dir>` to the existing CLI. It scaffolds a tiny TypeScript project with one selected provider and an offline mock test. Optional `--with-workflows` / `--with-evals` flags add only those packages; storage and telemetry stay opt-in elsewhere.

Phase 6 adds optional `@arnilo/prism-provider-ai-sdk` for AI SDK `LanguageModelV4` interoperability. For 0.0.15 install its exact supported peer `@ai-sdk/provider@4.0.3` (not `^4`); an unlisted version fails at setup. Install the adapter directly, through `@arnilo/prism-providers`, or through `@arnilo/prism-all`; it is not a core dependency.

Phase 7 adds optional `@arnilo/prism-memory` for schema/template-backed working memory and embedding-based semantic recall. Install it directly or through `@arnilo/prism-all`; in-memory adapters are default, and PostgreSQL/pgvector is opt-in. It is not a core dependency.

Phase 8 extends `@arnilo/prism-workflows` compatibly. Nodes may return `suspend()`, and opted-in tool nodes may declare `approval`. Resuming a suspended run requires `{ decision, input?, expectedVersion }`; ordinary failed/aborted recovery resume remains unchanged. `WorkflowRunStatus` adds `suspended` and terminal `denied`. Suspension/resume records remain bounded checkpoint JSON, so SQLite/PostgreSQL require no migration.

Phase 9 adds optional `@arnilo/prism-rag` for bounded plain-text/Markdown chunking, Phase 7 vector indexing/retrieval, stable citations, and explicit context injection. Existing agents and memory stores are unchanged; install and attach its context provider explicitly. No database migration is required.

Phase 10 adds optional `@arnilo/prism-server` and extends `@arnilo/prism-mcp` with server-direction APIs. Existing agent/workflow/MCP client behavior is unchanged. Install the server package explicitly, pass selected capability maps plus required host authorization, and adapt its Web handler in the deployment host. MCP servers likewise register only passed tools/commands and require authorization. No listener, route, credential source, profile package, or database migration activates automatically.

Phase 11 compatibly extends `@arnilo/prism-workflows` with `workflowNode`, shared state fields/context updates, replay lineage, explicit background enqueue, and ownership-scoped schedules. Existing workflow definitions and direct runs remain valid; `WorkflowRunResult` now always includes `state`. State schemas require a host `validateState` callback. Schedules reuse generic checkpoint/lease stores, so SQLite/PostgreSQL need no migration and no scheduler starts automatically.

Prism 0.0.6 intentionally hardens workflow identity and resource limits:

- Every `defineWorkflow()` input requires a non-empty host-authored `revision`. Revision and nested workflow revisions enter `definitionHash`; bump revision whenever function/tool behavior changes. Existing checkpoints with a different hash fail resume/replay/cancel before mutation.
- `cancelWorkflowRun()` now requires `workflow` as well as IDs/checkpoints. Cancellation compares exact tenant/account/user ownership; tenant-only or missing ownership no longer matches a run stored with account/user identity.
- Active runs are keyed by workflow ID, run ID, and exact ownership. Duplicate exact registration throws `ERR_PRISM_WORKFLOW_ALREADY_ACTIVE`; same IDs under distinct exact owners remain isolated.
- All `WorkflowLimits`, runtime `concurrency`, node retries/timeouts, and checkpoint byte options reject non-finite, unsafe, zero/negative, or above-hard-cap values instead of accepting/clamping them.

```ts
// Before
const workflow = defineWorkflow({ id: "publish", nodes });
await cancelWorkflowRun({ workflowId: workflow.id, runId, checkpoints, ownership });

// 0.0.6
const workflow = defineWorkflow({ id: "publish", revision: "2026-07-19.1", nodes });
await cancelWorkflowRun({ workflowId: workflow.id, runId, workflow, checkpoints, ownership });
```

Checkpoint schema remains version 1; no table migration is required. Pre-0.0.6 checkpoint hashes do not include revision and therefore fail against 0.0.6 definitions. Complete them before upgrade, or perform an explicit host-owned checkpoint rewrite only after verifying the exact old/new definition; do not guess a revision to bypass evidence checks.

Prism 0.0.6 also makes coding-agent I/O finite:

- `shell` now defaults to 600 seconds and 64 MiB combined output; request/config timeout cannot exceed 3,600 seconds. Timeout, abort, overflow, and spill failure kill signal-aware operations and remove unpublished spills.
- `read` streams one text page with a 64 MiB scan ceiling instead of calling full-file `readFile()`. Custom `ReadOperations` must implement `readText(path, ReadTextOptions)` and `statFile()`; text results must stay within requested caps.
- `write` rejects UTF-8 input over `maxInputBytes` before policy/filesystem mutation.
- `edit` requires custom `EditOperations.statFile()`, caps the target, aggregate old/new input, and replacement count, and passes caps/signals into operation methods.

```ts
const tools = createCodingTools(root, {
  shell: { timeout: 600, maxTotalOutputBytes: 64 * 1024 * 1024 },
  read: { maxScanBytes: 64 * 1024 * 1024 },
  write: { maxInputBytes: 8 * 1024 * 1024 },
  edit: { maxFileBytes: 8 * 1024 * 1024, maxInputBytes: 2 * 1024 * 1024, maxEdits: 100 },
});
```

Custom shell/sandbox adapters must honor the composed `signal` and finite `timeout`; Prism cannot kill an opaque remote operation that ignores its host contract. Successful truncated local output remains at `metadata.fullOutputPath` for the host to consume and delete.

Prism 0.0.6 also bounds JSON Schema, vectors, and generated IDs:

- `@arnilo/prism-tool-validator-json-schema` now rejects invalid instance/schema/cache limits during construction, then rejects schemas over default 256 KiB, depth 64, 10,000 properties/keywords, or 128 refs before Ajv compilation. Only `#` fragment refs remain valid; the compiled cache is a finite 256-entry LRU. Configure an explicit lower cap where tools accept third-party schemas.
- `@arnilo/prism-memory` now fails before scoring/storage for empty, non-number, NaN, or infinite embeddings and for dimension mismatches in configured PostgreSQL/pgvector stores. Fix the host embedder/data rather than filtering invalid values after a query.
- Generated core/workflow/evaluation IDs are cryptographic UUIDs. No API shape changes, but tests or parsers that assumed timestamp/base36 IDs must treat IDs as opaque strings.

Prism 0.0.6 hardens `@arnilo/prism-credentials-node`:

- `encryptBytes()` and `decryptBytes()` now return Promises because scrypt runs asynchronously instead of blocking the JavaScript event loop.
- Encrypted files default to 4 MiB and decrypted vaults to 3 MiB (hard 16 MiB/12 MiB). Strict envelope parsing rejects unknown properties, non-canonical base64, invalid salt/IV/tag lengths, unsupported algorithms/version, and excessive KDF work before scrypt.
- scrypt requires power-of-two `N` from 16,384–262,144, `r≤32`, `p≤16`, exact 32-byte keys, `N*r*p≤2,097,152`, and `128*N*r≤256 MiB`.
- Existing Unix vault files with group/other permissions now fail on open/rotate before content read. Fix deliberately with `chmod 600 <vault>` after confirming ownership; Prism does not silently chmod an existing file.
- Keychain calls use abort-aware native async operations, a 5-second default/60-second hard timeout, and a 3 MiB default/12 MiB hard payload bound. Unknown native messages are no longer rethrown.

```ts
// Before
const envelope = encryptBytes(plaintext, passphrase);
const bytes = decryptBytes(envelope, passphrase);

// 0.0.6
const envelope = await encryptBytes(plaintext, passphrase);
const bytes = await decryptBytes(envelope, passphrase);

const store = await openEncryptedCredentialStore({
  path: "./credentials.vault",
  getPassphrase,
  limits: { maxFileBytes: 4 * 1024 * 1024, maxVaultBytes: 3 * 1024 * 1024 },
});
```

Version-1 AES-GCM envelopes written with documented 0.0.5 defaults remain compatible when canonical and within limits. Oversized, permissive-mode, malformed, or previously out-of-policy custom KDF files require explicit host review; no automatic rewrite bypass is provided.

Prism 0.0.6 makes MCP client discovery/results and Streamable HTTP fail closed:

- Every `streamable-http` config now requires `allowedOrigins` with exact HTTPS origins. URLs with credentials/fragments, redirects, public plaintext HTTP, private/mixed DNS, and origin changes fail. Every SDK POST/GET/DELETE/reconnect pins one validated address and defaults to a 16 MiB response cap (64 MiB hard).
- Local development plaintext requires `allowLoopbackHttp: true`; both hostname and every DNS answer must remain loopback. This does not enable arbitrary private-network endpoints.
- Discovery defaults to 20 pages, 500 tools, 4 KiB cursors, 256-byte names, 16 KiB descriptions, 256 KiB schema/tool, and 4 MiB aggregate schemas. Repeated cursors and failed refreshes reject without replacing the previous tools.
- `content`, `structuredContent`, and legacy SDK `toolResult` now share `maxResultBytes` plus JSON depth/property limits. `structuredContent` remains `ToolResult.value` but is no longer duplicated under metadata.
- `listAllMcpTools(client, signal?, limits?)` accepts an optional third finite-limits object. Bridge options expose the same discovery/result fields. Invalid, non-finite, unsafe, zero/negative, or above-hard-cap values reject at setup.

```ts
// Before: HTTP accepted without package-enforced origin/DNS policy.
transport: { type: "streamable-http", url: "http://mcp.example.test/mcp" }

// 0.0.6: exact HTTPS origin and finite discovery/result configuration.
const bridge = await connectMcpTools({
  serverId: "docs",
  transport: {
    type: "streamable-http",
    url: "https://mcp.example.test/mcp",
    allowedOrigins: ["https://mcp.example.test"],
  },
  maxListPages: 20,
  maxTools: 500,
  maxToolSchemaBytes: 256 * 1024,
  maxResultBytes: 2 * 1024 * 1024,
});
```

Stdio remains an explicit host-selected executable and does not gain network policy. MCP bridge calls should still pass through core dispatch with a host `SecretRedactor`, `PermissionPolicy`, and `ToolValidator`; package limits do not establish server trust or sandbox subprocesses.

Prism 0.0.6 makes first-party persistence startup fail closed on migration/schema drift:

- `@arnilo/prism-session-store-sqlite` and `@arnilo/prism-session-store-postgres` now write deterministic SHA-256 checksums for every new `prism_migrations` row and validate exact ordered name/version/checksum history before applying DDL or exposing runtime writes.
- Open also checks full schema version 3 metadata: required tables, columns/types/nullability/defaults, primary/unique/foreign keys, and named index definitions. SQLite uses bounded PRAGMAs/catalog reads; PostgreSQL uses bounded `information_schema`/system-catalog reads while its existing per-schema advisory transaction lock is held. Neither scans application rows.
- Existing complete 0.0.5 histories with all `checksum` values `NULL` are accepted exactly once: Prism verifies full current shape, backfills every checksum inside the migration transaction, and then opens. Unknown, duplicate, out-of-order, name/version/checksum-mismatched, mixed/partial legacy rows or shape drift now reject before runtime writes.

```ts
// No call-site API change. Open either verifies/backfills safely or fails.
const sqlite = createSqlitePersistence({ filename: "./prism.db" });
const postgres = await createPostgresPersistence({ pool, schema: "prism" });
```

Before upgrade, back up the database and complete any in-flight migration. On a drift error, restore a known schema or apply a reviewed DDL repair that matches version 3, then reopen. Do not update `prism_migrations.checksum` manually: that bypasses evidence rather than repairing the schema.

Prism 0.0.6 makes compaction workers and A2A stream decoding finite:

- LLM compaction now defaults `maxSummaryTokens` to 16,384 (131,072 hard), `reserveTokens` to 16,384 (131,072 hard), and `maxErrorBytes` to 1 KiB (8 KiB hard). `maxOutputTokens` remains an alias. Invalid values reject when the strategy is created. Every post-policy provider request must retain finite `model.parameters.maxTokens`; streamed text and even empty/non-text event counts terminate at derived finite bounds.
- Final summaries are capped at four UTF-16 code units per configured token without splitting a surrogate pair. Tiny caps may omit the human truncation marker to honor the actual ceiling. Provider error/factory/policy text is exact-known-secret redacted and UTF-8 bounded.
- Observational-memory runtime adds flat `maxWorkerTurns`, `maxWorkerToolCallsPerTurn`, `maxWorkerToolCalls`, `maxWorkerArgumentBytes`, `maxWorkerResultBytes`, `maxWorkerMessageBytes`, and `maxWorkerErrorBytes` options. Defaults are 16 turns, 32/128 calls, 64 KiB arguments/results, 1 MiB messages, and 1 KiB errors; hard caps are 64, 256/1,024, 1 MiB, 1 MiB, 8 MiB, and 8 KiB.
- Settings `agentMaxTurns` now rejects fractions, non-finite values, zero/negative values, and values above 64 instead of flooring or falling back. Runtime `maxWorkerTurns` overrides it. Direct worker calls retain required `maxTurns` and use the shorter corresponding option names.
- Unknown/excess worker calls and oversized/deep/cyclic/non-JSON arguments/results now reject. Replayed arguments/results and runtime status/debug errors are bounded/redacted; pass all known secrets explicitly.
- A2A public limit defaults/options do not change. Client streaming now correctly preserves split UTF-8, accepts LF/CRLF/mixed separators and multiline `data:`, and rejects malformed UTF-8, unterminated frames, missing terminal state, or events after completion.

```ts
const strategy = createLlmCompactionStrategy({
  provider: summaryProvider,
  model: summaryModel,
  maxSummaryTokens: 4_096,
  maxErrorBytes: 1_024,
});

const memory = createObservationalMemoryRuntime({
  session,
  appendEntry,
  workerProvider,
  sessionModel,
  maxWorkerTurns: 8,
  maxWorkerToolCalls: 64,
  maxWorkerResultBytes: 64 * 1024,
});
```

No background worker, provider call, or network connection activates at import/setup. Host-provided observational-memory tools remain trusted code: Prism can reject an oversized result after return but cannot undo tool side effects.

Prism 0.0.6 also adds opt-in bounded artifact-loop tools. Set `loop: { strategy: "generate-validate-revise", toolCalls: "bounded", validator }` with `maxToolRounds`; calls dispatch sequentially through normal permission, validation, redaction, ledger, and lifecycle paths. Tool-call turns do not consume artifact revisions or parse/validate an artifact. The shared round cap emits terminal `artifact_failed` metadata `{ reason: "tool_round_limit" }`; omitted or `"disabled"` preserves prior inert-call behavior.

This page also covers two optional adoption paths:

1. **In-memory / JSONL → database-backed persistence** — replace the single-process development `SessionStore` with `@arnilo/prism-session-store-sqlite`, `@arnilo/prism-session-store-postgres`, or a host implementation, and optionally attach its durable `RunLedger`.
2. **Legacy permissive capability configuration → explicit activation** — name tools/skills and keep omitted capabilities fail-closed.

It states before/after shapes and links detailed schema, redaction, branch, capability, and security guidance.

## When to use it

Read this page when:

- you are taking an app from the `createMemorySessionStore()` / `createJsonlSessionStore()` path to a multi-process, multi-tenant, or durable database backend;
- you are hardening an agent that previously relied on "every scoped tool/skill is active" and need to name capabilities explicitly;
- you are adopting 0.0.6 persistence, checkpoints/leases, workflows, structured output, multimodality, or explicit tool safety for the first time.

If you are new to Prism, start at [Session stores](session-stores.md) and [Agent/session runtime](agent-session-runtime.md) instead.

## Inputs / request

There is no runtime import for this page. The migrations below use these surfaces:

| Surface | Where | Migration role |
| --- | --- | --- |
| `SessionStore` | `@arnilo/prism` | Runtime seam swapped from memory/JSONL to DB. |
| `createSqlitePersistence` | `@arnilo/prism-session-store-sqlite` | Local durable session, ledger, query, checkpoint, and lease adapter. |
| `createPostgresPersistence` | `@arnilo/prism-session-store-postgres` | Multi-process pooled persistence with advisory-lock migrations. |
| `ProductionPersistenceStore` | `@arnilo/prism` | Adapter-facing contract for paginated, multi-tenant reads (`query*`, optional `readBranchPath`). |
| `RunLedger` / `RunLedgerRecord` | `@arnilo/prism` | Durable run/event/tool-call/usage ledger attached via `AgentConfig.runLedger` / `RunOptions.runLedger`. |
| `SessionAppendOptions` / `SessionAppendConflictError` / `SessionBranchHandle` | `@arnilo/prism` | Atomic append, retry dedup, durable branch handles. |
| `AgentDefinition.tools` / `skills` | `@arnilo/prism` | Named, fail-closed capability activation (Phase 38). |
| `activateAllCapabilities` | `@arnilo/prism` | Temporary all-tools/all-skills compatibility opt-in while migrating. |

## Outputs / response / events

These migrations are configuration swaps: they do not add `AgentEvent` variants or change runtime event order. The observable differences are:

- reads come from a database instead of an in-memory map / JSONL file;
- branches are addressable by a storable `(sessionId, leafId)` handle;
- a run leaves durable `RunRecord` / `AgentEventRecord` / `ToolCallRecord` / `UsageRecord` rows;
- an agent with omitted `tools`/`skills` activates **no** capabilities instead of every in-scope one.

## Request/response example

Persistence migration (before/after):

```json
// Before — development SessionStore, single process, no ledger.
{
  "store": "createMemorySessionStore() | createJsonlSessionStore(path)",
  "runLedger": null,
  "ownership": null
}
```

```json
// After — host-implemented database-backed adapter + durable ledger.
{
  "store": "createDbSessionStore({ pool })",
  "runLedger": "createDbRunLedger({ pool })",
  "ownership": { "tenantId": "t1", "accountId": "a1", "userId": "u1" }
}
```

Capability migration (before/after):

```json
// Before (pre-Phase 38) — omitted tools/skills could receive every scoped capability.
{ "name": "doc", "model": "openai/gpt-4o" }

// After — explicit names; omitted means none.
{ "name": "doc", "model": "openai/gpt-4o", "tools": ["read"], "skills": ["brief"] }
```

## Implementation example

### Migration 1 — in-memory / JSONL → database-backed persistence

Runnable references: [`examples/workflow-sqlite-resume.ts`](../examples/workflow-sqlite-resume.ts), credential-gated [`examples/workflow-postgres-resume.ts`](../examples/workflow-postgres-resume.ts), and the network-free custom-adapter example [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts).

Step 1: replace the development store with a first-party adapter. Use PostgreSQL instead when multiple processes or sustained concurrent writers matter.

```ts
// Before: development store, single process.
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
const oldStore = createJsonlSessionStore("./sessions.jsonl");

// After: local durable adapter. The same object implements SessionStore,
// RunLedger, ProductionPersistenceStore, checkpoints, and leases.
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
const store = createSqlitePersistence({ filename: "./prism.db" });
```

Custom adapters remain supported through `SessionStore` / `ProductionPersistenceStore`; implement indexed `readBranchPath()` rather than full-session scans.

Step 2: optionally attach a durable run/event/tool/usage ledger and ownership scope so a process exit leaves enough to resume and bill:

```ts
import { createAgent, type RunLedger } from "@arnilo/prism";

const runLedger: RunLedger = {
  // appendRun / appendEvent / appendToolCall / appendUsage — redact before storage, preserve per-run order
  async appendRun(record) { /* insert prism_runs */ },
  async appendEvent(record) { /* insert prism_agent_events with monotonic sequence per run_id */ },
  async appendToolCall(record) { /* insert prism_tool_calls */ },
  async appendUsage(record) { /* insert prism_usage */ },
};

const agent = createAgent({
  model,
  provider,
  store,
  runLedger,
  ownership: { tenantId: "t1", accountId: "a1", userId: "u1" },
});
```

Step 3: store branch handles `(sessionId, leafId)` in your app state and use checkout to move an existing session to a previous or sibling leaf. The runtime's branch helpers (`getSessionBranchEntries`, `rebuildSessionContext`) consume `readBranchPath` so large sessions never require a full `list(sessionId)` load.

What you leave behind and why:

- `createMemorySessionStore()` — process-local maps; lost on restart, no cross-process locking. Keep for tests.
- `createJsonlSessionStore()` — single-process file adapter; reads are linear in file size, no cross-process lock, no durable idempotency table, two writers to the same file can race. Keep for local/dev only.

Prism 0.0.5 persistence adapters automatically apply additive schema step `002_usage_scope`, then `003_run_feedback`. Migration 003 creates immutable owned run/trace feedback with a run FK, cascade deletion, JSON tag/scorer/evaluation ID lists, and owner/run/trace cursor indexes. Existing rows are unchanged. Custom adapters may omit optional `ProductionPersistenceStore.feedback`; adopters implement `RunFeedbackStore` append/query/delete semantics and must verify exact linked-run ownership before insert.

See [Database persistence](database-persistence.md) for the full reference schema, indexes, conditional-append transaction pattern, retention, and NoSQL mapping; [Session stores](session-stores.md) for the `SessionStore` contract and branch helpers; [Session stores and branching](session-stores-and-branching.md) for branch semantics; [Runs and usage ledger](runs-and-usage.md) for the `RunLedger` record shapes and ordering rules.

### Migration 2 — permissive capability defaults → explicit capability activation

Pre-Phase 38 behavior could treat an omitted `tools` list as "every scoped tool"; some hosts also expected all scoped skills to be available. Phase 38 changes the safe default: omitted `tools` and omitted `skills` mean no active capabilities.

```ts
import { resolveAgentDefinition } from "@arnilo/prism";

// Before: omitted tools could receive every scoped tool.
resolveAgentDefinition({ name: "doc", model: "openai/gpt-4o" }, context);

// After: list the capabilities this agent may use.
resolveAgentDefinition(
  { name: "doc", model: "openai/gpt-4o", tools: ["read"], skills: ["brief"] },
  context,
);
```

Temporary compatibility shim (use only while migrating old configs):

```ts
resolveAgentDefinition(
  { name: "legacy", model: "openai/gpt-4o" },
  { ...context, activateAllCapabilities: true },
);
```

`activateAllCapabilities: true` intentionally scans/list-activates every in-scope tool/skill. New configs should list names and use strict contribution registries so a third-party package cannot silently shadow a capability name:

```ts
import { createContributionRegistries } from "@arnilo/prism";

const registries = createContributionRegistries({ duplicate: "error" });
```

Runtime skill activation remains explicit: `RunOptions.activeSkills` narrows per run after an agent has a skill registry configured, and `Skill.toolNames` is enforced fail-closed before the first provider turn. See [Agent definitions](agent-definitions.md), [Context and skills](context-and-skills.md), and [Contribution registries](contribution-registries.md) for the full capability semantics.

## Extension and configuration notes

- **Persistence remains host-configured.** Optional SQLite/PostgreSQL packages ship adapters and versioned setup, but hosts choose connection paths/pools, TLS, credentials, retention, tenant policy, and lifecycle. Core only consumes `SessionStore`, `RunLedger`, feedback, checkpoint, and lease contracts.
- **`RunLedger` is not a `SessionStore` replacement.** Messages, branches, and session entries still flow through `SessionStore.append()`; the ledger records run/event/tool/usage facts. See [Runs and usage ledger](runs-and-usage.md).
- **Capability activation is config over code.** Every seam lives on `AgentDefinition` / `AgentDefinitionResolutionContext` / `RunOptions`; no auto-activation, no privilege grant. A declaration cannot grant permissions or bypass `toolNames`.
- **Migration order is decoupled.** You can adopt database persistence without changing capability activation, and vice versa. Both migrations are independent config swaps.
- **Strict duplicate mode for new registries.** `createContributionRegistries({ duplicate: "error" })` makes a third-party package fail loud instead of silently shadowing a capability name during migration.

## Security and performance notes

- **Never store provider credentials or secrets in the persistence contract.** `ProductionPersistenceStore`, `RunLedger`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`, and `AgentDefinitionRecord` never require API keys, resolvers, or provider instances. Redact `SessionEntry` / event / tool-call / usage payloads before storage; the runtime redacts `AgentEvent`s via `redactAgentEvent` and ledger records via `redactRunLedgerRecord` before calling the adapter.
- **JSONL is a development-only adapter.** No cross-process lock, no durable idempotency table, no tenant isolation, no retention enforcement, no migrations. Do not use it as a production multi-writer store.
- **Avoid full-session scans in production.** Implement `readBranchPath(query)` with a recursive CTE / ancestor query and cursor-paginate `query*` from indexed columns. `list(sessionId)` + in-memory parent walk is the development fallback only.
- **`activateAllCapabilities` widens blast radius.** It activates every in-scope tool/skill, so prefer named lists. Strict duplicate mode catches capability-name collisions early.
- **`toolNames` enforcement is fail-closed.** A skill demanding an inactive tool throws at activation, before any provider turn — for both the old and new migration paths.

## Related APIs

- [Evaluations](evaluations.md): optional `@arnilo/prism-evals` scorers/datasets/experiments over `AgentRunResult`.
- [AI SDK provider adapter](providers/ai-sdk.md): optional `@arnilo/prism-provider-ai-sdk` `LanguageModelV4` bridge.
- [Working and semantic memory](working-and-semantic-memory.md): optional `@arnilo/prism-memory` working/semantic recall primitives.
- [Retrieval-augmented generation](rag.md): optional text/Markdown chunk, index, retrieval, and citation helpers.
- [Web-standard server handler](server.md): optional authorized agent/workflow HTTP routes.
- [Supervisor delegation](supervisors.md) and [A2A interoperability](a2a.md): optional install only; core agent/workflow behavior is unchanged. Child factories now receive package-derived memory IDs and narrowing permission, while remote endpoints require exact HTTPS origin allow-lists.
- [MCP client/server exposure](mcp-tools.md): selected MCP tools/commands and bounded Web transport.
- [Database persistence](database-persistence.md): production contracts, reference schema, indexes, conditional append, retention, migrations, and custom adapters.
- [SQLite persistence](sqlite-persistence.md): local durable first-party adapter and writer ceiling.
- [PostgreSQL persistence](postgres-persistence.md): pooled multi-process adapter, TLS/pool ownership, and live gate.
- [Session stores](session-stores.md): `SessionStore` contract, `SessionAppendOptions`, `SessionAppendConflictError`, branch handles, `readBranchPath`.
- [Session stores and branching](session-stores-and-branching.md): detailed branch semantics and helper reference.
- [Runs and usage ledger](runs-and-usage.md): `RunLedger` record shapes, redaction, and event/usage ordering.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL adapter and its limits.
- [Agent definitions](agent-definitions.md): declarative `AgentDefinition`, `resolveAgentDefinition`, and the explicit-capability-activation migration.
- [Context and skills](context-and-skills.md): `RunOptions.activeSkills`, `Skill.context`, `toolNames` enforcement.
- [Contribution registries](contribution-registries.md): strict `duplicate: "error"` mode for capability shadowing prevention.
- [Release and install](release-and-install.md): packaged surfaces and the offline test budget that gate these migrations.
