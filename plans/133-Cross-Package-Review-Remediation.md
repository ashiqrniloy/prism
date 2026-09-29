# Plan 133: Cross-Package Review Remediation

## Objectives
- Close confirmed tenant-isolation, workflow replay, query-contract, snapshot, and timestamp defects before optimization or refactoring.
- Bound branch-read work and evaluate multi-scope RAG latency without weakening authorization, ordering, or audit behavior.
- Reduce justified adapter duplication; cover missed cases in existing test/CI tiers; correct public documentation.

## Expected Outcome
- SQLite and PostgreSQL entry queries enforce requested ownership and honor branch filters/cursors; no foreign transcript can be returned under another owner's scope.
- Checkpoint write failures cannot invoke a successfully executed workflow node again as a normal retry; in-memory entries are snapshots; session activity does not move backward.
- Long-branch reads return bounded pages; multi-scope retrieval meets a measured latency target without leaking revoked data; shared adapter semantics have one source of truth where doing so removes actual duplication.
- Regression tests and appropriate existing CI gates protect these contracts; installation and coverage documentation matches the current release.

## Tasks

- [x] Task 1 (P0 prerequisite): Review existing primitives and pin reproducible contract cases
  - Acceptance Criteria:
    - Functional: inventory `SessionEntryQuery`, `SessionBranchRead`, ownership helpers, cursor codecs, checkpoint/saga retry seams, RAG scope aggregation, and current conformance tests; record confirmed versus measurement-only findings.
    - Performance: baseline page sizes/queries and multi-scope latency without introducing a runtime pass or new dependency.
    - Code Quality: identify the smallest reusable internal primitives; distinguish dialect-specific SQL from shared pure semantics; no speculative public factory or package.
    - Security: document entry-to-session ownership relationship and failure-mode threat model before editing either adapter.
  - Approach:
    - Documentation Reviewed: `docs/database-persistence.md` (OwnershipScope, entry schema), `docs/session-stores.md` (branch contract), `docs/workflows.md` (retry/checkpoint/saga contract), `docs/rag.md` (scoped authorization).
    - Options Considered: share all SQL (dialect leakage, reject); share pure query/ownership semantics only where needed (preferred); retain dialect code for SQL binding/CTEs.
    - Chosen Approach: inspect callers and tests, write concise primitive/contract review; reproduce the first five findings with red tests in subsequent tasks. Preserve existing public exports and error shapes.
    - API Notes and Examples:
      ```ts
      // SessionEntryQuery inherits OwnershipScope; entry rows reference sessions.
      const page = await persistence.queryEntries({ sessionId: "s", tenantId: "tenant-b", limit: 2 });
      // Requested scope must never reveal entries owned by tenant-a.
      ```
    - Files to Create/Edit:
      - `docs/history/133-review-remediation-primitive-review.md`: inventory, decisions, measured baseline and security contract (historical review, not API documentation).
    - References: `src/contracts-core/persistence.ts`, `src/contracts-core/session.ts`, `src/testing/persistence-schema.ts`, `packages/prism-core/src/sessions/{sqlite,postgres}/persistence.ts`, `packages/prism-core/src/runtime/workflows/run/node-execution.ts`, `packages/memory/src/rag/retrieve.ts`.
  - Test Cases to Write:
    - None in review itself; record exact failing scenarios and assign executable regressions to Tasks 2–9.
  - Completion evidence: `docs/history/133-review-remediation-primitive-review.md` inventories existing seams and assigns eight repro/measurement cases to Tasks 2–9. Bun 1.4.2 SQLite probe: foreign scope returned 2 ordinary and 2 branch entries; branch kind/order ignored; a 300-entry CTE returned 2 page items after materializing 300 and a cold read took ~14.8 ms; older run regressed `updatedAt`. Workflow injected third-save failure with `retries: 1` reported success after 2 effects/5 saves. Delayed fake RAG baseline: 1 scope 22.4 ms/2 calls, 8 scopes 162.7 ms/16 calls, peak 1. No PostgreSQL URL available; adapter parity source-inspected, live measurement reserved for Tasks 2–12.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; evidence-only review.
    - Docs pages to create/edit: `docs/history/133-review-remediation-primitive-review.md` (historical design evidence, not current API page).
    - `docs/index.md` update: no; no behavior delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (current API vs history).

- [x] Task 2 (P0): Enforce ownership on ordinary and branch entry queries in both databases
  - Acceptance Criteria:
    - Functional: `queryEntries` with tenant/account/user scope returns entries only if the owning session matches every supplied scope; mismatches, including `leafId`, return empty pages without existence clues; unscoped host-admin reads retain current behavior.
    - Performance: session-key lookup/indexed join; retain bounded ordinary-query page size; no per-entry application-side ownership lookup.
    - Code Quality: parameterized SQLite/PostgreSQL predicates using existing ownership conventions; no duplicated scope check on every returned row.
    - Security: test foreign session/entry ID, mixed scopes, and same IDs under matching and mismatched principals; never return transcript data for a mismatched owner.
  - Approach:
    - Documentation Reviewed: `docs/database-persistence.md` (optional ownership scope and `prism_session_entries.session_id` FK), `docs/sqlite-persistence.md` and `docs/postgres-persistence.md` (tenant query guarantees).
    - Options Considered: app-side filter after read (reject, disclosure/work); add ownership columns to entries (reject, migration); join/existence predicate against `prism_sessions` (chosen).
    - Chosen Approach: apply owning-session predicate to normal SQL and branch CTE path before returning rows; keep host-managed unscoped read semantics as documented.
    - API Notes and Examples:
      ```ts
      const own = await db.queryEntries({ sessionId: "s", tenantId: "tenant-a" });
      const foreign = await db.queryEntries({ sessionId: "s", leafId: "e", tenantId: "tenant-b" });
      // foreign.items.length === 0
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`, `packages/prism-core/src/sessions/postgres/persistence.ts`: filter through session ownership, including branch path.
      - `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `packages/prism-core/src/sessions/postgres/__tests__/postgres-integration.test.ts`: cross-owner cases.
      - `src/testing/persistence-schema.ts`: shared entry-query ownership conformance cases if both adapters can use existing fixture without extra setup; otherwise retain adapter-local tests.
      - `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/index.md`: current entry-query ownership semantics and existing navigation descriptions.
    - References: `src/contracts-core/persistence.ts` (`SessionEntryQuery`, `OwnershipScope`); adapter `queryTable` ownership filtering.
  - Test Cases to Write:
    - Foreign tenant/account/user and foreign `leafId`: zero rows, zero cursor; authorized counterpart still reads full expected entries.
    - Unscoped host read: existing result preserved; SQL injection-shaped identifiers remain bound values.
  - Completion evidence: both adapters apply parameterized indexed owning-session `EXISTS` predicates in ordinary entry queries and branch CTE seeds; explicit empty scope is not treated as unscoped. Adapter-local tests cover matching/mismatched tenant/account/user, combined scopes, foreign IDs/leaf, scoped cursor, injection-shaped values, and host-admin reads. Live PostgreSQL 18/18 passed against ephemeral pg16; SQLite 23/23 relevant tests passed (one unrelated Node import runtime test excluded: it imports nonexistent source `.js` when running directly from TS sources). `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check` passed. No public exports/schema migration or shared conformance fixture added; PostgreSQL service used for this task, broader release verification belongs to Task 12.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; public entry-query isolation changes.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md` (current contract).
    - `docs/index.md` update: yes; update existing database/SQLite/PostgreSQL one-sentence entries to mention ownership-scoped entry reads.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 (P0): Keep checkpoint failures outside node-execution retry boundary
  - Acceptance Criteria:
    - Functional: successful node execution followed by save rejection never invokes node again via `retries`; node-execution failures still honor configured retries; checkpoint failure propagates, and success events/terminal state do not falsely report durable completion.
    - Performance: no extra checkpoint write on successful default path; preserve scheduler concurrency limits.
    - Code Quality: isolate execution exception from persistence exception; cover DAG, superstep/loop, tool/agent, and suspension branches without new generic retry machinery.
    - Security: redaction, approval and idempotency boundaries unchanged; unknown external-effect outcomes fail closed, not silently replayed.
  - Approach:
    - Documentation Reviewed: `docs/workflows.md` (node retries, loop iterations, checkpoint/resume; saga reconciliation as deliberate alternative), `docs/testing.md` (suite placement).
    - Options Considered: retry every save inside node loop (reject: duplicates side effects); wrap every tool in saga (reject: changes API); retry only node execution and propagate checkpoint errors (chosen).
    - Chosen Approach: trace all `persistCheckpoint` calls from `runNode`, `executeNode`, `onNodeSucceeded`, and superstep commit. Separate execution retry scope; do not mistake in-node state-save failures for safe node failures. Preserve first observable error, ensure success events follow acknowledged persistence where required, and document uncertain outcomes where durability cannot prove execution.
    - API Notes and Examples:
      ```ts
      const workflow = defineWorkflow({ id: "effects", revision: "1", nodes: {
        send: functionNode({ retries: 1, execute: () => externalEffect() }),
      }, edges: [] });
      // A failed post-execution checkpoint write must not call externalEffect() twice.
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/run/node-execution.ts`: execution/persistence failure separation.
      - `packages/prism-core/src/runtime/workflows/run/checkpoint.ts`, `packages/prism-core/src/runtime/workflows/run/main.ts`: internal failure marker and fail-closed resume for uncertain running nodes/waves.
      - `packages/prism-core/src/runtime/workflows/run/scheduler.ts`, `packages/prism-core/src/runtime/workflows/run/superstep.ts`: propagate original failed save, skip false terminal checkpoint/events, emit superstep success only after wave save.
      - `packages/prism-core/src/runtime/workflows/__tests__/run.test.ts`, `packages/prism-core/src/runtime/workflows/__tests__/coordinator.test.ts`: fail-after-effect, retry, resume, stale lease cases.
      - `docs/workflows.md`, `docs/index.md`: current retry/durability semantics and workflow nav sentence.
    - References: existing `run.test.ts` injected-checkpoint and state-update recovery tests; `docs/workflows.md` saga unknown-outcome model.
  - Test Cases to Write:
    - Save fails once immediately after function/tool execution with `retries: 1`: execution counter remains 1 and run rejects.
    - Execution itself fails transiently: counter reaches 2, later success saved; loop-iteration and suspend save failures cannot re-execute completed side effects.
  - Completion evidence: node execution retry catch now excludes post-execution/suspension saves; shared checkpoint-failure marker preserves original error through nested workflows and prevents scheduler terminal writes after an uncertain rejection. DAG completion and superstep wave success events follow acknowledged checkpoints. Resuming a persisted `running` node or ambiguous ready superstep refuses automatic replay; terminalized persisted loop iteration remains resumable. Stale coordinator takeover now reports unknown outcome rather than invoking the effect twice. No extra checkpoint write or public export. Workflow suite: 172/172 passed; docs suite: 158/158 passed; `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check` passed. Host reconciliation/idempotency remains required for unknown external effects; no exactly-once effect claim.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; retry and resume behavior is externally observable.
    - Docs pages to create/edit: `docs/workflows.md` (execution retries versus uncertain checkpoint failures; no exactly-once external effects claim).
    - `docs/index.md` update: yes; update existing Workflows entry with accurate durability/retry description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 (P1): Restore complete `leafId` query filters, order, and cursor pagination
  - Acceptance Criteria:
    - Functional: branch-filtered `queryEntries` honors `kind`, `runId`, `parentId`, timestamp bounds, requested order, limit and cursor in both adapters; `nextCursor` reaches every matching row once. Scope rule from Task 2 applies.
    - Performance: bounded result materialization per page; no full branch fetched just to filter in TypeScript.
    - Code Quality: use one cursor semantic consistent with ordinary entry queries or document an intentional branch-specific cursor; no silent dropped filters.
    - Security: invalid cursors fail closed; foreign leaf/session pairing yields no entries.
  - Approach:
    - Documentation Reviewed: `docs/database-persistence.md` (`PersistencePage`, `SessionEntryQuery`, `SessionBranchRead`), `docs/session-stores.md` (branch order), both persistence adapter docs.
    - Options Considered: reject unsupported combinations (breaks advertised query type); slice branch result in JS (unbounded); filter ancestor CTE and page in dialect SQL (chosen).
    - Chosen Approach: retain the ancestor CTE and apply requested filters/order and keyset pagination to matched ancestors; preserve `readBranchPath` root-to-leaf semantics separately. Validate missing `sessionId` and branch cursor explicitly, following current error-contract rules if error shapes change.
    - API Notes and Examples:
      ```ts
      const first = await persistence.queryEntries({ sessionId: "s", leafId: "leaf", kind: "message", limit: 2 });
      const next = await persistence.queryEntries({ sessionId: "s", leafId: "leaf", kind: "message", limit: 2, cursor: first.nextCursor });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`, `packages/prism-core/src/sessions/postgres/persistence.ts`: filtered branch CTE joined into the existing entry query and limited in SQL; cross-session parent traversal blocked.
      - `packages/prism-core/src/sessions/codecs/index.ts`: reject malformed `(timestamp, id)` entry cursors.
      - `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `packages/prism-core/src/sessions/postgres/__tests__/postgres-integration.test.ts`.
      - `src/testing/persistence-schema.ts`: shared branch-filter/pagination conformance over the existing fixture.
      - `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/index.md`.
    - References: `src/contracts-core/persistence.ts` (`SessionEntryQuery`); `src/contracts-core/session.ts` (`SessionBranchRead`).
  - Test Cases to Write:
    - Three-entry branch with mixed kinds/runs and equal timestamps: filtering, both orderings, two pages, no duplicate or skipped rows.
    - Invalid cursor, mismatched leaf/session, and owner mismatch: no transcript leakage; repo-wide search in `scripts/`, `examples/`, and every workspace for retired error code/class/string **if** this task changes any error contract.
  - Completion evidence: both adapters now seed an ownership-scoped ancestor CTE, join its ids to the ordinary entry query, apply every filter plus `(timestamp, id)` asc/desc keyset cursor, and fetch at most `limit + 1` rows; `readBranchPath` retains root-to-leaf offset pagination. Positive safe-integer limits and complete cursor parts are validated; branch queries require `sessionId`, reject old offset cursors, and never traverse cross-session parent links. Shared conformance covers mixed kinds/runs/timestamp ties, combined filters, array and empty kinds, both page directions, ordinary-cursor reuse, malformed cursors, and foreign session/leaf. Adapter ownership tests cover cross-session parent corruption. SQLite: 24/24 relevant tests; PostgreSQL: 18/18 relevant tests with a local pg16 service, plus isolated lease test 1/1. Full PostgreSQL suite hit an unrelated 20 ms lease-expiry timing assertion under load (18/19); SQLite's existing Node-source-import test remains excluded. `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check` passed before a concurrent `packages/agent-sdk` workspace change; targeted docs checks 5/5 passed. Full docs suite now fails three unrelated package-inventory assertions from that concurrent workspace addition. Repo-wide `rg` of retired branch/entry cursor error strings found no consumers of the old branch cursor message for `queryEntries`; that message remains valid for `readBranchPath`. No migration or new dependency.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; branch query behavior changes.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`.
    - `docs/index.md` update: yes; update existing database-adapter entries with accurate branch filtering/paging.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 (P1): Snapshot memory-store entries at ingestion
  - Acceptance Criteria:
    - Functional: mutations of initial entries or appended entries after ingestion cannot change `get`, `list`, branch reads, or search; existing defensive output copies remain.
    - Performance: one ingest clone per entry; no repeated copies on internal indexing beyond existing read copies.
    - Code Quality: reuse existing `cloneEntry` (`structuredClone`), no new type/interface.
    - Security: mutable caller content cannot alter stored transcript after validation/redaction.
  - Approach:
    - Documentation Reviewed: `docs/session-stores.md` (in-memory store and defensive branch reads), `docs/session-store-conformance.md` (adapter invariants).
    - Options Considered: freeze caller object (modifies caller, reject); clone at every lookup (does not prevent pre-lookup mutation, reject); clone on `add()` (chosen).
    - Chosen Approach: store one cloned entry after validation; derive both indexes and session arrays from snapshot; preserve duplicate/idempotency behavior.
    - API Notes and Examples:
      ```ts
      const store = createMemorySessionStore();
      await store.append(entry);
      // Mutating entry.message afterwards must not change (await store.get(entry.id)).
      ```
    - Files to Create/Edit:
      - `src/session-stores.ts`, `src/__tests__/session-stores.test.ts`.
      - `docs/session-stores.md`, `docs/index.md`: snapshot guarantee and existing nav description.
    - References: `src/session-stores.ts` (`cloneEntry`, `add`), `src/__tests__/session-stores.test.ts` (read-copy tests).
  - Test Cases to Write:
    - Mutate nested message content after append and after initial-load construction: all reads/search retain original value; clone inputs remain allowed after append.
  - Completion evidence: `createMemorySessionStore` routes initial entries and appends through the same `add` guard, clones once after duplicate/parent/idempotency checks, and indexes only the snapshot in both maps and leaf tracking. A red-then-green regression mutates caller-owned ids, session/parent links, nested message text, and search metadata after ingestion; `get`, `list`, branch reads, search, and duplicate checks retain the original. Uncloneable input rejects without indexing or consuming the idempotency key; existing output defensive copies remain. `bun test src/__tests__/session-stores.test.ts src/__tests__/session-index.test.ts src/__tests__/conformance-helpers.test.ts`: 65/65 passed; session-store suite after the final assertion: 30/30 passed; targeted docs checks: 5/5 passed. `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run build:core`, `git diff --check` passed. No new export/dependency/schema change; full docs suite remains outside this task (pre-existing package-inventory drift recorded under Task 4).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; store snapshot semantics.
    - Docs pages to create/edit: `docs/session-stores.md`.
    - `docs/index.md` update: yes; update existing Session stores sentence for defensive ingest/read copies.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 (P1): Make session activity timestamp monotonic
  - Acceptance Criteria:
    - Functional: older event/run/usage writes cannot regress `updatedAt`; newer activity advances it in both adapters, including explicit `appendSession` behavior after verifying its CAS/write semantics.
    - Performance: atomic indexed upsert only, no extra round trip or read-then-write race.
    - Code Quality: equivalent SQLite/PostgreSQL timestamp comparison for supported serialized timestamps; document handling of timezone/precision differences.
    - Security: ownership columns never change as side effect of timestamp upsert.
  - Approach:
    - Documentation Reviewed: `docs/database-persistence.md` (session upsert metadata and CAS), `docs/sqlite-persistence.md`, `docs/postgres-persistence.md` (session timestamps).
    - Options Considered: application-side `max` after fetch (race); no-op on conflict (loses new activity); DB-side greatest/max of existing and incoming timestamps (chosen). Review ISO serialization before lexical comparison.
    - Chosen Approach: normalize incoming activity and explicit session `updatedAt` to UTC ISO milliseconds; compare instants in indexed conflict updates (`julianday`/`timestamptz`) to handle legacy timezone offsets. Keep `appendSession` caller-authoritative, including backdated versioned metadata writes.
    - API Notes and Examples:
      ```ts
      await persistence.appendRun({ id: "r", sessionId: "s", startedAt: "2026-01-01T00:00:00Z" });
      await persistence.appendUsage({ id: "u", sessionId: "s", runId: "r", scope: "run_total", recordedAt: "2025-01-01T00:00:00Z", usage: { totalTokens: 1 } });
      // Querying s must not report 2025 as updatedAt.
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`, `packages/prism-core/src/sessions/postgres/persistence.ts`, `packages/prism-core/src/sessions/postgres/event-source.ts`: guard every session activity upsert, including direct durable events.
      - `packages/prism-core/src/sessions/codecs/index.ts`: shared internal UTC-millisecond normalization and timezone validation.
      - `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `packages/prism-core/src/sessions/postgres/__tests__/postgres-integration.test.ts`.
      - `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/index.md`.
    - References: both `ensureSession` conflict statements; direct PostgreSQL event-source upserts; `SessionRecord.updatedAt` contract.
  - Test Cases to Write:
    - Newer then older run/usage/event, later event advancement, timezone-equivalent and legacy-offset timestamps, concurrent older/newer requests, invalid timestamps, and unchanged session ownership/metadata CAS.
  - Completion evidence: SQLite session-key upsert advances `updated_at` only when `julianday(incoming) > julianday(current)`; PostgreSQL persistence and both durable event paths use `timestamptz` comparison inside conflict updates. Shared internal normalization writes UTC milliseconds and rejects unzoned/invalid timestamps. Explicit `appendSession` keeps caller-authoritative `updatedAt` and existing CAS/ownership guards; older activity cannot regress it after a subsequent newer write. Red-then-green adapter regressions cover older/newer runs, usage, events, timezone aliases, pre-existing offset rows, competing requests, backdated CAS metadata, and mismatched ownership. SQLite 25/25 relevant tests (one pre-existing Node-source-import test fails because it imports nonexistent `persistence.js` from the TS source tree); PostgreSQL integration 20/20 and durable event-source 7/7 against local pg16; targeted docs 17/17; `bun run lint`, `bun run --filter @arnilo/prism-core typecheck`, targeted six-file Biome format, and `git diff --check` passed. An earlier `bun run typecheck` passed; a later run was blocked by concurrent untracked `packages/agent-sdk/src/config.ts` (`TS2322` in its build). Repo-wide `bun run format:check` is likewise blocked by concurrent unformatted `packages/agent-sdk/src/presets.ts`; neither external file was changed for this task. No schema migration, new dependency, or public symbol.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; returned session ordering/timestamps change.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`.
    - `docs/index.md` update: yes; update existing database adapter sentences with monotonic activity times where relevant.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 (P2): Bound SQL branch-path page reads
  - Acceptance Criteria:
    - Functional: both `readBranchPath` adapters return identical root-to-leaf pages and cursors, including equal-timestamp ancestors, missing leaf, and resume from page N.
    - Performance: SQL returns at most `limit + 1` entries per page; measure repeated traversal at long-branch scale and record remaining recursive-CTE traversal cost (avoid claiming O(1) deep page access).
    - Code Quality: retain existing cursor shape where possible, parameterize bounds, no new branch store interface.
    - Security: session/leaf constraints remain in SQL; malformed/huge offsets cannot cause unbounded result materialization.
  - Approach:
    - Documentation Reviewed: `docs/session-stores.md` (`readBranchPath`), `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/database-persistence.md` (indexes).
    - Options Considered: current fetch-all-and-slice (reject, memory grows with branch); keyset over materialized path (more complex); SQL CTE with bounded outer page/offset (chosen first, benchmark deep offset and only upgrade when evidence demands it).
    - Chosen Approach: move page slice into SQL, preserving root-to-leaf order and `nextCursor`; validate positive safe limits and canonical safe-integer offset cursors before querying. Omitted `limit` retains full-path behavior for direct callers: default paging would require revisiting the runtime reader's 64-page cap. Benchmark first/deep pages against the Task 1 baseline without claiming traversal is constant-time.
    - API Notes and Examples:
      ```ts
      const first = await store.readBranchPath!({ sessionId: "s", leafId: "leaf", limit: 100 });
      const second = await store.readBranchPath!({ sessionId: "s", leafId: "leaf", limit: 100, cursor: first.nextCursor });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`, `packages/prism-core/src/sessions/postgres/persistence.ts`.
      - `packages/prism-core/src/sessions/codecs/cursor.ts`: reject malformed, oversized, and unsafe-integer offsets with the existing error message.
      - `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `packages/prism-core/src/sessions/postgres/__tests__/postgres-integration.test.ts`.
      - `docs/session-stores.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/index.md`.
    - References: current CTE and JS `.slice()` in both adapters; `src/contracts-core/session.ts` (`SessionBranchRead`); `src/session-stores.ts` (`MAX_BRANCH_PAGES`).
  - Test Cases to Write:
    - 300-entry equal-timestamp branch: root→leaf first/next/deep/final pages, exact numeric cursors, and instrumented SQL result counts `[3, 3, 3, 2]` for `limit: 2`; missing/mismatched leaf, malformed/oversize/unsafe cursor, invalid limit, omitted-limit compatibility; benchmark deep page versus baseline.
    - Repo-wide search of `scripts/`, `examples/`, and every workspace for old cursor-error consumers or noncanonical branch cursor literals after stricter validation.
  - Completion evidence: SQLite and PostgreSQL now bind `LIMIT limit+1 OFFSET cursor` outside the ancestor CTE and map only the first `limit` rows; no application-side full-chain slice for explicitly limited pages. Both preserve depth-based root→leaf ordering, existing decimal offset cursor shape, owner/session seed and same-session parent constraints, and the prior full-path response when `limit` is omitted. The shared decoder rejects empty, non-decimal, >16-digit, and unsafe offsets before SQL. Red-then-green 300-entry equal-timestamp tests instrumented actual SQL result counts: old adapter returned `[300, 300, 300, 300]` for four 2-item pages; new adapters return `[3, 3, 3, 2]`. Repeated 300-entry local reads (40 SQLite / 30 PostgreSQL pairs): SQLite cold 22.805 ms, first/deep median 22.401/22.424 ms; PostgreSQL fresh bulk-loaded table first/deep median ~1054/1055 ms before statistics, and 9.930/9.965 ms after `ANALYZE`. These are illustrative local measurements, not p95; Task 1's ~14.8 ms SQLite cold baseline was another run, so no speedup claim. CTE still visits/sorts ancestors per page; OFFSET does not make deep reads O(1). SQLite 26/26 relevant tests (existing Node-source-import test excluded); live PostgreSQL 21/21; core session-store/conformance 59/59; targeted docs 3/3; `bun run typecheck`, `bun run lint`, five-file Biome format, and `git diff --check` passed. Full `bun run format:check` is blocked by unrelated concurrent `examples/agent-sdk-coding.ts` and `scripts/package-truth.mjs` formatting; broader docs selection hit unrelated missing `agent-sdk-coding.ts` in `examples/README.md`. Repo-wide search found no consumer of previously accepted noncanonical offset literals; the cursor error string/class remains unchanged. No migration, dependency, or public symbol change. Compatibility tradeoff: omitted `limit` still materializes the full branch; callers must supply a limit for bounded SQL rows, and the pure reader's 64-page cap would need review before changing the default.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; page cost and cursor behavior on public branch reads.
    - Docs pages to create/edit: `docs/session-stores.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md` (performance ceilings; not constant-time promise).
    - `docs/index.md` update: yes; update existing session store/database adapter nav descriptions to reflect bounded page reads.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 (P2): Measure and reduce multi-scope RAG query latency
  - Acceptance Criteria:
    - Functional: retrieval ranking/list order, citations, authorization and tombstone rechecks, abort behavior, and denial reporting match serial baseline across 1–8 scopes and vector/lexical legs.
    - Performance: measure serial 8-scope latency using delayed store; if material, use bounded concurrent per-scope calls (fixed internal cap, no new config); assert improvement under delayed fake and no unbounded >8 active queries. If no measurable benefit, record why serial stays.
    - Code Quality: use existing `Promise.all`/bounded batching and ordered result aggregation, not a new worker-pool dependency.
    - Security: no partial unauthorized output on one rejected leg; preserve exact-scope ACL filters and post-query grant/invalidation checks.
  - Approach:
    - Documentation Reviewed: `docs/rag.md` (per-scope `queryCandidates`, ACL legs, grant/tombstone rechecks), `docs/testing.md` (benchmark test isolation).
    - Options Considered: parallel all calls without bound (pool pressure); sequential baseline (high tail latency); bounded per-scope concurrency with deterministic ordered collection (chosen only after measurement).
    - Chosen Approach: baseline delayed-store fixture, then batch up to four exact-scope reads at a time within each vector, lexical, and lineage-invalidation phase. `Promise.allSettled` drains an in-flight batch before a failure/abort can flush audit; replay store denial reports in requested scope order, preserve vector-before-lexical RRF list order and grant/tombstone checks. No new public tuning knob.
    - API Notes and Examples:
      ```ts
      await retrieveContext("policy", { scopes: [scopeA, scopeB], store, embedder, lexical: "fts", authorization });
      // Same hits/order as serial baseline, fewer sequential store waits.
      ```
    - Files to Create/Edit:
      - `packages/memory/src/rag/retrieve.ts`, `packages/memory/src/rag/__tests__/rag.test.ts`, `packages/memory/src/rag/__tests__/access-recheck.test.ts` (retrieval ordering, concurrency, failure/abort, and authorization cases; pure fusion implementation/tests unchanged).
      - `docs/rag.md`, `docs/index.md`: measured per-scope latency trade-off and nav entry if query scheduling changes.
    - References: `packages/memory/src/rag/retrieve.ts` (vector/lexical loops, `fuseReciprocalRankLists`), existing access recheck tests.
  - Test Cases to Write:
    - Delayed scopes: ordered same hits/citations for 1–8 scopes, peak in-flight calls ≤4 across vector/lexical/tombstone phases, one store rejection and abort reject after draining current batch with no later batches.
    - Store denial callback order follows requested scope even if completion order is reversed; a different scope's rejected query still flushes already-settled denials; revoke during query and stale tombstoned rows never reach hit/citation output.
  - Completion evidence: Five repeated local 8-scope delayed-store hybrid runs (10 ms per read, no lineage, one embed) measured serial median 165.49 ms for 16 reads, peak 1; bounded four-way median 44.38 ms, peak 4 (~3.7× lower latency on this artificial I/O fixture). With an invalidation-capable fake, post-change 1-scope median 30.96 ms/peak 1 and 8-scope median 62.84 ms/peak 4 (24 reads). Timings are illustrative medians, not real-store p95 or throughput guarantees. `retrieveContext` now batches vector and lexical reads independently and lineage reads after both legs; scope-indexed `Promise.allSettled` preserves deterministic RRF ordering, waits for in-flight operations before propagating the first error/abort, and replays store denial callbacks by input scope before the final audit report. Fail-closed tests cover 1–8 scope hits/citations, bounded peak concurrency, foreign/drift refusal, failure/abort stopping later batches, cross-scope store-denial order including one rejected leg, in-flight grant revoke, stale tombstones, and method receiver binding. RAG + ACL + deletion-propagation suites: 103 pass, 4 optional live skips; focused post-edit retrieval/access suites 45/45; targeted docs 9/9 plus 4/4; `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check` passed. No dependency, public symbol, new option, extra query, or weakened ACL check. Trade-off: up to four concurrent reads per leg can increase store-pool pressure; failed/aborted batches wait for their outstanding calls, and hosts must size pools for four or select fewer scopes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if scheduling changes; observable latency and callback ordering (while returned order remains stable).
    - Docs pages to create/edit: `docs/rag.md` (request/latency and cap trade-off; default unchanged); if measurement rejects change, document evidence under `docs/history/133-review-remediation-primitive-review.md` only.
    - `docs/index.md` update: yes if scheduling changes — update existing RAG entry with bounded multi-scope retrieval; otherwise no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 (P2): Remove proven duplicate adapter query semantics without hiding dialect differences
  - Acceptance Criteria:
    - Functional: SQLite and PostgreSQL session-search/filter/cursor results remain equivalent under shared conformance scenarios; fixes from Tasks 2–7 remain intact.
    - Performance: no added query, SQL scan, or unbounded allocation in either adapter.
    - Code Quality: measurable reduction in duplicated pure validation/filter/cursor logic; keep actual SQL, FTS ranking, and parameter binding dialect-local; do not introduce an ORM, dependency, or single-implementation abstraction.
    - Security: existing ownership/redaction restrictions and parameter binding unchanged.
  - Approach:
    - Documentation Reviewed: `docs/database-persistence.md` (shared schema vs dialect-local SQL), `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, Task 1 primitive review.
    - Options Considered: giant SQL abstraction (reject); shared pure query resolution/cursor semantics with dialect-local execution (chosen if duplicated); leave irreducible SQL duplication in place (explicitly acceptable with evidence).
    - Chosen Approach: compare search CTEs, existing `resolveSessionSearchQuery`, cursor codecs, and adapter `queryTable` callers. Existing search validation, metadata redaction, and cursor encoding are already shared; FTS ranking, substring predicates, typed binds, and SQL text genuinely differ. Extract only the repeated tenant/account/user SQL-column ordering and presence check into a private `sessions/query-semantics.ts`; keep each dialect's bind syntax and SQL local. Do not export from the public codecs barrel.
    - API Notes and Examples:
      ```ts
      // Keep dialect adapters separate; use the same resolved query contract.
      const resolved = resolveSessionSearchQuery(query);
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/sqlite/persistence.ts`, `packages/prism-core/src/sessions/postgres/persistence.ts`.
      - `packages/prism-core/src/sessions/query-semantics.ts`: private ordered, present ownership columns/values; omit undefined but not empty strings.
      - `packages/prism-core/src/sessions/codecs/__tests__/parity.test.ts`, `packages/prism-core/src/sessions/codecs/__tests__/query-conformance.ts`, `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `packages/prism-core/src/sessions/postgres/__tests__/postgres-integration.test.ts`: pure binder order plus shared adapter search/query-page conformance. Existing public `src/testing/persistence-schema.ts` helpers unchanged.
    - References: search implementations beginning near SQLite line 845 and PostgreSQL line 848; existing `resolveSessionSearchQuery` and row codecs.
  - Test Cases to Write:
    - Pure ownership-column order, missing versus explicitly empty fields, bound injection-shaped values; existing branch/entry/run/session owner and cursor regressions stay green.
    - Same private fixture on both dialects: filter-only search with matched ownership/kind/time, equal-time asc/desc cursor pages, foreign/missing scope, malformed cursor/kind; scoped `querySessions` cursor and explicit-empty tenant. Compare normalized IDs, not dialect-specific FTS scores/snippets.
  - Completion evidence: removed the duplicated presence/order branches from both adapters' ownership-query builders and SQLite's separate value builder; one private ordered-column primitive now feeds dialect-local `?` and `$n` parameter binders. Production net ~13 lines fewer; zero new SQL calls, scans, dependencies, public exports, or schema changes. FTS5/`tsvector` search CTEs, metadata JSON predicates, score/snippet ranking, and SQL parameter numbering remain dialect-local; shared `resolveSessionSearchQuery` and cursor codec already covered pure validation/encoding. Pure test pins tenant/account/user order, empty-string scope, and injection-shaped bound values. A private shared fixture exercises scoped filter-only search, date bounds, timestamp ties, ascending/descending cursor pages, foreign scope, invalid filters/cursor, and scoped session paging on both dialects; existing shared store and persistence conformance continues to cover entry/branch/run ownership and cursor paths. Built-source SQLite + codec: 34/34 pass; local PostgreSQL 16-alpine integration: 22/22 pass. `bun run typecheck`, `bun run lint`, `bun run format:check`, and `git diff --check` passed. `bun run release:gate` reached release-evidence check but remains blocked by missing full `test:postgres` evidence (even with local `PRISM_TEST_POSTGRES_URL`); Task 12 owns full protected gate. Task 9 changes no package export map, public barrel, or compatibility baseline. Local root-package declarations in an installed `node_modules` snapshot were stale; refreshed that ignored copy from freshly built `dist` before the successful typecheck, with no tracked dependency/lockfile change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; internal-only consolidation with parity tests.
    - Docs pages to create/edit: none; adapters' current contracts documented in earlier tasks.
    - `docs/index.md` update: no; no behavior delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (internal-only change).

- [x] Task 10 (P1 gate): Close test blind spots using existing offline and service CI tiers
  - Acceptance Criteria:
    - Functional: Tasks 2–6 regressions run in mandatory offline SQLite/workflow/core suites and live PostgreSQL service job; NATS suite remains in existing protected workflow rather than new optional infrastructure.
    - Performance: keep `bun run test` within documented offline budget; measure overhead before broadening branch instrument to workspaces.
    - Code Quality: strengthen existing conformance/CI plumbing instead of adding another runner; explicitly report Bun 1.4.2 branch-data limitation (`branches: null`).
    - Security: cross-tenant entry-read regression cannot pass release verification if PostgreSQL suite is skipped; failed/missing service evidence remains blocked, not green.
  - Approach:
    - Documentation Reviewed: `docs/testing.md` (test stages, protected legs), `docs/live-testing.md`, `docs/_evidence/phase114-bun-coverage.md`, `scripts/coverage-thresholds.json`, `.github/workflows/{release,integration-postgres,integration-nats}.yml`.
    - Options Considered: require live services in every offline run (reject); add a second branch instrument (reject); put targeted regressions into current offline suite and existing PostgreSQL release job, assess expanded branch instrumentation separately (chosen).
    - Chosen Approach: use the existing exact-once offline stage partition and PostgreSQL/NATS service jobs; pin the named Tasks 2–6 offline regressions in the existing partition test. Harden the existing `test:postgres` evidence wrapper rather than adding another runner: count all four Bun reporter summaries (three workspace-prefixed plus phase conformance), require a nonempty passing result per leg and explicit passing PostgreSQL ownership, branch-filter, and monotonic-activity cases. Reject a skipped/missing regression even when unrelated tests pass. Keep core-only Node branch audit and Bun `branches: null` because Bun 1.4.2 still emits no BRDA; no workspace expansion, threshold change, or new CI job.
    - API Notes and Examples:
      ```bash
      bun run test && bun run test:coverage
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" bun run test:postgres
      bun scripts/branch-coverage-audit.mjs
      ```
    - Files to Create/Edit:
      - `scripts/run-all-tests.test.mjs`: pin built root, prism-core workflow, and SQLite regression names; existing partition test proves each file runs in one mandatory offline stage.
      - `scripts/postgres-evidence.mjs`, `scripts/postgres-evidence.test.mjs`: aggregate all four service leg reporters, require live case markers and a passing test per leg, simulate missing/skipped/failed evidence and no-URL refusal.
      - `docs/testing.md`: current evidence/skip contract; `scripts/branch-coverage-summary.json`: refreshed measurement artifact (86.34%, above unchanged 83.49% floor; the instrumented core suite failed on unrelated packaging tests).
      - No change to `src/testing/persistence-schema.ts`, adapters, workflow regressions, branch/coverage scripts or thresholds, `docs/live-testing.md`, `docs/index.md`, or CI YAML: the existing tests and service jobs already run the requested paths.
    - References: `package.json` (`test`, `test:coverage`, `test:postgres`, `release:gate`), `scripts/run-all-tests.mjs`, existing service workflows.
  - Test Cases to Write:
    - Named compiled offline regressions remain present in the root/workspace/SQLite exact-once stage partition; existing Tasks 2–6 regressions were red before implementation and their live assertions remain green. Removing each pinned name makes the partition regression test fail.
    - Simulate skipping each required PostgreSQL regression, dropping a complete service leg, a whole leg with zero passes, or a prefixed `(fail)`; no evidence document. Missing URL refuses before execution; release publish depends on the live PostgreSQL job. Bun 1.4.2 BRDA probe remains false, without fabricating a Bun branch floor.
  - Completion evidence: Existing `bun run test` stages own the root memory snapshot, prism-core workflow checkpoint, and SQLite scoped entry/branch/monotonic-activity regressions; targeted built tests 5/5 and offline SQLite stage passed 30/30. Existing `release.yml` `postgres-integration` runs `bun run test:postgres`, and `publish.needs` includes that job; standalone `integration-postgres.yml` also invokes prism-core `test:postgres`. Existing `integration-nats.yml` remains unchanged. Before repair, the PostgreSQL evidence wrapper silently counted only the unprefixed last 11 process tests and could accept unrelated green suites; now it aggregates and checks all four legs and demands three named live SQL regressions. Local `pgvector/pgvector:pg16` `PRISM_TEST_POSTGRES_URL=… bun run test:postgres` passed (core 78, memory 505, channels 2, process 11; evidence 596 tests, 590 pass, 0 fail, 6 opt-in skips), current-head evidence contains counts only. Negative tests drop/skip each SQL case, remove a leg, skip its only pass, fail a prefixed test, and unset the URL; targeted runner/evidence/manifest/BRDA tests 39/39. Bun 1.4.2 BRDA probe false; core Node branch audit measured 86.34% against unchanged 83.49% floor in ~19.3 s, but its instrumented suite failed unrelated packaging tests, so that audit did not pass. No workspace branch instrument added. Full offline `bun run test` took 108 s on this mixed working tree (<240 s wall-clock budget, not a green baseline): 4/9 stages passed including SQLite; 5 failed on unrelated concurrent package/inventory changes (`packages/agent-sdk` missing system-prompts subpath, added `packages/prism-code`, stale generated package truth, provider conformance error strings, invalid nested `node_modules` tree, and root packaging limits). `bun run typecheck`, `bun run lint`, task-file Biome format and `git diff --check` passed; repo-wide `bun run format:check` currently fails on concurrent unformatted `packages/prism-code/src/{config,providers,tool-modules}.ts`. With fresh PostgreSQL evidence, `release:gate` got past the missing-service block but stopped at concurrent `packages/prism-code` missing lockfile entry/dist. These unrelated full-gate failures remain for Task 12's final verification, not counted as green Task 10 evidence. No new dependency, runner, public symbol, CI job, or threshold.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; test/CI gate only.
    - Docs pages to create/edit: `docs/testing.md` (all-leg aggregation and required live SQL case evidence); no change to `docs/live-testing.md` because the live credential/skip matrix is unchanged.
    - `docs/index.md` update: no; no public behavior delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (gate docs only).

- [x] Task 11 (P3): Correct current installation, coverage, and adapter documentation drift
  - Acceptance Criteria:
    - Functional: README version/current-line matches manifests, `bun add` names actual published packages (subpaths only in imports), duplicate coverage entry gone; adapter docs have no duplicated search bullet/durable-events section or stale schema-version claim.
    - Performance: static docs/test scan only; no runtime changes.
    - Code Quality: preserve generated inventory delimiters and use existing package-truth generator; fix current-line guidance, put historical narrative only in history/changelog.
    - Security: install commands do not suggest unpinned/unpublished subpath packages or weaken lockfile guidance.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` (current manifest-derived inventory), `docs/index.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/testing.md`.
    - Options Considered: manually duplicate more package/version tables (reject); correct hand-authored README text, keep generator-owned inventory intact (chosen).
    - Chosen Approach: compare the hand-authored README/release/adapter pages against the root/workspace manifests and shared schema version 9. Install only owning package names, keep subpaths in import examples, delete duplicated coverage/search/event prose and move the obsolete 0.3.x versioning recipe behind the existing release-history link. Regenerate the manifest-derived package inventory with `bun scripts/package-truth.mjs --emit-docs` after the concurrently added `@arnilo/prism-code` manifest made the previous 13-package artifact stale; preserve historical Phase 54 legacy-package rows instead of reporting that retired 0.3.3 profile as a new 0.12.0 legacy release. Pin the corrected contract in the existing docs suite; derive package-count tests from truth instead of treating previous workspace counts as a current invariant.
    - API Notes and Examples:
      ```bash
      bun add @arnilo/prism @arnilo/prism-core
      # Import: @arnilo/prism-core/runtime/workflows
      bun scripts/package-truth.mjs --emit-docs
      ```
    - Files to Create/Edit:
      - `README.md`, `docs/release-and-install.md`: current 0.12.0 install/peer/package examples, single coverage row, historical versioning link; no subpath install commands.
      - `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/database-persistence.md`: one search description, one SQLite durable-events section, current schema v9/007–009 claims.
      - `docs/testing.md`: workspace-stage count follows manifests rather than a frozen 11-package line; `docs/index.md`: regenerate inventory and update current count without changing navigation entries.
      - `scripts/package-truth.json`: generator-owned 14-package current graph; `scripts/package-truth.test.mjs`, `src/__tests__/docs.test.ts`: dynamic count and focused docs drift regressions. `docs/_evidence/phase54-package-map.md` was regenerated and then its historical `@arnilo/prism-code@0.3.3` legacy rows restored; the new package-name collision is not resolved by this docs task.
    - References: root and workspace `package.json`, `scripts/package-truth.mjs`, `src/__tests__/docs.test.ts`.
  - Test Cases to Write:
    - Docs test parses each README/release `bun add` command and rejects an `@arnilo/*` name that is not in the generated manifest inventory (including `/runtime/*`); checks root version, peer, provider count, example dependency key, identical generated inventory blocks, exactly one README coverage row/release audit sentence, and adapter v9 migrations without duplicated search or SQLite durable-events sections.
    - Existing `truth-current` tests compare generated inventory with the current renderer; workspace-count unit tests follow the manifest graph and count one throwaway package.
  - Completion evidence: Root manifest and all 14 current workspace/root entries report 0.12.0 in generated `scripts/package-truth.json`; `README.md`, `docs/index.md`, and `docs/release-and-install.md` share the generated inventory verbatim. `bun add` examples name owning packages, never runtime/provider subpaths; README lists 22 provider adapter imports and has one coverage row; release page has one Node-branch audit sentence and a package-only JSON dependency example. SQLite/PostgreSQL describe schema v9 and migrations 007–009 (shared database page corrected), one search bullet each, and one SQLite durable-events section. Focused docs assertions 6/6, package-truth unit tests 2/2, manifest/truth and generated-block checks 2/2, root `tsc --noEmit`, task-file Biome lint/format, and `git diff --check` passed. Full docs run with `--timeout=0`: 157 pass, 2 fail from concurrently introduced `@arnilo/prism-code` (its name reuses a retired 0.3.3 profile, so the historical 55-retired-name gate detects only 54, and its initial CHANGELOG intentionally lacks 0.1.0/0.0.28 entries). Full generator truth suite: 10 pass, 2 fail because the concurrent workspace has no matching `bun.lock` entry and `renderGeneratedDocs` would rewrite historical Phase 54 profile evidence as `prism-code@0.12.0`; historical rows were preserved, not silently rebaselined. Repository `bun run typecheck` stops at concurrent `packages/prism-code/src/headless.ts` type errors; repo lint/format stop at unformatted and invalid code in that package; no Task 11 runtime code or security gate was weakened. Resolve package-name/lockfile/history collision with its owner before Task 12 final green gate; this documentation task does not claim full release verification.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime change; public installation guidance corrected.
    - Docs pages to create/edit: `docs/release-and-install.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/testing.md`; README and generator inventory in `docs/index.md` updated without a new navigation entry.
    - `docs/index.md` update: generated inventory/current-count correction only; existing release/adapter navigation remains accurate.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 12 (P1 verification, blocked): Run regression, service, release, and performance checks; review diff
  - Acceptance Criteria:
    - Functional: focused tests, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`, `bun run test:coverage`, and relevant live PostgreSQL suites pass; `bun run release:gate` reports no newly introduced removal/contract failure. Missing service evidence is explicitly blocked, not claimed as passed.
    - Performance: compare Task 1 baseline against branch pagination and multi-scope retrieval; no new regression to offline suite budget, branch p95 target or memory cap; record measurements.
    - Code Quality: review each touched file for unnecessary abstractions, imports, changes to public exports, and generated artifacts; leave pre-existing working-tree changes untouched.
    - Security: verify cross-tenant cases on both SQL backends, denial/revocation tests, and workflow external-effect count; reject ambiguous-green coverage/evidence.
  - Approach:
    - Documentation Reviewed: `docs/testing.md`, `docs/live-testing.md`, `docs/release-and-install.md` (`sdk:ready`, release gate), `docs/_evidence/phase114-bun-coverage.md`.
    - Options Considered: trust offline green for protected DB (reject); run existing service-backed jobs and report blocked local environment separately (chosen).
    - Chosen Approach: run targeted suites first, then full gates and live suites with `PRISM_TEST_POSTGRES_URL`; inspect package/public API diff. No public symbol move/rename/removal planned. If execution unexpectedly changes one, explicitly run `node scripts/release.mjs gate --update-baseline` on supported release host, list affected `scripts/compat-baseline/` files, distinguish this plan's removals from inherited ones, and require post-regeneration `release:gate` diff review before completion.
    - API Notes and Examples:
      ```bash
      bun run typecheck && bun run lint && bun run format:check
      bun run test && bun run test:coverage && bun run release:gate
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" bun run test:postgres
      ```
    - Files to Create/Edit:
      - `plans/133-Cross-Package-Review-Remediation.md`: record evidence, trade-offs, gate outcome and any blocked leg.
      - `scripts/compat-baseline/` (conditional **only** after reviewed public removal/rename and `node scripts/release.mjs gate --update-baseline`; not expected).
    - References: `package.json` scripts; `.github/workflows/release.yml` and `.github/workflows/integration-postgres.yml`; `git status --short` for pre-existing modifications.
  - Test Cases to Write:
    - No new suites beyond Tasks 2–11; record commands, pass counts, timings, and blocked protected legs in plan note.
  - Verification evidence (2026-09-27, mixed uncommitted workspace; **not release-green**):
    - `bun run typecheck` passed (8 s), `bun run lint` passed (2 s), `bun run format:check` passed (1 s), `bun run pack:dry-run` passed (3 s), and `git diff --check` passed. Six built-source focused files covering session ingest snapshots, SQLite branch/owner/timestamp contracts, workflow checkpoint/external-effect counters, and RAG access denial/revocation passed **147/147** in 2 s.
    - Ephemeral loopback-only `pgvector/pgvector:pg16` service: `PRISM_TEST_POSTGRES_URL=… bun run test:postgres` passed all four protected legs in 23 s (core 78, memory 499 pass/6 optional skips, channels 2, process 11): **590 pass, 0 fail, 6 skip**. Current-HEAD count-only `scripts/postgres-evidence.json` generated. Live entry ownership, leaf filters/cursors, monotonic session activity, and bounded branch reads passed. The SQLite equivalents, RAG in-flight revocation/denial, and workflow post-effect checkpoint failure counter also passed in focused tests. No tenant-scope test was relaxed.
    - `bun run test`: **147 s**, below the 240 s offline wall-clock ceiling but **6/9 stages failed** (performance budget, root, gate, build race, workspace, Node branch coverage); only build, SQLite, and examples stages passed. The budget stage detected 551 non-null assertions in `src/` against the recorded 550. Root had 7 failures including a new root runtime dependency (`@opentui/core`), 14-vs-13 package assertions, the reused retired `@arnilo/prism-code` name/history, its missing legacy changelog, npm dependency-tree drift, and scaffold installation. Gate tests additionally failed on the missing `prism-code` lockfile/baseline/e2e inventory, stale Phase 54 evidence, and an unresolved Phase 11 hostile-input assertion. Workspace provider conformance reported nine failures, and two build-race cases failed. The Node branch audit **measured 86.34% versus 83.49% floor** but failed because its instrumented suite was red; do not treat the percentage as passing branch coverage.
    - `bun run test:coverage` failed after 163 s: root **2125 pass/7 fail**, providers **645 pass/97 skip/9 fail**; `@arnilo/prism-code` has no coverage threshold. No green coverage artifact. `PRISM_TEST_POSTGRES_URL=… bun run release:gate` refused to release with two coverage blocks (providers and prism-code), even though the live PostgreSQL leg passed. The bare release gate also reported missing URL, as designed. Direct version/compat check found `bun.lock` missing `packages/prism-code` and no `scripts/compat-baseline/arnilo__prism-code.txt`; **do not regenerate a baseline to hide this**. Compared to `HEAD`, all 12 packages with tracked existing compatibility baselines had **zero removed and zero changed declarations** (additions only: root +1, core +4, work +24); the new agent SDK has no `HEAD` baseline and prism-code still needs review.
    - Quiet-host 300-entry equal-timestamp branch probe with `limit: 2`: SQLite file DB, 40 first/deep samples, p50 **22.387/22.506 ms**, p95 **26.998/27.753 ms**; PostgreSQL after `ANALYZE`, 30 samples, p50 **10.180/10.263 ms**, p95 **10.960/11.404 ms**. First/deep pages both stayed under the local 50 ms p95 target; instrumented adapter tests limit SQL results to at most `limit + 1` (counts `[3,3,3,2]`), but recursive traversal remains O(depth). Task 1's ~14.8 ms SQLite cold run and Task 7's ~22.4 ms warm median are different conditions; no cold-speedup claim. Separate eight-scope fake RAG hybrid probe (16 delayed 10 ms reads, seven runs) measured **41.30 ms median / 43.74 ms p95**, peak **4** in flight versus Task 1's ~162.7 ms serial median/peak 1; store failures, audit order, and revoke scenarios remain covered by focused tests. Process RSS snapshots were ~61 MiB SQLite, 62.9 MiB PostgreSQL, and 51.1 MiB RAG; they are observations, not an enforced memory ceiling.
    - Diff review: Task 2–9 adapter/workflow/RAG and shared-conformance code remains scoped and covered by focused/live tests, with dialect SQL local and existing codecs reused. No new dependency or runtime abstraction for this verification task. `git diff --check` clean; additive public surface only in tracked-baseline packages; generated truth, legacy Phase 54 evidence, coverage, and new-package inventories are **not** mutually consistent yet. Pre-existing/concurrent files were not edited in this task. Release/coverage gates fail closed rather than accepting incomplete service or package evidence.
  - Next unblock: reconcile the concurrently introduced `@arnilo/prism-code` manifest/name with the retired profile and legacy evidence; move `@opentui/core` out of the root runtime dependencies if only the app needs it; update lockfile, package truth, e2e/coverage inventory and a reviewed compatibility baseline; repair genuine provider conformance, hostile-input, scaffold, and build-race failures; restore the non-null budget or remove the new assertion; then rerun the complete offline, coverage, PostgreSQL, and release gates. Keep Task 12 unchecked until the acceptance criteria pass. `Compromises Made`/`Further Actions` backlog handoff remains deferred until plan-end review, not invented from a failed release.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional behavior beyond earlier tasks.
    - Docs pages to create/edit: none unless gate shows inaccurate documentation.
    - `docs/index.md` update: no; earlier tasks own navigation edits.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.
- Backlog handoff (plan end only, after this section is reviewed — not while drafting): append every compromise here to `plans/backlog.md` as a task. Create that file if missing; do not create it when this section has no items. Copy, do not remove these items. Skip an entry that already has the same source plan, section, and title; update it in place. After writing, add one line here: `Recorded in plans/backlog.md.` Entry shape:
  - `## <task title>` — the follow-up that revisits or undoes the compromise
  - Section: `Compromises Made`
  - Priority: `P1` | `P2` | `P3` | `P4` (`P1` highest; assign one if the item has none, and record it here too)
  - Source: `plans/133-Cross-Package-Review-Remediation.md`
  - Compromise: what compromise was made
  - Implications: what that compromise costs or risks

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
- Backlog handoff (plan end only, after this section is reviewed — not while drafting): append every item here to `plans/backlog.md`. Create that file if missing; do not create it when this section has no items. Copy, do not remove these items. Skip an entry that already has the same source plan, section, and title; update it in place. After writing, add one line here: `Recorded in plans/backlog.md.` Entry shape:
  - `## <title>`
  - Section: `Further Actions`
  - Priority: `P1` | `P2` | `P3` | `P4` (`P1` highest; assign one if the item has none, and record it here too)
  - Source: `plans/133-Cross-Package-Review-Remediation.md`
  - What: what the task is
  - Why: why it is needed
