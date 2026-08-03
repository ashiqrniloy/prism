# Release 0.0.23 — Production enterprise state adapters

Roadmap phase: Phase 6 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.22** (Phase 5 exit gate passed 2026-07-31).
Target: `@arnilo/prism` **0.0.23**.
Prerequisite: Phase 5 complete; Phase 7 event delivery/tool-effect generalization remains out of scope.

## Objectives

- Make policy decisions, evaluation records, work-tool idempotency, and model-router governance state durable across restart and consistent across replicas.
- Reuse PostgreSQL pools, identifier validation, advisory migration locking, checksum verification, ownership filters, bound parameters, and cursor/index patterns already shipped by `@arnilo/prism-session-store-postgres`.
- Preserve domain contracts instead of adding a generic key/value state layer.
- Keep core dependency-free and every PostgreSQL adapter explicitly installed/opened by the host.

## Expected Outcome

- New optional `@arnilo/prism-enterprise-postgres` package opens one bounded PostgreSQL composition exposing policy, evaluation, work-idempotency, and model-router stores over a host pool/schema.
- Enterprise tables use a separate checksum-protected migration history so existing session-store schema-v5/SQLite parity is unchanged.
- Policy/evaluation rows survive reopen and remain exact-owner cursor-queryable.
- Work mutations use an atomic claim/CAS state machine: `in_progress`, `completed`, `failed_retryable`, `failed_terminal`, or `unknown`; an absent row represents `absent`.
- Model-router rate, budget, and circuit operations are asynchronous and atomic across clients; one half-open circuit probe wins; cleanup/expiry and key caps are deterministic.
- Memory/file adapters remain available and are labeled development/single-process; no Redis/Kafka, ORM, background daemon, or Phase 7 generic tool-effect API ships.
- PostgreSQL conformance, restart, multi-client contention, migration drift, query-plan, cleanup, storage-growth, and p95 evidence pass for 0.0.23.

## Tasks

- [x] Task 0 — Primitive/package review, adversarial test matrix, and public API freeze
  - Acceptance Criteria:
    - Functional: inventory maps current `PolicyDecisionStore`, `EvaluationStore`, `IdempotencyStore`, model-router maps/methods, PostgreSQL pool/options/identifier/migration helpers, schema-v5 contract, and package/profile boundaries to every Phase 6 requirement.
    - Functional: freeze records exact package name, exports, store method signatures, ownership shape, idempotency transitions/CAS rules, router async migration, expiry/cleanup rules, migration table/name/checksum rules, table/index names, and error behavior before production code starts.
    - Functional: freeze explicitly keeps Phase 7 durable `AgentEvent` delivery and generic tool-effect recovery out of scope; work-tool unknown-outcome state remains domain-specific.
    - Performance: freeze names benchmark volumes, concurrency, cleanup batch caps, p95 ceilings, maximum key/row/result sizes, and required `EXPLAIN` plans before schema implementation.
    - Code Quality: review rejects a universal KV abstraction, ORM, Redis-first adapter, session-schema/SQLite expansion, and four separate `pg` dependencies in owning domain packages; any deviation requires recorded evidence.
    - Security: freeze requires verified/exact ownership at every durable read/write, bound SQL values, validated schema identifiers, fixed table names, bounded JSON, redacted errors, and no prompts/tool bodies/JWTs/credentials in new rows.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 6, Product Boundaries, Priority Rules, and Phase Planning Workflow.
      - `docs/policy-and-audit.md`, `docs/evaluations.md`, `docs/work-tools.md`, `docs/model-routing.md`, `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/host-security.md`, `docs/migration.md`.
      - `packages/policy/src/{types,store,prepare}.ts`, `packages/evals/src/{types,store}.ts`, `packages/work-tools/src/{types,idempotency,tools}.ts`, `packages/model-router/src/{types,router}.ts`.
      - `packages/session-store-postgres/src/{types,identifiers,migrations,ddl,persistence,checkpoints,leases}.ts` and PostgreSQL integration tests.
      - Current PostgreSQL docs: `INSERT ... ON CONFLICT` (<https://www.postgresql.org/docs/current/sql-insert.html>), explicit/row locks (<https://www.postgresql.org/docs/current/explicit-locking.html>), transaction isolation/retry (<https://www.postgresql.org/docs/current/transaction-iso.html>), partial indexes (<https://www.postgresql.org/docs/current/indexes-partial.html>), advisory locks (<https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS>), and `EXPLAIN` (<https://www.postgresql.org/docs/current/using-explain.html>).
      - `pg@^8.22.0` local package contract and node-postgres transaction guidance: <https://node-postgres.com/features/transactions>.
    - Options Considered:
      - Put adapters in each owning package: preserves ownership but makes four packages install `pg` and duplicates migration lifecycle; reject.
      - Expand `@arnilo/prism-session-store-postgres`: reuses lifecycle but forces policy/evals/work/router dependencies onto every session-store user; reject.
      - Add generic SQL/KV state store: compact initially but erases domain atomicity, retention, and bounded payload rules; reject.
      - Add `@arnilo/prism-enterprise-postgres` with concrete domain stores and private shared SQL helpers: chosen; one explicit dependency boundary and no core/SQLite schema change.
    - Chosen Approach:
      - Freeze one async `createPostgresEnterpriseState(options)` composition with four concrete properties and `close()` ownership matching `createPostgresPersistence`.
      - Reuse exported schema identifier helpers and `pg` pool conventions; use package-local `prism_enterprise_migrations` because adding unknown rows to `prism_migrations` would make current session-store verification fail closed.
      - Add generic **domain conformance fixtures**, not a generic persistence API, under each owning package's testing surface or package tests.
      - Require durable router mode to use `router.resolve()` and awaited async accounting; sync `providerSource` stays supported only with memory state and fails closed when an async external store is configured.
    - API Notes and Examples:
      ```ts
      import { createPostgresEnterpriseState } from "@arnilo/prism-enterprise-postgres";

      const enterprise = await createPostgresEnterpriseState({ pool, schema: "prism" });
      await enterprise.policy.append(input);
      await enterprise.evaluations.append(record);
      await enterprise.workIdempotency.begin(claim);
      const router = createModelRouter({ resolver, stateStore: enterprise.modelRouter });
      ```
    - Files to Create/Edit:
      - `plans/006-Release-0-0-23-Production-Enterprise-State-Adapters.md`: Task 0 inventory/freeze evidence.
      - No production files in Task 0.
    - References:
      - `packages/model-router/src/router.ts:108-132,163-165,353-404`: process-local maps, LRU eviction, sync facade/accounting.
      - `packages/work-tools/src/tools.ts:61-98`: non-atomic get → external effect → completed put window.
      - `packages/session-store-postgres/src/migrations.ts`: transaction + `pg_advisory_xact_lock` + checksum/shape verification pattern.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - Freeze checklist: every Phase 6 functional/security/performance criterion maps to one contract, table/index, transaction, migration, or explicit non-goal.
    - API compile fixture: intended public imports and async signatures typecheck before adapters are implemented.
    - Adversarial matrix: same-key races, stale CAS tokens, expired claims, half-open stampede, wrong owner, nullable ownership dimensions, malicious identifiers/values, migration checksum drift, serialization/deadlock retry, cleanup races, and clock boundaries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; review/freeze only. Later tasks implement frozen surfaces.
    - Docs pages to create/edit: none in Task 0.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (applies to Tasks 1–7).

### Task 0 completion evidence — 2026-08-03

No production API or package shipped in Task 0. This is the binding implementation freeze for Tasks 1–7.

#### Primitive and package inventory

| Phase 6 need | Existing primitive reviewed | Frozen reuse/boundary |
| --- | --- | --- |
| Policy decisions | `packages/policy/src/{types,prepare,store,limits}.ts` | Keep `PolicyDecisionStore`; PostgreSQL invokes `preparePolicyDecision` before insert, preserves policy limits and exact scope semantics. Memory/JSONL remain reference adapters. |
| Evaluation records | `packages/evals/src/{types,store,util,limits}.ts` | Keep `EvaluationStore`; PostgreSQL preserves append/query fields and capped pages. It rejects durable rows/queries without nonblank `tenantId`; account/user nullability is exact, never prefix matching. |
| Work mutations | `packages/work-tools/src/{types,idempotency,tools,limits}.ts` | Replace unsafe read → external effect → `put` path with domain claim/CAS contract. Do not reuse generic `LeaseStore`: result/status/recovery semantics are work-specific. |
| Router governance | `packages/model-router/src/{types,router,limits}.ts` | Replace three closure `Map`s with narrow async `ModelRouterStateStore`; keep resolver/allow-list/residency/diagnostics policy in router package. |
| PostgreSQL lifecycle | `packages/session-store-postgres/src/{types,identifiers,migrations,ddl,persistence,leases}.ts` and integration suite | Reuse `pg` pool ownership, `qualifyTable`, advisory transaction lock, ordered SHA-256 history, catalog-shape verification, `IS NOT DISTINCT FROM`, cursor/index, and `PRISM_TEST_POSTGRES_URL` patterns. Do not reuse its `prism_migrations` history or alter schema-v5/SQLite. |
| Package/profile boundary | root workspace globs, `packages/session-store-postgres/package.json`, `packages/prism-all/package.json` | Add one optional package at `packages/enterprise-postgres`, not four `pg`-owning domain packages and not `session-store-postgres`. It adds explicit root workspace entry `packages/enterprise-postgres`, joins `prism-all` only, and leaves core/base/code/sdk/providers unchanged. |

`pg@^8.22.0` documentation was resolved through Context7 (`/brianc/node-postgres`): every transaction checks out one client, uses that client for `BEGIN`/statements/`COMMIT` or `ROLLBACK`, then releases it; `pool.query` is forbidden inside a transaction; `pool.end()` closes only an adapter-owned pool. PostgreSQL references listed in Task 0 were reviewed for `ON CONFLICT`, row/advisory locks, retry-on-serialization, partial indexes, and `EXPLAIN`.

#### Package and public export freeze

- Package: `@arnilo/prism-enterprise-postgres`, directory `packages/enterprise-postgres`, root export only; side-effect-free import; Node `>=20`.
- Runtime dependencies: exact `0.0.23` dependencies on `@arnilo/prism-policy`, `@arnilo/prism-evals`, `@arnilo/prism-work-tools`, `@arnilo/prism-model-router`, plus `pg@^8.22.0`; peer/development dependency on `@arnilo/prism@0.0.23` and development `@types/pg`. No domain package gains `pg`.
- `@arnilo/prism-all` gets one exact `@arnilo/prism-enterprise-postgres: "0.0.23"` dependency; publishable package count becomes **47**. Installation never opens a connection; host explicitly calls factory.
- Public values: `createPostgresEnterpriseState`; public types: `PostgresEnterpriseStateOptions`, `PostgresEnterpriseState`, `EnterpriseStateCleanupInput`, `EnterpriseStateCleanupResult`, `EnterprisePostgresError`. No public SQL/queryable/DDL/codec/migration subpath.

```ts
export interface PostgresEnterpriseState {
  readonly policy: PolicyDecisionStore;
  readonly evaluations: EvaluationStore;
  readonly workIdempotency: IdempotencyStore;
  readonly modelRouter: ModelRouterStateStore;
  cleanup(input: EnterpriseStateCleanupInput): Promise<EnterpriseStateCleanupResult>;
  close(): Promise<void>;
}
export function createPostgresEnterpriseState(options: PostgresEnterpriseStateOptions): Promise<PostgresEnterpriseState>;
```

`PostgresEnterpriseStateOptions` matches existing PostgreSQL factory ownership: exactly one of `pool` or `connectionString`; optional validated `schema` (default `"prism"`), `poolMax` (default `10`), `poolConfig`, and test-only `skipMigrations`. Existing pools remain host-owned; `close()` ends only a factory-created pool. `cleanup` requires one exact normalized ownership scope and an optional `limit`; it has no timer, worker, or unrestricted cross-tenant sweep.

#### Domain contract freeze

- **Ownership:** durable policy/evaluation rows use `tenantId`, `accountId?`, `userId?`; work/router also persist `principalId`. Inputs reject blank identifiers. PostgreSQL stores optional account/user as normalized non-null keys and compares every component exactly (`IS NOT DISTINCT FROM` equivalent). Policy keeps its current stricter tenant plus account-or-user requirement. Policy/work/router require active `verified: true` identity at their trust boundary; evaluation records/queries must be host-projected from verified ownership and PostgreSQL rejects absent tenant scope.
- **Policy/evaluation:** no generic persistence interface and no record-shape expansion. Policy/evaluation public contracts remain their existing names/signatures. PostgreSQL query cursors are opaque bounded base64url JSON containing version, exact owner, order, timestamp, and id; a malformed, order-mismatched, or foreign-owner cursor returns the current bounded cursor/store error without disclosing another row. Returned rows are deep-frozen.
- **Work idempotency:** retain export name `IdempotencyStore`, replace `IdempotencyRecord`/`put` with the following async domain contract. `get` is reconciliation-only; normal execution starts with `begin`.

```ts
type WorkMutationStatus = "in_progress" | "completed" | "failed_retryable" | "failed_terminal" | "unknown";
type WorkMutationResult = { readonly draftId: string; readonly resourceId?: string };
type WorkMutationFailure = { readonly code: string; readonly reference?: string };

interface WorkMutationRecord extends OwnershipScope {
  readonly principalId: string; readonly key: string; readonly op: string;
  readonly status: WorkMutationStatus; readonly attempt: number; readonly version: number;
  readonly claimToken?: string; readonly result?: WorkMutationResult; readonly failure?: WorkMutationFailure;
  readonly createdAt: string; readonly updatedAt: string; readonly expiresAt?: string;
}
interface IdempotencyStore {
  get(input: WorkMutationKey): Promise<WorkMutationRecord | undefined>;
  begin(input: WorkMutationBeginInput): Promise<{ readonly outcome: "acquired" | "existing"; readonly record: WorkMutationRecord }>;
  complete(input: WorkMutationTransitionInput & { readonly result: WorkMutationResult }): Promise<WorkMutationRecord>;
  fail(input: WorkMutationTransitionInput & { readonly status: "failed_retryable" | "failed_terminal"; readonly failure: WorkMutationFailure }): Promise<WorkMutationRecord>;
  markUnknown(input: WorkMutationTransitionInput & { readonly failure?: WorkMutationFailure }): Promise<WorkMutationRecord>;
  resolveUnknown(input: WorkMutationKey & { readonly expectedVersion: number; readonly status: "failed_retryable" | "failed_terminal"; readonly failure?: WorkMutationFailure }): Promise<WorkMutationRecord>;
}
```

`WorkMutationKey` contains exact normalized ownership plus `principalId`, `key`, `op`, and optional signal. `WorkMutationBeginInput` adds active verified `identity`, `claimTtlMs`, and `maxAttempts`. `WorkMutationTransitionInput` adds `claimToken` and `expectedVersion`. Absent is represented only by `get() === undefined`; `begin` atomically creates `in_progress` or returns existing state. Only a matching current claim token/version transitions in-progress. Completed/terminal never replay; retryable can acquire until maximum attempts; expired in-progress becomes `unknown`; only explicit `resolveUnknown` can move it to retryable/terminal. The external effect remains outside the transaction: no exactly-once claim.

- **Router:** add optional `stateStore?: ModelRouterStateStore` to `CreateModelRouterOptions`. `ModelRouterStateStore` owns only `consumeRate`, `readBudget`, `addUsage`, `claimCircuitProbe`, `recordCircuitOutcome`, and exact-owner bounded `cleanup`; each takes an exact verified identity-derived owner + provider/model key and returns an awaitable domain result, never SQL rows. `ModelRouter.recordUsage` and `recordOutcome` become `Promise<void>` and take `identity: AgentIdentity` rather than `identityKey`; `resolve` already returns a promise and requires identity when `stateStore` exists. `providerSource` remains available only without `stateStore`; with one it throws `ModelRouterError` with code `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE` before resolver I/O. Router state failure is `ERR_PRISM_MODEL_ROUTER_STATE`; existing deny codes remain stable.
- **Router state rules:** allow-list/residency/budget checks occur before provider resolution; rate consumption precedes circuit probe claim, preserving a conservative denial charge. Rate uses database-clock fixed windows; budgets use database-clock 24-hour windows (`budgets.windowMs` additive, default 24h, hard 31d); circuit cooldown retains current defaults (3 failures, 30s). A cooled circuit grants exactly one probe token; successful probe closes it, failed/expired probe reopens it. Rate rows expire at window end; budget/circuit rows clean up only after window/idle expiry. At `maxCircuitKeys`, cleanup evicts expired then idle closed rows by `(last_used_at, key)`; it never evicts active/open/claimed rows and returns a typed capacity error if none are eligible.

#### Migration/schema/error freeze

- Enterprise migrations are separate: table `prism_enterprise_migrations`; one ordered step `{ name: "001_enterprise_state", version: "1" }`; SHA-256 is computed from canonical checked-in migration content and stored before runtime writes. Unknown, duplicate, out-of-order, partial, checksum, or catalog drift fails closed. No legacy-null checksum compatibility applies to a new table.
- Migration holds `pg_advisory_xact_lock` for schema plus enterprise namespace, runs DDL/history insert/check in one checked-out client transaction, then verifies every expected table/column/nullability/PK/unique/check/index from catalog. Runtime multi-statement mutations retry whole transaction at most **3** total attempts on SQLSTATE `40001` or `40P01`, otherwise surface bounded `EnterprisePostgresError`; no retry wraps connector/provider I/O.
- Fixed table names: `prism_policy_decisions`, `prism_evaluations`, `prism_work_idempotency`, `prism_model_router_budgets`, `prism_model_router_rates`, `prism_model_router_circuits`, and `prism_enterprise_migrations`. All runtime values use parameters; only validated schema plus fixed identifiers enter SQL text.
- Required named indexes: `prism_policy_decisions_owner_created_idx`, `prism_policy_decisions_owner_policy_created_idx`, `prism_policy_decisions_owner_outcome_created_idx`; `prism_evaluations_owner_created_idx`, `_owner_scorer_created_idx`, `_owner_session_created_idx`, `_owner_run_created_idx`, `_owner_experiment_created_idx`, `_owner_dataset_item_created_idx`; `prism_work_idempotency_expiry_idx`; `prism_model_router_budgets_expiry_idx`, `_rates_expiry_idx`, `_circuits_expiry_idx`. Work uniqueness is exact owner/principal/key; router rows are exact owner/principal/provider/model plus window where applicable.
- Error codes are redacted and stable: `ERR_PRISM_ENTERPRISE_POSTGRES_{CONFIG,MIGRATION,SCHEMA,OWNERSHIP,BOUNDS,CONFLICT,RETRYABLE}` and work-specific `ERR_PRISM_WORK_{IDEMPOTENCY,IDEMPOTENCY_CONFLICT,IDEMPOTENCY_UNKNOWN}`. Foreign rows, stale tokens/versions, and malformed cursors share non-enumerating bounded errors.

#### Bounds, cleanup, benchmark, and adversarial matrix freeze

- Bounded storage: policy retains existing 64 KiB hard record cap; evaluation row 64 KiB (reason/error 8 KiB each, metadata 32 KiB); work row 8 KiB (key 2 KiB, `draftId`/`resourceId` 512 bytes each, reference 1 KiB, error code 128 bytes); router provider/model/key material 512 bytes each. No prompt, message, tool body/arguments, recipient, raw CLI/provider response, JWT, credential, or secret is accepted in any new row.
- Cleanup defaults/hard caps: 100/500 rows per call, stable oldest-first batches, explicit host call only. Work claim TTL defaults to 15m (hard 60m); `maxAttempts` defaults to existing `maxRetries + 1` (3; hard 5). Completed/terminal/retryable records retain 30d by default (hard 365d); unknown records never auto-delete. Cleanup converts expired in-progress work/probe claims to unknown/reopened state before deletion decisions.
- Protected benchmark fixture: 10 tenants × 10 principals × 1,000 policy/evaluation rows (100k each); 10k router keys; 16 independent clients; 1,000 measured warm operations after 100 warmups; cleanup batch 100. Publish median/p95/throughput, exact accepted rate count, exact budget sum, one-probe count, and pre/post-cleanup row count. p95 ceiling is 50ms for indexed point append/claim/transition/rate/budget/circuit operations and 100ms for a 100-item owned cursor page or cleanup batch on recorded CI hardware; failures update neither baseline nor ceiling without review.
- Required `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` evidence after `ANALYZE`: owned policy default/policy/outcome cursor pages; owned evaluation scorer/run/experiment/dataset-item cursor pages; work claim and expiry cleanup; router rate/budget/circuit lookup and expiry cleanup. Expected named index is used; no sequential scan for these seeded selective paths.

| Adversarial case | Required outcome |
| --- | --- |
| Two pools begin same work key; stale token/version; owner/op mismatch | One claim/effect; stale/foreign transition fails without state disclosure. |
| Crash before claim, after claim, during dispatch, after external success/before complete, after complete | Only safe retryable failures replay; ambiguous dispatch becomes durable `unknown`; never claim exactly once. |
| Budget/rate/circuit contention; cooldown boundary; abandoned probe | Exact counters/admissions; one half-open probe; database clock, restart, and cleanup preserve rules. |
| Null account/user combinations, foreign cursor, missing/wrong identity | Exact `IS NOT DISTINCT FROM` isolation; no prefix/null leakage; durable router/work fails before resolver/effect. |
| Identifier/value injection, oversized/deep JSON, secret-shaped values, malformed stored JSON | Identifier/config rejection or bound-value/domain error; no SQL injection, secret persistence, or unbounded error. |
| Concurrent migration, checksum/history/catalog drift, `40001`/`40P01`, cleanup race | Serialized migrate/reopen; fail closed on drift; bounded whole-transaction retry; no active row silently deleted. |

Validation run: plan-structure assertion confirms 8 tasks and all mandatory task sections; `git diff --check` passes. Task 0 intentionally adds no compile fixture because the frozen package/types do not exist yet; Task 1 owns the first typechecked fixture and Task 2 owns package/migration tests.

- [x] Task 1 — Evolve domain contracts and memory conformance before SQL
  - Acceptance Criteria:
    - Functional: work-tools replaces `get`/`put(result: unknown)` with atomic claim/transition semantics capable of representing `in_progress`, `completed`, `failed_retryable`, `failed_terminal`, and `unknown`; missing record remains `absent`.
    - Functional: claims carry exact owner/principal, operation, key, bounded result summary/reference, attempt, timestamps/expiry, opaque claim token, and version; complete/fail/unknown transitions require expected token/version and legal prior state.
    - Functional: model-router gains a narrow `ModelRouterStateStore` covering rate-window consume, budget read/add, circuit inspect/record with one half-open probe, and bounded cleanup; memory implementation preserves default single-process behavior.
    - Functional: `createModelRouter` awaits external state in `resolve`, `recordUsage`, and `recordOutcome`; sync `providerSource` remains memory-only and throws a typed configuration error when external async state is configured.
    - Performance: memory operations are O(1) except deterministic capped cleanup/oldest eviction; records and keys retain frozen byte/count limits.
    - Code Quality: conformance tests describe behavior independently of PostgreSQL; no DB vocabulary appears in domain interfaces.
    - Security: durable-capable paths require verified exact identity/ownership; records reject unrestricted payload fields/non-finite usage and never accept secrets or raw connector responses.
  - Approach:
    - Documentation Reviewed:
      - Current domain docs/source from Task 0.
      - Existing `LeaseStore`/`CheckpointStore` CAS/fencing semantics in core and `packages/session-store-postgres/src/{leases,checkpoints}.ts` as naming/typed-error references only.
      - PostgreSQL transaction isolation retry requirement: <https://www.postgresql.org/docs/current/transaction-iso.html>.
    - Options Considered:
      - Keep work `get`/`put` and rely on unique insert after effect: cannot identify concurrent in-progress or unknown outcome; reject.
      - Reuse generic `LeaseStore` for work mutations/router circuits: loses operation/result/status semantics; reject.
      - Domain-specific CAS contracts plus memory implementations/conformance: chosen.
    - Chosen Approach:
      - Define legal idempotency transitions once in work-tools and make connector execution call `begin` before side effect, then `complete` or classified failure/unknown after dispatch.
      - Store only fixed `WorkMutationResult` summary fields (`draftId`, optional `resourceId`) and bounded references; state remains on the record; remove public unrestricted `result: unknown`.
      - Define router state operations around atomic domain actions rather than exposing rows or generic `get/set`.
      - Keep memory router as default; make accounting methods Promise-returning uniformly so callers can safely `await` either adapter.
    - API Notes and Examples:
      ```ts
      const claim = await store.begin({ identity, key, op, claimTtlMs: 15 * 60_000, maxAttempts: 3 });
      if (claim.outcome === "acquired" && claim.record.claimToken) {
        await store.complete({ ...claim.record, claimToken: claim.record.claimToken, expectedVersion: claim.record.version, result });
      }

      await router.recordUsage({ identity, provider: "openai", model: "gpt", tokens: 42 });
      await router.recordOutcome({ identity, provider: "openai", model: "gpt", success: false });
      ```
    - Files to Create/Edit:
      - `packages/work-tools/src/{types,idempotency,tools,errors,index}.ts`, `packages/work-tools/src/__tests__/work-tools.test.ts`, README/CHANGELOG later finalized in Task 7.
      - `packages/model-router/src/{types,state,router,errors,index}.ts`, `packages/model-router/src/__tests__/model-router.test.ts`, README/CHANGELOG later finalized in Task 7.
      - Optional package-local `src/testing.ts` exports only if Task 0 freezes public adapter conformance; otherwise keep fixtures test-private.
    - References:
      - `packages/work-tools/src/types.ts:129-141`; `packages/work-tools/src/idempotency.ts`.
      - `packages/model-router/src/types.ts:106-118`; `packages/model-router/src/router.ts`.
  - Test Cases to Write:
    - Work memory conformance: absent → acquired/in-progress → completed; duplicate complete; retryable reacquire; terminal deny; claim expiry → unknown; stale token/version; different owner/key isolation; bounded result/reference.
    - Connector execution: only one concurrent caller invokes `runOp`; completed duplicate returns same bounded summary; pre-dispatch failure is retryable/terminal as classified; post-dispatch ambiguity is unknown and never auto-replayed.
    - Router memory conformance: exact concurrent budget increments; fixed-window rate boundary; open → single half-open probe → close/reopen; TTL/cleanup; max-key deterministic eviction.
    - Compatibility: default memory router still resolves existing fixtures; callers awaiting new Promise methods pass; external state + `providerSource` fails before provider resolution.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; work idempotency and model-router state/accounting signatures change.
    - Docs pages to create/edit: `docs/work-tools.md`, `docs/model-routing.md`, `docs/migration.md` in Task 7; package READMEs/CHANGELOGs.
    - `docs/index.md` update: yes in Task 7; Work tools and Model routing descriptions gain durable state/CAS notes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 1 completion evidence — 2026-08-03

- Replaced work-tools `IdempotencyRecord`/`put(result: unknown)` with exported `WorkMutation*` claim/CAS types and `IdempotencyStore` `get`/`begin`/`complete`/`fail`/`markUnknown`/`resolveUnknown` methods. Memory state validates active verified identity, exact owner/principal/key/op, caps fields, freezes records, atomically claims, enforces version/token, turns expiry into `unknown`, and permits explicit terminal/retryable reconciliation only.
- `executeApprovedMutation` now claims after approval and before `runOp`; only completed records return duplicate summaries. Credential failures become retryable, terminal pre-effect `WorkToolError`s become terminal, and ambiguous connector failures become durable `unknown` rather than replaying.
- Added exported `ModelRouterStateStore` and `createMemoryModelRouterStateStore` in `packages/model-router/src/state.ts`. Router now awaits rate/budget/circuit operations; `recordUsage`/`recordOutcome` require active identity and return promises; external state requires identity and makes `providerSource` fail with `ERR_PRISM_MODEL_ROUTER_ASYNC_STATE`. Memory state has exact owner/model keys, fixed-window accounting, one probe token, capped closed-state eviction, bounded cleanup, and a fixed 24-hour closed-state retention ceiling (`ponytail:` comment records upgrade path).
- Added package-local conformance coverage for work claim/CAS/expiry/unknown/concurrency/bounds and router durable identity/rate/budget/half-open/abandoned-probe/cleanup/cap behavior. No PostgreSQL or documentation changes were made; those remain Tasks 2 and 7.
- Validation passed: `npm run typecheck`, `npm run build`, and `npm test` for both `@arnilo/prism-work-tools` and `@arnilo/prism-model-router`; `npx biome format --write` on touched files; `git diff --check`.

- [x] Task 2 — Create PostgreSQL package, migration lifecycle, tables, codecs, and cleanup
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-enterprise-postgres` is side-effect-free on import; `createPostgresEnterpriseState({ pool | connectionString, schema, poolMax, poolConfig, skipMigrations? })` explicitly opens/migrates and returns the frozen composition shape plus ownership-aware `cleanup()` and `close()`. The router slot fails closed until Task 5 installs its concrete SQL adapter; Task 4 supplies work idempotency.
    - Functional: migrations create policy, evaluation, work-idempotency, router-budget, router-rate, and router-circuit tables plus `prism_enterprise_migrations`; reopen is idempotent and concurrent open serializes per schema.
    - Functional: migration history is ordered/checksummed and full expected table/column/key/index shape is verified before runtime writes; unknown, duplicate, out-of-order, partial, checksum, and catalog drift fail closed.
    - Functional: cleanup uses database time and capped ordered batches; active claims/half-open probes are transitioned, not silently deleted; completed/terminal retention and expired router rows follow frozen deterministic rules.
    - Performance: all runtime lookup/transition/cleanup predicates have matching composite/partial indexes; migration catalog checks are bounded metadata queries; no timer or cleanup worker starts automatically.
    - Code Quality: package reuses `quoteIdentifier`/`qualifyTable`, pool ownership conventions, and migration error style; shared SQL helpers are private and only used where semantics match.
    - Security: schema is validated, runtime values are bound, table names fixed, optional existing pool remains caller-owned, adapter-owned pool is bounded/TLS-host-configured, and stored JSON is size/depth validated before insert.
  - Approach:
    - Documentation Reviewed:
      - `packages/session-store-postgres` package layout and `src/{types,identifiers,migrations,ddl,persistence}.ts`.
      - Official PostgreSQL advisory locks, constraints, partial indexes, and date/time docs: <https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS>, <https://www.postgresql.org/docs/current/ddl-constraints.html>, <https://www.postgresql.org/docs/current/indexes-partial.html>, <https://www.postgresql.org/docs/current/functions-datetime.html>.
    - Options Considered:
      - Add enterprise steps to shared `prism_migrations`: existing session-store rejects unknown steps and would force SQLite tables; reject.
      - Run unchecked `CREATE TABLE IF NOT EXISTS` on every factory call: cannot detect drift; reject.
      - Separate `prism_enterprise_migrations` with same advisory/checksum/catalog discipline: chosen.
    - Chosen Approach:
      - Use one package-local migration `001_enterprise_state`; fixed SHA-256 is derived from canonical checked-in schema description.
      - Lock on schema plus enterprise-specific namespace using `pg_advisory_xact_lock`; perform migration and history insert in one transaction.
      - Use non-null normalized ownership key columns where nullable account/user dimensions participate in uniqueness, avoiding PostgreSQL NULL-distinct duplicate holes.
      - Keep Task 2 to shared lifecycle/schema/cleanup infrastructure; expose fail-closed composition slots rather than preemptively implementing partial policy, evaluation, work, or router stores owned by Tasks 3–5.
      - Export composition/factory and public option/result types only; keep DDL/codecs/catalog readers private.
    - API Notes and Examples:
      ```sql
      BEGIN;
      SELECT pg_advisory_xact_lock($1, $2);
      CREATE TABLE IF NOT EXISTS "prism"."prism_work_idempotency" (...);
      INSERT INTO "prism"."prism_enterprise_migrations"
        (id, name, version, checksum, applied_at) VALUES ($1,$2,$3,$4,clock_timestamp());
      COMMIT;
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`.
      - `packages/enterprise-postgres/src/{index,types,enterprise,identifiers,ddl,migrations,codecs,cleanup,errors}.ts`.
      - `packages/enterprise-postgres/src/__tests__/{migrations,package}.test.ts` and PostgreSQL integration fixture file(s).
      - Root `package.json` workspace list adds `packages/enterprise-postgres`; `package-lock.json` records it.
    - References:
      - `packages/session-store-postgres/src/migrations.ts` and `src/types.ts`.
      - `packages/session-store-postgres/src/ddl.ts` named-table/index pattern.
  - Test Cases to Write:
    - Import/open/close: inert import; caller-owned pool not closed; adapter-owned pool closes; invalid schema/pool limits fail before SQL.
    - Migration: first open, reopen, three-client concurrent open, checksum drift, unknown/out-of-order row, missing column/index/constraint, rollback after injected DDL/history failure.
    - Cleanup: below/at/above expiry; capped stable order; concurrent cleanup; active claim conversion to unknown; no wrong-owner/global sweep beyond explicit host scope.
    - Static SQL gate: no interpolated runtime values; only validated schema + fixed identifiers appear in SQL text.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional package/factory/options/store composition and schema lifecycle.
    - Docs pages to create/edit: create `docs/enterprise-postgres-state.md`; edit `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/host-security.md`, `docs/migration.md` in Task 7.
    - `docs/index.md` update: yes in Task 7; add Enterprise PostgreSQL state under Persistence/Governance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 2 completion evidence — 2026-08-03

- Added side-effect-free `@arnilo/prism-enterprise-postgres` package, root workspace/lockfile entry, and `@arnilo/prism-all` dependency. Root-only exports are `createPostgresEnterpriseState`, its frozen types, and `EnterprisePostgresError`; no SQL, DDL, codec, migration, or queryable subpath is exported.
- Factory validates exactly one pool source, schema, and bounded pool size before SQL; it uses a caller-owned pool without ending it, closes only an adapter-owned pool, and runs package-local migrations unless test-only `skipMigrations` is set. All store slots initially failed closed so Task 2 could not ship partial writes; Tasks 3–5 now replace policy/evaluation/work/router slots.
- Added canonical SHA-256 `001_enterprise_state`, separate `prism_enterprise_migrations`, enterprise advisory-lock namespace, serial client transaction discipline, ordered history checks, and full catalog verification of every fixed table, column, key, index, and partial-index predicate. Migration/history/catalog failures return bounded typed errors and roll back/release the client.
- Added fixed policy/evaluation/work/router tables and required owner/query/expiry indexes. Account/user columns use non-null normalized keys. Private JSON codecs validate byte/depth/property/finite-value bounds before encode and after decode.
- Added explicit exact-owner cleanup with database `clock_timestamp()`, stable capped `FOR UPDATE SKIP LOCKED` batches, expired work claim → `unknown`, expired circuit probe → reopened, and retained work/expired router deletion. There is no timer or global sweep.
- Validation passed: package Biome format/lint, typecheck, build, unit tests, dry-run pack, and PostgreSQL integration tests against disposable `postgres:16-alpine` (migration/reopen/three-pool locking/checksum+catalog drift/rollback/owner-isolation/bounded concurrent cleanup/claim+probe transitions). Documentation remains Task 7.

- [x] Task 3 — Implement PostgreSQL policy and evaluation stores
  - Acceptance Criteria:
    - Functional: PostgreSQL policy store implements existing append/query semantics, `preparePolicyDecision` validation/version pinning, duplicate rejection, exact ownership, filters/order/cursor/limit, restart persistence, and immutable returned records.
    - Functional: PostgreSQL evaluation store implements append/query semantics for every current filter/status shape, duplicate rejection, exact ownership, stable `(created_at,id)` cursor pages, restart persistence, and immutable/deep-frozen decoded records.
    - Functional: concurrent duplicate IDs produce one committed row and deterministic domain errors; wrong-owner cursor use fails as unknown/invalid without revealing row existence.
    - Performance: owner/time plus policy/outcome and scorer/run/experiment/dataset query shapes use matching indexes and `LIMIT n+1`; no exact `COUNT(*)` is required on hot paths and no in-memory full-table pagination occurs.
    - Code Quality: row codecs preserve current public records exactly; policy uses exported validation primitives rather than reimplementing them; evaluation validation shared by memory/PostgreSQL is added only if Task 0 proves current append boundary insufficient.
    - Security: ownership is required in SQL predicates, all values bound, policy evaluator-only context is never stored, evaluation records are already redacted/bounded, and malformed stored JSON fails closed with bounded errors.
  - Approach:
    - Documentation Reviewed:
      - `docs/policy-and-audit.md`, `docs/evaluations.md`; package sources and limits.
      - PostgreSQL `INSERT ... ON CONFLICT` deterministic behavior: <https://www.postgresql.org/docs/current/sql-insert.html>.
      - Cursor/index guidance in `docs/database-persistence.md` and `packages/session-store-postgres/src/persistence.ts` `queryTable`.
    - Options Considered:
      - Store whole records as one JSON blob: easiest but weak indexes/shape checks; reject.
      - Normalize every nested policy/evaluation field: excessive schema with no query demand; reject.
      - Fixed indexed scalar columns plus bounded JSON only for existing nested actor/target/error/metadata fields: chosen.
    - Chosen Approach:
      - Use unique primary IDs and owner-prefixed composite query indexes; perform duplicate handling via insert constraint, not check-then-insert.
      - Encode actor/target/evidence and evaluation error/metadata as bounded JSON; decode and deep-freeze.
      - Use cursor tuples containing timestamp+id+owner binding (opaque bounded encoding frozen in Task 0), not bare IDs that require full result scans.
    - API Notes and Examples:
      ```ts
      const { policy, evaluations } = await createPostgresEnterpriseState({ pool });
      const page = await policy.query({ tenantId: "t1", userId: "u1", order: "desc", limit: 50 });
      const scores = await evaluations.query({ tenantId: "t1", runId: "run-1", status: "scored" });
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/src/{enterprise,policy,evaluations,records,codecs,errors}.ts`: wire concrete stores; keep shared exact-owner/cursor/decode helpers package-private.
      - `packages/enterprise-postgres/src/__tests__/{stores,stores.integration}.test.ts` plus existing package integration coverage.
      - Root `package.json`: add enterprise PostgreSQL integration suite to `test:postgres`.
      - `packages/policy/src/{prepare,store,types,index}.ts` only if shared validation/cursor conformance freeze requires a minimal export/change; not needed because policy already exports `preparePolicyDecision`.
      - `packages/evals/src/{store,types,util,index}.ts` only if validation/conformance reuse requires it; not needed because strict production row validation remains adapter-private and does not alter memory behavior.
    - References:
      - `packages/policy/src/store.ts`; `packages/policy/src/prepare.ts`.
      - `packages/evals/src/store.ts`; `packages/evals/src/util.ts`.
  - Test Cases to Write:
    - Policy: append/reopen; all filters/orders; pagination no overlap; duplicate race across pools; required policy version; malicious text; wrong tenant/account/user; cursor owner/order tamper.
    - Evaluation: append/reopen; every query field/status array; same timestamp stable pagination; duplicate race; non-finite/oversize malformed records; deep-freeze; wrong-owner denial.
    - Query plans: seeded table `EXPLAIN (FORMAT JSON)` shows expected owner/cursor indexes and no sequential scan for frozen representative production queries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new production implementations of two public store contracts.
    - Docs pages to create/edit: `docs/policy-and-audit.md`, `docs/evaluations.md`, `docs/enterprise-postgres-state.md`, package README/CHANGELOG in Task 7.
    - `docs/index.md` update: yes in Task 7; Governance and Evaluations entries mention PostgreSQL adapter.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 3 completion evidence — 2026-08-03

- Replaced the policy/evaluation fail-closed composition slots with concrete `createPostgresPolicyDecisionStore` and `createPostgresEvaluationStore` adapters; Tasks 4–5 subsequently replace work idempotency and router state. No public SQL/DDL/queryable subpath was added.
- Policy appends route through exported `preparePolicyDecision`, preserving verified-identity projection, ownership, version/value validation, payload denial, immutable prepared records, and current bounds. Inserts are parameterized and unique-ID races return `PolicyError(ERR_PRISM_POLICY_DUPLICATE)`. Owner-exact `(created_at,id)` pages use bounded opaque owner/order-bound cursors and `LIMIT n+1`; decoded actor/target/evidence data is shape-checked and deeply frozen.
- Evaluation appends require host-projected tenant ownership, reject unsupported fields/non-finite or missing scored values, cap fields/row/error/metadata JSON, and use unique-ID insert races returning `EvalError(ERR_PRISM_EVAL_STORE)`. Queries implement every current scalar/status-array filter, exact normalized ownership, stable owner-bound cursor pages, and deep-freeze validated decoded error/metadata records. Malformed stored JSON fails closed with bounded enterprise errors.
- Added package-private shared owner/cursor/timestamp/freeze/SQLSTATE helpers, package unit tests, and live PostgreSQL integration coverage for reopen, filters/orders/pagination, duplicate races across pools, wrong-owner cursor denial, hostile bound text, malformed JSON, and representative `EXPLAIN (FORMAT JSON)` owner/cursor indexes. Root `test:postgres` now runs enterprise integration tests.
- Validation passed: package Biome format/lint, typecheck, build, unit tests, dry-run pack; disposable `postgres:16-alpine` enterprise suite (14/14) and complete root `npm run test:postgres` suite (session-store, memory, enterprise). Documentation remains Task 7.

- [x] Task 4 — Implement PostgreSQL work-idempotency state machine and connector integration
  - Acceptance Criteria:
    - Functional: `begin` atomically creates one `in_progress` claim or returns current state; only matching owner/key/op and current claim token/version may complete/fail/mark unknown.
    - Functional: completed and failed-terminal records never auto-execute again; failed-retryable may be reclaimed under frozen attempt/expiry rules; expired `in_progress` becomes `unknown` and requires explicit host reconciliation/transition before retry.
    - Functional: work tools claim before `runOp`, persist completed bounded summary after success, classify known pre-dispatch failures, and persist unknown for ambiguous abort/transport/process outcomes without claiming exactly-once.
    - Functional: restart and another replica see the same state/result reference; one concurrent caller performs the external mutation.
    - Performance: point claims/transitions use one unique owner+principal+key index and conditional `UPDATE ... WHERE version/token/status`; cleanup is bounded/indexed by status+expiry.
    - Code Quality: state rules live in work-tools contract/conformance; PostgreSQL adapter only implements them. No Phase 7 generic `ToolEffectStore` is introduced.
    - Security: idempotency keys and references are byte-capped/non-secret, ownership/principal/op are immutable after claim, stored summaries omit payload/body/recipient/token data, and conflict errors reveal no foreign state.
  - Approach:
    - Documentation Reviewed:
      - `docs/work-tools.md`; `packages/work-tools/src/{types,idempotency,tools}.ts`.
      - PostgreSQL conditional upsert/locking docs: <https://www.postgresql.org/docs/current/sql-insert.html>, <https://www.postgresql.org/docs/current/explicit-locking.html>.
      - node-postgres Context7 `/brianc/node-postgres`: point mutations use parameterized `pool.query`; a multi-statement transaction must use one checked-out client, so no transaction is held across connector I/O.
    - Options Considered:
      - Hold DB transaction/row lock across CLI/API side effect: consumes connections and cannot atomically commit external system; reject.
      - Treat expired in-progress as retryable: risks duplicate effects after crash; reject.
      - Short atomic claim, external call outside transaction, CAS terminal transition, expired claim → unknown: chosen honest at-least-once boundary.
    - Chosen Approach:
      - Insert claim with unique scope/key; use `ON CONFLICT DO NOTHING` then owned read.
      - Complete/fail via `UPDATE ... WHERE claim_token=$n AND version=$n AND status='in_progress' RETURNING ...`; zero rows is stale conflict.
      - Never store raw connector output; persist only `draftId`, optional `resourceId`, operation, status, timestamps, error class/code reference, and redacted reconciliation reference.
    - API Notes and Examples:
      ```sql
      UPDATE prism_work_idempotency
      SET status = 'completed', version = version + 1, result = $1::jsonb, claim_token = NULL,
          updated_at = clock_timestamp()
      WHERE tenant_id = $2 AND account_key = $3 AND user_key = $4 AND principal_id = $5 AND idempotency_key = $6
        AND op = $7 AND status = 'in_progress' AND claim_token = $8 AND version = $9
      RETURNING *;
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/src/{enterprise,work-idempotency,codecs,errors}.ts` and `src/__tests__/{stores,work-idempotency.integration}.test.ts`: wire and verify SQL claim/CAS behavior.
      - `packages/work-tools/src/{types,idempotency,tools,errors,index}.ts` and tests were completed in Task 1; Task 4 reuses that generic connector hook without changing contract/state rules.
    - References:
      - Roadmap Phase 6 work-tool criteria; Phase 7 is follow-on generalization.
      - Existing session append idempotency unique-key pattern in `packages/session-store-postgres/src/persistence.ts`.
  - Test Cases to Write:
    - Two pools/replicas begin same scope/key: exactly one acquired, one in-progress/duplicate, one `runOp` invocation.
    - Crash windows: before claim, after claim/before effect, during effect, after external success/before complete, after complete; each yields documented state and replay behavior.
    - Transition matrix: every legal/illegal status transition, stale token/version, retry attempt cap, expiry edge, op/owner mismatch, duplicate completed result.
    - Cleanup/restart: expired active → unknown survives reopen; retained completed/terminal rows deduplicate until retention expiry; cleanup never removes active/nonexpired rows.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; connector idempotency semantics and store contract change.
    - Docs pages to create/edit: `docs/work-tools.md`, `docs/enterprise-postgres-state.md`, `docs/migration.md`, `docs/host-security.md` in Task 7.
    - `docs/index.md` update: yes in Task 7; Work tools description names honest unknown-outcome handling.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 4 completion evidence — 2026-08-03

- Wired `createPostgresIdempotencyStore` into `createPostgresEnterpriseState.workIdempotency`; Task 5 subsequently replaces the final router fail-closed slot. No new public export or Phase 7 generic effect store was added.
- `begin` uses a parameterized unique-key `INSERT ... ON CONFLICT DO NOTHING`, exact owned read, database-clock expiry conversion, and conditional retryable reclaim. It returns one claim across pools; owner/principal/key/op are immutable. Complete/fail/unknown/reconciliation use token/version/status CAS updates and return non-enumerating work conflict errors on stale, foreign, or op-mismatched state.
- Claim expiry becomes durable `unknown`; only explicit reconciliation can make it retryable/terminal. Completed, terminal, and retryable rows retain the fixed 30-day cleanup expiry; unknown rows never auto-delete. Stored result/failure JSON is strict, deeply frozen, bounded, and whitelists only `draftId`, optional `resourceId`, code, and optional reference—raw connector output and injected extra fields are discarded.
- Existing Task 1 connector path already calls `begin` before `runOp`, then performs terminal CAS or unknown handling. Added live two-pool connector coverage proving one external dispatch, completed-summary duplicate replay, restart persistence, exact tenant/account/principal isolation, retry cap, all state transitions, expiry/stale-token behavior, hostile key binding, and malformed stored JSON failure.
- Validation passed: enterprise and work-tools Biome/typecheck/build/unit tests; disposable `postgres:16-alpine` enterprise PostgreSQL suite (17/17). Documentation remains Task 7.

- [x] Task 5 — Implement atomic PostgreSQL model-router state and wire router
  - Acceptance Criteria:
    - Functional: shared rate windows admit at most configured requests across replicas; budget usage increments never lose updates; circuit failure/success updates are atomic and one caller receives the half-open probe after cooldown.
    - Functional: state is keyed by exact verified owner/principal plus provider/model and configured scope/window; missing identity in durable mode fails before resolver/provider I/O.
    - Functional: budget/rate/circuit rows expire and cleanup deterministically using database time; bounded cardinality evicts oldest expired/idle keys in stable `(last_used_at,key)` order and never silently evicts active/open state.
    - Functional: restart retains current windows/budgets/circuit state; serialization/deadlock errors retry the entire small transaction a finite jitter-free count then surface typed retryable failure.
    - Performance: candidate preflight and outcome/usage accounting use O(1) indexed statements/short transactions; contention benchmark publishes p50/p95, denied count, exact budget total, and row growth at frozen replica/key volume.
    - Code Quality: router consumes `ModelRouterStateStore`; SQL package contains no provider selection logic. Memory and PostgreSQL stores pass one behavior matrix.
    - Security: state rows contain owner refs/provider/model/numeric counters/timestamps only; provider calls cannot bypass durable checks through sync `providerSource`; all numeric values are finite/bounded.
  - Approach:
    - Documentation Reviewed:
      - `docs/model-routing.md`; `packages/model-router/src/{types,router,limits}.ts`.
      - PostgreSQL `ON CONFLICT`, explicit locks, `SKIP LOCKED`, and transaction retry docs: <https://www.postgresql.org/docs/current/sql-insert.html>, <https://www.postgresql.org/docs/current/sql-select.html>, <https://www.postgresql.org/docs/current/transaction-iso.html>.
      - node-postgres Context7 `/brianc/node-postgres`: use `pool.query` only for one-statement operations; every circuit transaction checks out one client for `BEGIN`/all statements/`COMMIT` or `ROLLBACK`, then releases it.
    - Options Considered:
      - Read then update counters: lost updates across replicas; reject.
      - Advisory lock every router key: unnecessary global lock pressure; reject.
      - Atomic upsert/conditional update per domain row plus short transaction only where multiple fields must agree: chosen.
      - Reserve worst-case tokens/cost before provider call: changes current budget meaning and can strand reservations; defer unless Task 0 freezes explicit reservation semantics.
    - Chosen Approach:
      - Rate: one upsert/conditional reset+increment using database time and return admitted/retry-after.
      - Budget: atomic numeric increment with finite/non-negative guard; resolve reads current total under owner/window key, preserving current post-usage accounting semantics without lost updates.
      - Circuit: exact primary-key lock + optional probe token/expiry; cooldown transition atomically grants one half-open probe, outcome closes or reopens.
      - Cleanup: explicit host call only, capped `DELETE/UPDATE ... WHERE id IN (SELECT ... ORDER BY ... LIMIT n FOR UPDATE SKIP LOCKED)`.
    - API Notes and Examples:
      ```ts
      const router = createModelRouter({ resolver, stateStore: enterprise.modelRouter, rateLimit, budgets, circuit });
      const selected = await router.resolve({ model, identity });
      await router.recordUsage({ identity, provider: selected.provider.id, model: selected.model.model, tokens: 500 });
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/src/{enterprise,model-router,cleanup}.ts` and `src/__tests__/{package,model-router.integration}.test.ts`: wire and verify durable atomic state.
      - `packages/model-router/src/{state,router}.ts` and `src/__tests__/model-router.test.ts`: align in-memory validation with PostgreSQL numeric/time bounds.
    - References:
      - `packages/model-router/src/router.ts` current maps/eviction and `providerSource`.
      - Existing atomic lease patterns in `packages/session-store-postgres/src/leases.ts`.
  - Test Cases to Write:
    - Rate: N concurrent clients at/beyond limit; exact accepted count; window boundary/clock rollback; retry-after; owner/model isolation.
    - Budget: concurrent token/cost increments equal exact sum; restart; threshold below/equal/above; non-finite/negative/overflow rejection.
    - Circuit: concurrent failures open once; open denial; cooldown; exactly one half-open probe; probe success closes; probe failure reopens; abandoned probe expiry.
    - Failure injection: serialization/deadlock retry, pool outage, abort before/after statement, stale probe token, cleanup contention.
    - Bypass: durable mode missing identity and `router.providerSource` fail before resolver call; direct `resolve` succeeds with verified identity.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; router state configuration, async accounting, durable identity requirement, circuit half-open semantics, and sync-facade restriction.
    - Docs pages to create/edit: `docs/model-routing.md`, `docs/enterprise-postgres-state.md`, `docs/migration.md`, `docs/host-security.md` in Task 7.
    - `docs/index.md` update: yes in Task 7; Model routing entry describes durable cross-replica state.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 5 completion evidence — 2026-08-03

- Added package-private `createPostgresModelRouterStateStore` and wired it into `createPostgresEnterpriseState.modelRouter`; all four frozen composition slots are now concrete. SQL package owns only durable counters/circuit state—provider selection remains in `@arnilo/prism-model-router`.
- Rate uses a conditional owner/principal/provider/model/window upsert, so concurrent replicas admit at most the limit. Budget read/add uses atomic reset-or-add upserts and rejects non-finite/overflow values. Both derive window boundaries and expiry from PostgreSQL `clock_timestamp()`, never host/router clock input.
- Circuit claim/outcome uses a short `SERIALIZABLE` checked-out-client transaction, exact primary-key lock, and up to three whole-transaction retries for `40001`/`40P01`. It grants one probe after cooldown, ignores stale/abandoned probe outcomes, and only evicts the stable oldest closed `(last_used_at, key)` row at the fixed capacity—never an open/probed row.
- Router durable mode remains identity-gated and sync `providerSource` remains unavailable before resolver I/O. Memory state now applies the same direct-call numeric/time bounds. Cleanup is explicit, exact-owner, database-clock-based, capped at 100/500, reopens expired probes, and removes only expired closed/router window rows.
- Added live two-pool PostgreSQL coverage for exact rate admission, exact budget sums/reopen/reset, hostile keys, owner isolation, malformed numeric rows, circuit contention/probe/recovery/capacity behavior, durable router preflight/bypass denial, restart, and cleanup. Validation passed: model-router and enterprise Biome/typecheck/build/unit tests; disposable `postgres:16-alpine` enterprise suite (20/20). Documentation remains Task 7.

- [x] Task 6 — Run conformance, restart/contention/security tests, and freeze performance/storage evidence
  - Acceptance Criteria:
    - Functional: network-free memory/domain conformance and disposable PostgreSQL tests cover all four stores, reopen, two independent pools, migration lifecycle, cleanup, and package public imports.
    - Functional: protected PostgreSQL gate fails clearly when requested without `PRISM_TEST_POSTGRES_URL`; default `sdk:ready` remains network-free and does not silently claim PostgreSQL evidence.
    - Performance: benchmark records p50/p95 and throughput for policy append/query, evaluation append/query, idempotency claim/complete/contention, router rate/budget/circuit contention, cleanup, and storage growth at Task 0 volumes.
    - Performance: representative `EXPLAIN (FORMAT JSON)` plans use frozen indexes and avoid sequential scans after statistics are collected; p95/storage ceilings are added to release budgets or a dedicated checked artifact.
    - Code Quality: one reusable conformance runner per domain behavior is used by memory and PostgreSQL tests; flaky wall-clock sleeps are replaced with injectable/database clock fixtures where possible.
    - Security: tests prove tenant/account/user/principal isolation, SQL injection resistance, cursor tamper rejection, bounded JSON/key/error handling, no secret fixture persistence, and least-privilege runtime SQL inventory.
  - Approach:
    - Documentation Reviewed:
      - Current `src/testing/*conformance.ts`, session-store PostgreSQL integration workflow, `scripts/budgets.json`, budget/release gate tests.
      - PostgreSQL `EXPLAIN` guidance: <https://www.postgresql.org/docs/current/using-explain.html> and Context7 `/websites/postgresql_current` `sql-explain`/`using-explain`: JSON plans expose node/index names; `ANALYZE, BUFFERS` records actual execution and buffers.
      - node-postgres Context7 `/brianc/node-postgres`: parameterized values stay in `client.query(..., values)`; circuit transactions use one checked-out client and never `pool.query`.
    - Options Considered:
      - Mock `Pool.query` only: fast but cannot prove locking/constraints/plans; use for network-free unit SQL shape only, not production evidence.
      - Put live PostgreSQL in default `sdk:ready`: breaks network-free checkout; reject.
      - Network-free conformance + explicit disposable/protected PostgreSQL gate: chosen.
    - Chosen Approach:
      - Add package unit tests with fake/recording queryable for bounds/error paths; run real concurrency/migration/plan suites under existing `PRISM_TEST_POSTGRES_URL` workflow.
      - Keep the existing enterprise entry in root `test:postgres`, but require `PRISM_TEST_POSTGRES_URL` before any protected suite; `sdk:ready` remains network-free.
      - Add `scripts/benchmark-0.0.23.mjs` with JSON output; freeze fixture/ceilings in `scripts/budgets.json` and validate checked `scripts/benchmark-0.0.23.json` evidence in the offline budget gate.
    - API Notes and Examples:
      ```bash
      npm test --workspace @arnilo/prism-work-tools
      npm test --workspace @arnilo/prism-model-router
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
      node scripts/benchmark-0.0.23.mjs
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/src/__tests__/enterprise-conformance{,.test,.integration.test}.ts`: one domain runner exercised by memory and PostgreSQL/reopen/two-pool tests.
      - `packages/enterprise-postgres/src/model-router.ts`: short randomized retry backoff outside a released client after a bounded serialization/deadlock retry.
      - Root `package.json`, `scripts/require-postgres-url.mjs`, `scripts/{tooling-gate,budget-gate}.test.mjs`: explicit protected gate without changing `sdk:ready`.
      - `scripts/benchmark-0.0.23.mjs`, `scripts/{benchmark-0.0.23,enterprise-postgres-sql-inventory}.json`, `scripts/budgets.json`: checked benchmark/index/storage/least-privilege evidence.
      - `.github/workflows/release.yml`: name existing automatic PostgreSQL suite accurately.
    - References:
      - `packages/session-store-postgres/src/__tests__/postgres-integration.test.ts`.
      - Existing protected PostgreSQL release gate documented in `docs/release-and-install.md`.
  - Test Cases to Write:
    - Combined restart: write all four domains, close/reopen composition, verify exact state/ownership.
    - Multi-client stress: fixed seed and worker count; assert one idempotency effect, exact rate accepts, exact budget sum, one circuit probe.
    - Growth/cleanup: frozen keys/records over periods, expected rows/bytes before and after bounded cleanup.
    - Security matrix: each API with omitted/wrong owner, foreign cursor/key/token, injection strings, oversized JSON/ref/key, malformed DB row, abort.
    - Pack consumer: install tarballs, open against supplied test pool, use only public exports/types.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API beyond Tasks 1–5; verification evidence and commands change.
    - Docs pages to create/edit: `docs/enterprise-postgres-state.md`, `docs/postgres-persistence.md`, `docs/performance.md`, `docs/release-and-install.md` in Task 7.
    - `docs/index.md` update: no separate test entry; links updated in Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 6 completion evidence — 2026-08-03

- Added one test-private `runEnterpriseStoreConformance` runner and execute it against dependency-free memory stores and a live PostgreSQL composition. The two-pool suite verifies policy/evaluation exact-owner reads, work claim/complete isolation, router rate/budget/circuit state, close/reopen persistence across all four stores, 16-client same-key work/rate/budget/circuit contention, and exactly one half-open probe. Existing package suites retain the focused cursor tamper, injection, malformed-row, bounds, unknown-outcome, migration drift, cleanup, and connector-effect tests.
- Root `test:postgres` now fails immediately and clearly without `PRISM_TEST_POSTGRES_URL`; `sdk:ready` still never invokes it. The existing release PostgreSQL job already calls root `test:postgres`; its label now names enterprise coverage. An offline tarball-consumer install of core, four domain packages, and enterprise package imported root exports and confirmed the unexported router subpath is blocked.
- Added one-to-three-attempt serializable/deadlock retry jitter after releasing the checked-out client. High contention can still surface the frozen retryable error after the bounded internal retry; test/benchmark callers retry that safe transaction operation only, never connector I/O.
- Added checked least-privilege SQL inventory: request paths are limited to `SELECT`/`INSERT`/`UPDATE`/`DELETE` on six state tables plus schema `USAGE`; DDL/catalog/advisory-lock operations are isolated to migration open. Offline tooling test rejects request-path DDL.
- Protected `postgres:16-alpine` benchmark evidence is frozen in `scripts/benchmark-0.0.23.json`, validated offline by `scripts/budget-gate.test.mjs`: Node v24.18.0/Linux x64, 10 tenants × 10 principals × 1,000 policy/evaluation rows, 10,000 router keys, 16 clients, 100 warmups, 1,000 measured operations, and 100-row cleanup batches. p95s were policy append/query **0.747/1.479ms**, evaluation append/query **0.698/0.963ms**, work claim/complete/contention **1.892/4.162ms**, router rate/budget/circuit contention **12.011/6.715/28.410ms**, and cleanup **2.981ms**—within frozen 50ms point/100ms page-cleanup ceilings. Exact totals: 1,000 rate accepts, 16,000 budget tokens, and 1,000 probes.
- `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` after `ANALYZE` recorded all 14 frozen policy/evaluation/work/router point and expiry shapes on their named indexes with no sequential scans. Storage before/after cleanup recorded 101,100 policy rows (68,517,888 bytes), 101,100 evaluation rows (97,296,384 bytes), and 121,100 → 11,100 rate rows; PostgreSQL allocated relation bytes remain unchanged after delete as expected under MVCC. Validation passed: focused five-workspace typecheck/build/tests (5+12+17+8+8 unit tests), offline budget/tooling gates (11 tests), disposable PostgreSQL root suite (57 tests), tarball consumer import, and `git diff --check`. Documentation remains Task 7.

- [x] Task 7 — Documentation, migration guide, packaging, version 0.0.23, and release gate
  - Acceptance Criteria:
    - Functional: docs show complete setup/use/cleanup/close examples for all four stores, work unknown-outcome operator handling, router async migration, exact ownership, migration lifecycle, and protected PostgreSQL command.
    - Functional: every publishable manifest/internal exact range, lockfile, runtime version, compatibility baselines, package READMEs/CHANGELOGs, profile inventory, package count, release/install handoff, examples, and roadmap agree on 0.0.23.
    - Functional: `plans/README.md` lists Plan 006 active; roadmap Phase 6 remains unchecked until all gates pass, then receives concise completion evidence and Phase 6 checkbox only after release checks succeed.
    - Performance: docs publish measured p95/storage/cleanup volumes and clearly scope results to recorded CI/hardware; package/root size stays within approved budget.
    - Code Quality: docs follow required API-page structure; example uses public imports only; no future Phase 7 APIs or adapter scaffolding appears.
    - Security: docs state TLS/runtime-vs-migration roles/backup/retention/cleanup remain host-owned; memory/file stores are non-production; unknown outcomes are never auto-replayed; secrets/raw payloads are prohibited.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure.
      - Existing docs/package/release pages and release scripts/tests for 0.0.22.
      - Completed Task 0 freeze and Task 6 measured evidence.
    - Options Considered:
      - Scatter setup snippets only across four existing pages: hard to discover lifecycle/migrations; reject.
      - One new enterprise PostgreSQL API page plus focused cross-links/behavior updates: chosen.
    - Chosen Approach:
      - Create `docs/enterprise-postgres-state.md` with required What/When/Inputs/Outputs/Request-response/Implementation/Extension/Security/Related sections and per-store tables/examples.
      - Add `examples/enterprise-postgres-state.ts` as a compile/demo-gated public composition; keep real DB execution env-gated.
      - Add migration section `0.0.22 → 0.0.23`, especially awaited router methods, memory-only `providerSource`, idempotency contract/state changes, install/open/migrate steps, and no automatic cleanup worker.
      - Run focused tests, `npm run sdk:ready`, `npm run release:check -- --version 0.0.23` (or current accepted CLI form), 47-package expected dry-run count after Task 0 confirms package graph, and protected PostgreSQL gate before marking complete.
    - API Notes and Examples:
      ```ts
      const state = await createPostgresEnterpriseState({ pool, schema: "prism" });
      const router = createModelRouter({ resolver, stateStore: state.modelRouter });
      await router.resolve({ model, identity });
      await state.cleanup({ ownership, limit: 500 }); // explicit; no background worker
      await state.close(); // caller-owned pool remains open
      ```
    - Files to Create/Edit:
      - `docs/enterprise-postgres-state.md`, `docs/policy-and-audit.md`, `docs/evaluations.md`, `docs/work-tools.md`, `docs/model-routing.md`, `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/host-security.md`, `docs/performance.md`, `docs/migration.md`, `docs/release-and-install.md`, `docs/index.md`.
      - `examples/enterprise-postgres-state.ts`, `examples/README.md`, `examples/tsconfig.json` or demo gate inventory if required.
      - `packages/{policy,evals,work-tools,model-router}/README.md` and `CHANGELOG.md`.
      - `packages/enterprise-postgres/README.md`, `CHANGELOG.md`, `package.json`.
      - Root/package manifests, `package-lock.json`, `src/version.ts`, release/docs/install/packaging tests, `scripts/compat-baseline/*`, `scripts/budgets.json`.
      - `plans/README.md`, `roadmap.md` only after exit gate evidence.
    - References:
      - `scripts/release.mjs`, `src/__tests__/{docs,packaging,install-smoke,release,public-contracts}.test.ts`.
      - Phase 5 release task/publish handoff as structure reference.
  - Test Cases to Write:
    - Docs tripwire: enterprise page covers four stores, six idempotency observable states including absent, router async migration, cleanup, ownership, protected command, and no exactly-once claim.
    - Local-link/API symbol/example compile checks; package README current-version/changelog assertions.
    - Packed public example and Node 20/current import smoke; tarball deny-list/secret/SBOM/license/provenance checks.
    - Final: focused package tests, full `npm run sdk:ready`, PostgreSQL integration/contention/migration/plan suite, `git diff --check`, release check, and all-package pack dry-run.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task publishes all Phase 6 APIs, behavior, migration, operational boundaries, and release metadata.
    - Docs pages to create/edit: all concrete paths listed above.
    - `docs/index.md` update: yes; add Enterprise PostgreSQL state under Persistence and update Governance, Evaluations, Work tools, Model routing, Host security, Performance, Migration, and Release/install descriptions.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 7 completion evidence — 2026-08-03

- Released documentation and public example: `docs/enterprise-postgres-state.md`, cross-links for all four domain stores, migration/security/performance/release guidance, and package READMEs/CHANGELOGs. The example uses only `createPostgresEnterpriseState`; docs state host-owned TLS, credentials, cleanup, backups, and unknown-outcome reconciliation.
- Bumped all 47 workspace manifests, internal exact ranges, lockfile, runtime version, compatibility baseline, package/profile/release assertions, and publish handoff to **0.0.23**. Added enterprise-postgres to package, tarball-consumer, and API contract gates; its public root import is verified and private subpaths remain blocked.
- Validation passed: `npm run sdk:ready`; Node **v20.20.2** import smoke for every root `@arnilo/prism` export; disposable `postgres:16-alpine` `npm run test:postgres` (57 passing); `npm run release:check -- --version 0.0.23 --allow-dirty --allow-untagged` (47 packages available); and package/release gate dry-runs. `plans/README.md` and `roadmap.md` now record Phase 6 complete.

## Compromises Made

- Release preflight used `--allow-dirty --allow-untagged` because this is an implementation checkout, not the final tagged publish. No package was published or tagged.
- Protected PostgreSQL evidence is recorded on disposable `postgres:16-alpine` / Node v24.18.0 Linux x64; remeasure only when the fixture, PostgreSQL major version, or approved hardware changes.

## Further Actions

- **Required before publish:** commit, tag `v0.0.23`, then run release preflight without dirty/untagged overrides and follow `docs/release-and-install.md`.
- **Next phase:** Phase 7 durable event delivery and generalized recoverable tool effects; do not pre-scaffold it.
