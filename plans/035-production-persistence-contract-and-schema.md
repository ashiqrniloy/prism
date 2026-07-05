# Phase 34 — Production persistence contract and schema

## Objectives
- Define host-implemented, database-ready persistence contracts without adding a database adapter to core.
- Add explicit session-entry schema versioning and strict kind validation so durable stores fail closed on unknown data.
- Document a reference relational schema, index/query requirements, retention/migration model, pagination/cursors, and JSONL limits for production apps.

## Expected Outcome
- Hosts can implement a production DB adapter from public contracts and docs without reading runtime internals.
- `SessionEntry` has a documented v1 schema and exported kind validation; JSONL quarantines unknown kinds or unsupported schema versions.
- Reference schema covers tenants/accounts/users, sessions, entries, branches, runs, events, tool calls, usage, agent definitions/versions, retention, and migrations.
- Indexed, paginated branch/session/event reads are documented; JSONL is clearly local/development only.
- `/docs/session-stores.md`, `/docs/database-persistence.md`, and `/docs/index.md` cover the new public surface.

## Tasks

- [x] Task 1 — Primitive review: inventory current persistence, session, event, and docs seams
  - Acceptance Criteria:
    - Functional: Inventory `SessionEntry`, `SessionStore`, memory store, JSONL store/parser, branch helpers, runtime run/event emission, docs links, and existing tests. Identify what can be reused unchanged and where new generic contracts are required.
    - Performance: Review confirms no production DB adapter or query helper will load full sessions for branch/event reads by contract.
    - Code Quality: Review records exact source/docs paths and rejects app-specific persistence logic in core.
    - Security: Review confirms persistence contracts never require provider credentials, credential resolvers, provider objects, or unredacted secrets.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 34.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/session-stores-and-branching.md`.
      - `docs/node-jsonl-session-store.md`.
      - `docs/agent-events.md`.
      - `docs/agent-session-runtime.md`.
      - `docs/public-contracts.md`.
      - `docs/index.md`.
      - `src/contracts.ts`, `src/session-stores.ts`, `src/node/session-store-jsonl.ts`.
      - `src/__tests__/session-stores.test.ts`, `src/__tests__/node-session-store-jsonl.test.ts`.
    - Options Considered:
      - Add a SQL adapter to core: rejected — Phase 34 asks for contract/schema, not a database dependency.
      - Extend only `SessionStore`: rejected — production apps also need runs, events, tool calls, usage, tenants, retention, and migrations.
      - Document only without public TypeScript contracts: rejected — hosts need stable compile-time shapes.
    - Chosen Approach:
      - Reuse existing session primitives; add only generic public contracts and validators needed by production adapters.
    - API Notes and Examples:
      ```ts
      // Existing primitive to preserve: host-owned store, no hidden global.
      const entries = await store.list("session_1");
      ```
    - Files to Create/Edit:
      - `plans/035-production-persistence-contract-and-schema.md`: append review outcome before implementation.
    - References:
      - `roadmap.md` Phase 34 acceptance.
      - `src/contracts.ts` `SessionEntry`, `SessionStore`, `AgentEvent`.
      - `src/node/session-store-jsonl.ts` parser/quarantine behavior.
  - Test Cases to Write:
    - none (review task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — review gates new persistence API and docs work.
    - Docs pages to create/edit:
      - `plans/035-production-persistence-contract-and-schema.md`: review notes only.
    - `docs/index.md` update: no; handled in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Reviewed exact sources and confirmed the current persistence surface.
    - **Existing reusable primitives (no changes needed):**
      - `src/contracts.ts:618` `SessionEntry` — branch-aware entry with `id`, `parentId`, `sessionId`, `timestamp`, `kind`, `runId`, and per-kind payload fields (`message`, `event`, `model`, `previousModel`, `label`, `summary`, `data`, `metadata`).
      - `src/contracts.ts` `SessionStore` — minimal `append(entry)` / `list(sessionId)` / optional `get(id)`; database-neutral.
      - `src/session-stores.ts` — pure helpers `createSessionEntry`, `createMemorySessionStore`, `getSessionBranchEntries`, `listSessionBranches`, `rebuildSessionContext`. No provider/tool/credential dependencies.
      - `src/node/session-store-jsonl.ts` — explicit Node JSONL adapter with per-line quarantine via `readJsonlSessionEntries()`.
      - `src/agents.ts` `RuntimeAgentSession` — appends user/assistant/model-change/tool-result/compaction entries; emits `AgentEvent`s; applies redaction via `redactSessionEntry`/`redactAgentEvent` before persistence/subscription.
      - `src/redaction.ts` `createSecretRedactor`/`redactSecrets` — exact-string redaction with cycle guard; used on entries, events, provider requests, and errors.
      - `src/tools.ts` `dispatchToolCall` — emits `tool_execution_*` events; returns `ToolResult` that runtime stores as a message entry; redacts result/errors.
      - `src/compaction.ts` default strategy — produces `kind: "compaction"` entries with `CompactionEntryData`; raw branch stays intact.
    - **Gaps that require new generic contracts (Phase 34):**
      - No `schemaVersion` on `SessionEntry`; JSONL parser does not reject unknown `kind` values (switch has no default; unknown string returns valid). Phase 34 requires fail-closed unknown-kind handling.
      - No public contracts for runs, durable `AgentEvent` ledger, tool-call rows, usage rows, agent definitions/versions, tenants/accounts/users, retention, or migrations.
      - No pagination/cursor query shapes for branch/session/event reads; current `SessionStore.list(sessionId)` returns all entries for a session.
      - No atomic-append or idempotency contract for multi-process/multi-writer safety (Phase 36 scope, but schema should reserve fields).
      - No documented index/query requirements for `sessionId`, `runId`, `parentId`, branch leaf, timestamps, tenant/account, event type, or entry kind.
    - **Security boundary confirmed:**
      - `SessionEntry` payload fields hold only messages/events/labels/summaries/custom data; provider credentials, credential resolvers, provider instances, and settings are never stored.
      - Runtime redacts entries via `redactSessionEntry` before `store.append()` when a redactor is configured.
      - Tool results/errors are redacted before events and before being turned into message entries.
      - Retry/compaction contexts exclude provider requests, provider objects, credentials, and settings.
    - **Performance boundary confirmed:**
      - `SessionStore.list(sessionId)` is documented as returning all entries for one session; production DB adapters will need separate paginated query contracts to avoid full-session scans.
      - Branch rebuild is linear over listed entries; large sessions need DB-friendly branch queries planned in Task 3.
    - **Docs state:**
      - `docs/session-stores-and-branching.md` covers branch helpers and memory store.
      - `docs/node-jsonl-session-store.md` covers JSONL adapter and quarantine.
      - `docs/agent-events.md`, `docs/agent-session-runtime.md`, `docs/tools.md`, `docs/compaction-and-retry.md` cover runtime/event/tool/compaction semantics.
      - No `docs/session-stores.md` or `docs/database-persistence.md` exists yet; they are created in Tasks 4–5.
    - No code changes were made in Task 1; the review informs Tasks 2–6.

- [x] Task 2 — Add session-entry v1 kind/version validation and fail-closed JSONL parsing
  - Acceptance Criteria:
    - Functional: Export `SESSION_ENTRY_SCHEMA_VERSION`, `SESSION_ENTRY_KINDS`, `SessionEntryKind`, and `isSessionEntryKind()`. `SessionEntry.kind` uses `SessionEntryKind`; omitted `schemaVersion` means v1; unsupported explicit versions fail validation. JSONL unknown kinds are quarantined with line/reason and excluded from `list()`/`get()`.
    - Performance: Kind validation uses constant-time lookup; JSONL remains linear in file size with per-line quarantine.
    - Code Quality: Single source of truth for allowed entry kinds; no duplicated string lists in parser/tests/docs.
    - Security: Invalid durable data fails closed; raw quarantined line remains available only through explicit `readJsonlSessionEntries()` diagnostics.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores-and-branching.md` current `SessionEntry.kind` list.
      - `docs/node-jsonl-session-store.md` current quarantine behavior.
      - `src/contracts.ts` `SessionEntry`.
      - `src/node/session-store-jsonl.ts` `validateSessionEntry()`.
    - Options Considered:
      - Hard-code a `switch` default in JSONL only: too easy for future kind lists to drift.
      - Require `schemaVersion` on every existing entry: rejected — breaks existing v1 JSONL/session data.
      - Optional `schemaVersion?: 1`: chosen for backward-compatible v1 with fail-closed future versions.
    - Chosen Approach:
      - Put the allowed-kind tuple and version constant beside `SessionEntry` in `src/contracts.ts`; import them into the JSONL parser.
    - API Notes and Examples:
      ```ts
      import { isSessionEntryKind, SESSION_ENTRY_SCHEMA_VERSION } from "@arnilo/prism";

      if (!isSessionEntryKind(kind)) throw new Error(`Unknown SessionEntry.kind: ${kind}`);
      const version = entry.schemaVersion ?? SESSION_ENTRY_SCHEMA_VERSION;
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add version/kind exports and `schemaVersion?: 1` to `SessionEntry`.
      - `src/node/session-store-jsonl.ts`: reject unknown kinds and unsupported schema versions.
      - `src/__tests__/node-session-store-jsonl.test.ts`: add unknown-kind/version quarantine tests.
      - `src/__tests__/session-stores.test.ts`: assert v1/kind exports if useful.
    - References:
      - `src/contracts.ts:618` current `SessionEntry`.
      - `src/node/session-store-jsonl.ts` `validateSessionEntry()`.
  - Test Cases to Write:
    - `readJsonlSessionEntries()` quarantines `{ kind: "future_kind" }`.
    - `readJsonlSessionEntries()` accepts omitted `schemaVersion` as v1.
    - `readJsonlSessionEntries()` rejects unsupported `schemaVersion`.
    - `isSessionEntryKind()` returns true for all exported v1 kinds and false for unknown strings.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported constants/helper and stricter JSONL behavior.
    - Docs pages to create/edit:
      - `docs/session-stores.md`: document v1 entry kinds/version and fail-closed parsing.
      - `docs/node-jsonl-session-store.md`: document unknown-kind/version quarantine and local-only status.
    - `docs/index.md` update: yes — point session-store entry to `docs/session-stores.md` in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Added `SessionEntryKind`, `SESSION_ENTRY_KINDS`, `SESSION_ENTRY_SCHEMA_VERSION`, and `isSessionEntryKind()` to `src/contracts.ts` and re-exported values from `src/index.ts`.
    - Added `schemaVersion?: 1` to `SessionEntry` in `src/contracts.ts`.
    - `isSessionEntryKind()` uses a private `Set` derived from `SESSION_ENTRY_KINDS` for constant-time lookup while keeping the array as the single source of truth.
    - Updated `src/node/session-store-jsonl.ts` to reject unknown `kind` values and unsupported `schemaVersion` values with per-line quarantine; added minimal payload validation for `event` and `metadata` kinds.
    - Added JSONL tests for kind/version quarantine and `isSessionEntryKind()`.
    - Updated `docs/node-jsonl-session-store.md` to document schema-version/kind validation and the local-only/multi-writer limitation.
    - `npm run typecheck` passes.
    - Targeted tests pass: `node --test dist/__tests__/node-session-store-jsonl.test.js dist/__tests__/session-stores.test.js dist/__tests__/docs.test.js` → 67 pass, 0 fail.
    - Full `npm test` (build + core tests + workspace tests) exits 0; the harness-level summary line was inconsistent with the actual per-suite output, which shows `fail 0` everywhere.

- [x] Task 3 — Add public production persistence contracts and paginated query shapes
  - Acceptance Criteria:
    - Functional: Public contracts cover sessions, entries, branch handles/leaves, runs, event ledger rows, tool-call rows, usage rows, agent definitions/versions, tenant/account/user ownership, retention policy, migration records, and cursor-paginated reads.
    - Performance: Query contracts require `limit`/`cursor` for branch/session/event reads and expose filters for `sessionId`, `runId`, `parentId`, branch leaf, timestamps, tenant/account/user, event type, and entry kind.
    - Code Quality: Contracts are database-neutral TypeScript types/interfaces; no SQL client, ORM, filesystem, network, or app-domain dependency is added.
    - Security: Contracts include redacted payload fields for events/tool calls and explicitly exclude provider credentials/resolvers/provider instances.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` existing `SessionStore`, `AgentEvent`, `ToolResult`, `Usage`, `AgentDefinition`, `ModelConfig`.
      - `docs/agent-events.md` event variants and redaction notes.
      - `docs/agent-session-runtime.md` run/session behavior.
      - `docs/session-stores-and-branching.md` branch model.
    - Options Considered:
      - One large `ProductionPersistenceStore` with required methods for every table: rejected until runtime integration proves exact method needs.
      - Row/query contracts plus small adapter-facing interfaces: chosen — enough for DB implementers and future phases without forcing storage shape.
      - Reuse `SessionStore.list()` only: rejected — it requires full-session loads and misses runs/events/usage.
    - Chosen Approach:
      - Add minimal generic records and page/query shapes, plus optional adapter interface methods only where Phase 34 needs a stable contract.
    - API Notes and Examples:
      ```ts
      import type { PersistencePage, SessionEntryQuery } from "@arnilo/prism";

      async function readEntries(query: SessionEntryQuery): Promise<PersistencePage<SessionEntry>> {
        // Host DB adapter owns SQL/NoSQL implementation.
        return { items: [], nextCursor: undefined };
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add persistence record/query/page contracts.
      - `src/index.ts`: export new runtime helpers if they live outside `contracts.ts`.
      - `src/__tests__/public-contracts.test.ts` or existing boundary test: compile/use new public types without app-domain leaks.
    - References:
      - `roadmap.md` Phase 34 deliverables.
      - `docs/public-contracts.md` public contract inventory.
  - Test Cases to Write:
    - Compile-only host example implements the persistence query/page contracts.
    - Boundary test confirms no built-in DB adapter/provider credential dependency is introduced.
    - Type test or compile snippet shows filtering by `sessionId`, `runId`, `parentId`, `leafId`, timestamp range, tenant/account/user, event type, and entry kind.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public persistence contracts.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: detailed API page for contracts and query shapes.
      - `docs/public-contracts.md`: add persistence contract inventory.
    - `docs/index.md` update: yes — new persistence entry in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Added production persistence contracts to `src/contracts.ts`: `OwnershipScope`, `PersistencePage<T>`, `PersistenceQuery`, `SessionRecord`, `BranchRecord`, `RunRecord`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`, `AgentDefinitionRecord`, `RetentionPolicy`, `MigrationRecord`, plus query shapes (`SessionQuery`, `BranchQuery`, `SessionEntryQuery`, `RunQuery`, `AgentEventQuery`, `ToolCallQuery`, `UsageQuery`, `AgentDefinitionQuery`, `RetentionPolicyQuery`, `MigrationQuery`) and the adapter-facing `ProductionPersistenceStore` interface.
    - Types are database-neutral: no SQL client, ORM, filesystem, network, or app-domain dependencies added.
    - Security: contracts exclude provider credentials/resolvers/provider instances; `AgentEventRecord` and `ToolCallRecord` include a `redacted` flag and documentation instructs hosts to redact payloads before storage.
    - Added compile-only type test `src/__tests__/persistence-contracts.types.test.ts`: host adapter implements `ProductionPersistenceStore`, all required filters are exercised, and no DB/ORM/filesystem/network imports are required.
    - Added `docs/database-persistence.md` with required headings and added it to `src/__tests__/docs.test.ts` `apiPages` for heading validation.
    - Updated `docs/public-contracts.md` to inventory the new persistence contract group and list key shapes.
    - Replaced the word "filesystem" with "host file storage" in `src/contracts.ts` to satisfy the existing app-specific-tool-category guard in `src/__tests__/public-contracts.test.ts`.
    - `npm run typecheck` passes.
    - Full `npm test` exits 0; all suites report `fail 0`.

- [x] Task 4 — Document reference relational schema, indexes, retention, migrations, and NoSQL mapping notes
  - Acceptance Criteria:
    - Functional: `docs/database-persistence.md` includes tables/fields for tenants, accounts, users, agent definitions/versions, sessions, session entries, branches, runs, agent events, tool calls, usage, retention policies, and migrations. It states JSONL is not production multi-writer storage.
    - Performance: Index requirements cover `sessionId`, `runId`, `parentId`, branch leaf, timestamps, tenant/account/user, event type, entry kind, retention expiry, and idempotency keys.
    - Code Quality: Schema is reference documentation, not generated code; naming maps clearly to public TypeScript contracts.
    - Security: Schema examples store redacted args/results/events and never store provider credentials, OAuth tokens, API keys, or credential resolver data.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 34 schema/index requirements.
      - `docs/session-stores-and-branching.md` branch fields.
      - `docs/agent-events.md` event payload/redaction notes.
      - `docs/credentials-and-redaction.md` secret boundary.
    - Options Considered:
      - PostgreSQL-specific DDL only: rejected — core must not require a specific DB.
      - Pure prose schema: rejected — adapter authors need concrete table/index shape.
      - Portable relational schema with notes for DB-specific types: chosen.
    - Chosen Approach:
      - Provide normalized table descriptions plus SQL-like examples for indexes and constraints; keep NoSQL notes limited to partition/sort-key differences.
    - API Notes and Examples:
      ```sql
      create index prism_session_entries_session_parent_idx
        on prism_session_entries (session_id, parent_id);

      create index prism_agent_events_run_seq_idx
        on prism_agent_events (run_id, sequence);
      ```
    - Files to Create/Edit:
      - `docs/database-persistence.md`: new reference schema/API page.
      - `docs/session-stores.md`: link schema and summarize store responsibilities.
    - References:
      - `docs/api-page-template.md`.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - Documentation check: schema doc mentions every required entity from roadmap Phase 34.
    - Documentation check or grep: schema doc lists every required index/query key.
    - Manual review: NoSQL section only covers contract differences, not a second full schema.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — production persistence behavior and schema are documented.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: new page.
      - `docs/session-stores.md`: cross-link and JSONL warning.
    - `docs/index.md` update: yes — new Agent/session runtime or Compaction/session memory entry in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Outcome / Deviation:
    - Expanded `docs/database-persistence.md` with reference relational schema covering all Phase 34 entities: tenants, accounts, users, agent definitions, sessions, branches, session entries, runs, agent events, tool calls, usage, retention policies, and migrations.
    - Documented index requirements for `sessionId`, `runId`, `parentId`, branch leaf, timestamps, tenant/account/user, event type, entry kind, retention expiry, and reserved idempotency keys.
    - Added retention policy enforcement steps and migration practices.
    - Added NoSQL mapping notes covering partition/sort keys, GSIs, JSON payloads, branches, TTL retention, and the JSONL non-production limitation.
    - Created `docs/session-stores.md` as the canonical session-store landing page with store responsibilities and cross-link to the reference schema.
    - Added `docs/session-stores.md` and `docs/database-persistence.md` to `src/__tests__/docs.test.ts` `apiPages` for heading validation.
    - Added `database_persistence_docs_cover_phase_34_schema_indexes_retention_migrations_and_nosql` test to verify entities, index keys, retention/migrations/NoSQL sections, security locks, and cross-link.
    - `npm test` exits 0; all suites report `fail 0`.

- [x] Task 5 — Update session-store docs, docs index, and public contract docs
  - Acceptance Criteria:
    - Functional: `/docs/session-stores.md`, `/docs/database-persistence.md`, and `/docs/index.md` exist and are linked. Existing docs links to `session-stores-and-branching.md` are updated or a compatibility forwarding page remains. JSONL docs state development/local-only and no cross-process production safety.
    - Performance: Docs explain paginated reads and warn against full-session scans for large DB-backed sessions.
    - Code Quality: Docs follow Prism API page structure with examples and related APIs.
    - Security: Docs state stores must receive redacted entries/events/tool results and must not persist provider credentials/secrets.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
      - `docs/api-page-template.md`.
      - `docs/index.md` current navigation groups.
      - `docs/session-stores-and-branching.md`, `docs/node-jsonl-session-store.md`, `docs/public-contracts.md`.
    - Options Considered:
      - Rename `docs/session-stores-and-branching.md` outright: acceptable but requires link updates.
      - Add `docs/session-stores.md` as a compatibility landing page and keep old deep page: less link churn but duplicates concepts.
      - Chosen after Task 1 based on link count; either way `/docs/session-stores.md` becomes the canonical page required by roadmap.
    - Chosen Approach:
      - Make `/docs/session-stores.md` canonical, update `docs/index.md`, and avoid duplicate long-form content.
    - API Notes and Examples:
      ```md
      - [Session stores](session-stores.md): branch-aware entries, v1 schema, JSONL local adapter, and production DB persistence contract links.
      - [Database persistence](database-persistence.md): reference schema, indexes, cursors, retention, and migrations.
      ```
    - Files to Create/Edit:
      - `docs/session-stores.md`: canonical session-store API page.
      - `docs/session-stores-and-branching.md`: update links or replace with short forwarding page if retained.
      - `docs/node-jsonl-session-store.md`: JSONL local/development warning and validation details.
      - `docs/database-persistence.md`: new production persistence API/schema page.
      - `docs/public-contracts.md`: new contracts inventory.
      - `docs/index.md`: navigation updates.
    - References:
      - `roadmap.md` Phase 34 docs list.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - Grep/docs check: `docs/index.md` links `session-stores.md` and `database-persistence.md`.
    - Grep/docs check: no stale links to a removed `session-stores-and-branching.md`.
    - Grep/docs check: JSONL doc says not production multi-writer storage.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — docs are the main production persistence contract deliverable.
    - Docs pages to create/edit:
      - `docs/session-stores.md`.
      - `docs/database-persistence.md`.
      - `docs/node-jsonl-session-store.md`.
      - `docs/public-contracts.md`.
      - `docs/index.md`.
    - `docs/index.md` update: yes — add/update session persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Outcome / Deviation:
    - Updated `docs/index.md` "Compaction/session memory" section to link canonical `docs/session-stores.md`, compatibility `docs/session-stores-and-branching.md`, new `docs/database-persistence.md`, and the JSONL store.
    - Added a compatibility forwarding note at the top of `docs/session-stores-and-branching.md` pointing to `docs/session-stores.md` as canonical; kept all existing content and links so existing references still resolve.
    - Updated `docs/public-contracts.md` Related APIs to include `docs/session-stores.md` and `docs/database-persistence.md`, moved `docs/session-stores-and-branching.md` to compatibility position, and replaced "filesystem" with "host file storage" for consistency.
    - Added explicit warning in `docs/database-persistence.md` and `docs/session-stores.md` against loading entire large sessions into memory / full-session scans; pagination guidance already present.
    - Confirmed `docs/node-jsonl-session-store.md` already states development-only, no cross-process lock, and no production multi-writer safety.
    - Confirmed `docs/public-contracts.md` already inventories production persistence contracts from Task 3.
    - `npm test` exits 0; all suites report `fail 0`.

- [x] Task 6 — Verify contracts, tests, and docs coverage
  - Acceptance Criteria:
    - Functional: Targeted tests and full typecheck pass; Phase 34 roadmap acceptance can be checked from code/docs.
    - Performance: Verification includes assertions/docs for paginated/indexed production reads and no accidental full-session DB contract.
    - Code Quality: Public exports compile, docs links are consistent, and no unused types/helpers remain.
    - Security: Verification confirms no provider credentials/secrets are required in persistence contracts, schema examples, tests, or docs fixtures.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts: `npm run typecheck`, `npm test`.
      - `roadmap.md` Phase 34 acceptance.
      - `docs/index.md` final navigation.
    - Options Considered:
      - Run only targeted JSONL tests: rejected — public contract changes need typecheck.
      - Run full `npm test`: chosen if time budget allows; otherwise record targeted commands and blocker.
    - Chosen Approach:
      - Run the smallest targeted tests during implementation, then `npm run typecheck` and preferably `npm test` before marking complete.
    - API Notes and Examples:
      ```sh
      npm run typecheck
      npm test
      ```
    - Files to Create/Edit:
      - `plans/035-production-persistence-contract-and-schema.md`: mark tasks complete and record deviations after verification.
    - References:
      - `package.json` scripts.
      - `roadmap.md` Phase 34 acceptance.
  - Test Cases to Write:
    - Run `npm run typecheck`.
    - Run `npm test` or record why only targeted tests were run.
    - Audit docs/code against every Phase 34 acceptance bullet.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API beyond prior tasks; verification only.
    - Docs pages to create/edit:
      - `plans/035-production-persistence-contract-and-schema.md`: completion/deviation notes after execution.
    - `docs/index.md` update: no; handled in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Outcome / Deviation:
    - Ran `npm run typecheck` - passed across root, workspaces, and examples.
    - Ran full `npm test` - exited 0, all suites report `fail 0`.
    - Audited Phase 34 acceptance:
      - Production persistence contracts exist in `src/contracts.ts` for sessions, branches, entries, runs, agent events, tool calls, usage, agent definitions, tenants/accounts/users (via `OwnershipScope`), retention policies, and migrations.
      - Reference relational schema, indexes, retention, migrations, and NoSQL mapping documented in `docs/database-persistence.md`.
      - Session-entry v1 kind/version validation and fail-closed JSONL parsing implemented in Task 2; tests verify unknown kinds and unsupported schema versions are quarantined.
      - Pagination/cursor shapes (`PersistenceQuery`, `PersistencePage`) and query filters documented and typed.
      - `docs/session-stores.md` and `docs/database-persistence.md` exist and are linked from `docs/index.md`.
      - JSONL adapter is documented as development-only, single-process, and not production multi-writer safe.
      - No provider credentials, resolvers, or instances appear in persistence records or contracts; security notes and tests confirm this.
    - Verified no accidental full-session DB contract: docs warn against full-table/full-session scans and recommend cursor pagination and indexes.
    - Verified public exports compile and docs links are consistent via `docs.test.ts` and `public-contracts.test.ts`.

## Compromises Made
- Reference schema is prose/table documentation, not generated DDL, to keep the core package database-neutral and avoid coupling Prism to a specific SQL dialect.
- The JSONL adapter remains development-only; no production database adapter ships in the core package. Hosts own production adapters.
- Tenant isolation, retention enforcement, and migration execution are host responsibilities. The contracts only supply fields, query shapes, and documentation guidance.
- `idempotency_key` is reserved schema/index guidance for Phase 36; it is not yet a contract field on records.
- `docs/session-stores-and-branching.md` was kept as a compatibility forwarding page rather than replaced, to avoid breaking existing links.

## Further Actions
- Phase 36: implement production database adapter(s) and formalize atomic-append / idempotency contracts.
- Add performance benchmarks for branch rebuild, paginated entry reads, and compaction once a production adapter exists.
- Consider optional packages that emit DDL or migration templates from the reference schema for common SQL/NoSQL stores.
- Revisit `docs/session-stores-and-branching.md` after a deprecation period and redirect it to `docs/session-stores.md` if traffic shows links have migrated.
