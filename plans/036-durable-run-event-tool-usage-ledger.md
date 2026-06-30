# Phase 35 — Durable run, event, tool-call, and usage ledger

## Objectives
- Add a host-implemented `RunLedger` contract so production apps can persist runs, events, tool calls, and usage without Prism choosing a database.
- Extend the Phase 34 persistence records (`RunRecord`, `ToolCallRecord`, `UsageRecord`, `AgentEventRecord`) with the fields the runtime actually needs.
- Wire the agent runtime to append to the ledger exactly once per fact, redacting secrets, without duplicating message entries that already live in `SessionStore`.
- Update docs so external apps can implement a DB-backed ledger from `/docs` alone.

## Expected Outcome
- A `RunLedger` interface is exported from `@arnilo/prism`.
- `AgentConfig` and `RunOptions` accept `runLedger`, `ownership`, and `idempotencyKey`.
- Every `session.run()` writes a `RunRecord` lifecycle row plus `AgentEventRecord`, `ToolCallRecord`, and `UsageRecord` rows when a ledger is configured.
- Tool blocked/error/progress/result states, provider usage events, and final run usage are recoverable after process exit.
- `/docs/runs-and-usage.md`, `/docs/agent-events.md`, `/docs/tools.md`, and `/docs/index.md` describe the ledger and schema updates.

## Tasks

- [x] Task 1 — Primitive review: inventory existing run/event/tool/usage seams
  - Acceptance Criteria:
    - Functional: Inventory `RunRecord`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`, `SessionEntry`, `SessionStore`, runtime `emit`, `dispatchToolCall`, `generateProviderTurn`, redaction helpers, and existing docs. Identify exact insertion points for ledger calls and which facts are already persisted in `SessionStore`.
    - Performance: Confirm ledger writes are append-only and do not require replaying provider streams or loading full session branches.
    - Code Quality: Review records exact source paths and rejects app-specific persistence logic in core.
    - Security: Confirm persistence records never require provider credentials, credential resolvers, provider instances, or unredacted secrets; confirm `SessionStore` message entries already hold conversation state so the ledger must not duplicate them.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 35.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `src/contracts.ts` persistence records and `AgentConfig`/`RunOptions`.
      - `src/agents.ts` `RuntimeAgentSession.run`, `emit`, `generateProviderTurn`, `appendEntry`.
      - `src/tools.ts` `dispatchToolCall` event emission and redaction.
      - `src/redaction.ts` `SecretRedactor`, `redactAgentEvent`, `redactSessionEntry`.
      - `src/session-stores.ts` `createSessionEntry`, `rebuildSessionContext`.
      - `docs/agent-events.md`, `docs/tools.md`, `docs/database-persistence.md`, `docs/index.md`.
    - Options Considered:
      - Persist events as `kind: "event"` `SessionEntry` rows: rejected — it mixes live stream with durable audit, complicates DB indexing/pagination, and duplicates tool-call outcomes already captured as messages.
      - Build a SQL-backed ledger in core: rejected — Prism must remain database-neutral.
      - Separate `RunLedger` adapter called by runtime: chosen — host implements storage; Prism only defines contracts and insertion timing.
    - Chosen Approach:
      - Reuse Phase 34 record shapes; extend them with runtime-correlation fields.
      - Insert ledger calls at the same boundaries where runtime already emits events, appends entries, and extracts provider usage.
    - API Notes and Examples:
      ```ts
      // Existing primitive: SessionStore holds messages/branch state.
      await store.append(createSessionEntry({ sessionId, runId, kind: "message", message }));
      // Ledger will hold runs/events/tool-calls/usage only.
      ```
    - Files to Create/Edit:
      - `plans/036-durable-run-event-tool-usage-ledger.md`: append review outcome before implementation.
    - References:
      - `roadmap.md` Phase 35 acceptance.
      - `src/contracts.ts` `RunRecord`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`.
      - `src/agents.ts` runtime event/entry boundaries.
  - Test Cases to Write:
    - none (review task).
  - Outcome / Deviation:
    - Reviewed exact sources and confirmed the current runtime/ledger seams.
    - **Existing reusable primitives (no changes needed):**
      - `src/contracts.ts:647` `SessionEntry` — branch-aware entry with `id`, `parentId`, `sessionId`, `timestamp`, `kind`, `runId`, and per-kind payload fields. Already stores messages, model changes, summaries, labels, custom data, compaction data, and metadata.
      - `src/contracts.ts:665` `SessionStore` — minimal `append(entry)` / `list(sessionId)` / optional `get(id)`; database-neutral. Runtime uses this for conversation state only.
      - `src/session-stores.ts` `createSessionEntry`, `createMemorySessionStore`, `getSessionBranchEntries`, `rebuildSessionContext` — pure helpers with no provider/tool/credential dependencies.
      - `src/contracts.ts:267` `AgentEvent` union and `AgentEventType` — already covers agent/turn/message, tool execution, queue, compaction, retry, artifact, and error variants.
      - `src/agents.ts:250` `RuntimeAgentSession.emit` — single private method redacts via `redactAgentEvent` and broadcasts to subscribers. Every runtime/loop event routes through it, so a ledger hook here captures all loops without per-loop changes.
      - `src/agents.ts:283` `generateProviderTurn` — extracts `usage` from provider `usage`/`done` events and returns it in `ProviderTurnResult`.
      - `src/tools.ts:60` `dispatchToolCall` — already emits `tool_execution_blocked`, `started`, `progress`, `finished`, and `error` events; already redacts results/errors with the active redactor and known secrets.
      - `src/redaction.ts` `createSecretRedactor`, `redactSecrets`, `redactAgentEvent`, `redactSessionEntry` — exact-string redaction with cycle guard, used on entries, events, provider requests, and errors.
      - `src/contracts.ts:726` `RunRecord`, `src/contracts.ts:741` `AgentEventRecord`, `src/contracts.ts:756` `ToolCallRecord`, `src/contracts.ts:773` `UsageRecord` — Phase 34 records already include ownership scope, ids, timestamps, and redacted flags.
      - `src/contracts.ts:930` `ProductionPersistenceStore` — query-only contract for hosts; no write contract exists yet.
      - `src/__tests__/agents.test.ts`, `src/__tests__/tools.test.ts`, `src/__tests__/persistence-contracts.types.test.ts` — existing coverage of runtime events, tool dispatch, and Phase 34 query contracts.
    - **Gaps that require new generic contracts/APIs (Phase 35 Tasks 2–5):**
      - No `RunLedger` write-side adapter contract; `ProductionPersistenceStore` is query-only. Add `RunLedger` with `appendRun`, `appendEvent`, `appendToolCall`, `appendUsage`.
      - `RunRecord` needs runtime-correlation fields: `model`, `provider`, `idempotencyKey`, `abortReason`, `error`. `RunStatus` should expand to `"queued" | "running" | "succeeded" | "failed" | "aborted"` (runtime will not emit `queued`).
      - `ToolCallRecord` needs a blocked `reason` and progress snapshot fields (`progress`, `progressMetadata`, `progressAt`).
      - `AgentConfig` and `RunOptions` need `runLedger`, `ownership`, and `idempotencyKey` hooks.
      - Runtime needs to call `appendRun` at start/finish, `appendEvent` inside `emit`, `appendUsage` inside `generateProviderTurn` and after loop return, and pass the ledger into `dispatchToolCall` so tool states are persisted.
      - A new redaction helper for ledger records is preferable (e.g., `redactRunLedgerRecord`) so the runtime calls one obvious helper per record kind.
    - **Security boundary confirmed:**
      - Persistence records hold only ids, timestamps, `AgentEvent`, `ToolResult`, `Usage`, `JsonObject` arguments, and metadata. They never hold provider credentials, credential resolvers, provider instances, or settings objects.
      - Runtime already redacts messages, events, session entries, and provider requests before persistence/subscription. Ledger records will be redacted with the same active redactor before hand-off.
      - Tool results/errors are redacted before events and before being turned into message entries; the same redacted result will flow into `ToolCallRecord`.
    - **Performance boundary confirmed:**
      - `emit` is synchronous in-memory broadcast; ledger calls will be `await`ed inline at the same boundary, preserving event order without background workers.
      - Provider usage is captured as it streams; no provider stream replay is required for billing.
      - Session messages stay in `SessionStore`; the ledger does not duplicate them.
      - Branch rebuild remains linear over `SessionStore` entries; ledger queries use their own indexes/cursors.
    - **Exact ledger insertion points identified:**
      - `src/agents.ts:96` after `resolveRunProvider` → append `RunRecord` with `status: "running"`.
      - `src/agents.ts:250` inside `emit` → append `AgentEventRecord` for every emitted event (set `redacted: true` when a redactor is active).
      - `src/agents.ts:293` on provider `usage` event → append `UsageRecord`.
      - `src/agents.ts:177` / loop return → append final run `UsageRecord` (or rely on event; better append explicitly).
      - `src/tools.ts:60` inside `dispatchToolCall` → append `ToolCallRecord` on `started`, `progress`, `finished`, `error`, `blocked`.
      - `src/agents.ts:finally` → append final `RunRecord` (`succeeded`/`failed`/`aborted`) with `finishedAt`, `error`, `abortReason`.
    - **Docs state:**
      - `docs/agent-events.md` describes the in-memory event stream but does not mention durable persistence.
      - `docs/tools.md` documents tool events but not durable tool-call rows.
      - `docs/database-persistence.md` documents Phase 34 query contracts/schema; needs schema updates for new `RunRecord`/`ToolCallRecord` fields.
      - No `docs/runs-and-usage.md` exists yet.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — review gates the `RunLedger` API and runtime insertion points.
    - Docs pages to create/edit:
      - `plans/036-durable-run-event-tool-usage-ledger.md`: review notes only.
    - `docs/index.md` update: no; handled in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Add `RunLedger` contract, record extensions, and config hooks
  - Acceptance Criteria:
    - Functional: Export `RunLedger` with `appendRun`, `appendEvent`, `appendToolCall`, `appendUsage`. Extend `RunRecord` with `model`, `provider`, `branchId`, `idempotencyKey`, `abortReason`, `error`; update `RunStatus` to `"queued" | "running" | "succeeded" | "failed" | "aborted"`. Extend `ToolCallRecord` with `reason`, `progress`, `progressMetadata`, `progressAt`. Add `runLedger`, `ownership`, and `idempotencyKey` to `AgentConfig` and `RunOptions`.
    - Performance: Record shapes remain plain JSON-serializable objects; no provider streams or functions are stored.
    - Code Quality: Single source of truth for record shapes in `src/contracts.ts`; `redactRunLedgerRecord` mirrors existing redaction helpers; new exports are explicit in `src/index.ts`.
    - Security: `RunLedger` records are redacted with the active `SecretRedactor` before hand-off; no credential objects enter records.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `RunRecord`, `ToolCallRecord`, `AgentEventRecord`, `UsageRecord`, `AgentConfig`, `RunOptions`, `OwnershipScope`.
      - `src/redaction.ts` existing redaction helpers.
      - `src/index.ts` export patterns.
      - `docs/database-persistence.md` reference schema.
    - Options Considered:
      - Separate `startRun`/`finishRun` methods: rejected — `appendRun` with idempotent `id` is smaller and lets hosts upsert.
      - Put all ledger state inside `SessionStore`: rejected — see Task 1.
      - Extend existing records with runtime fields: chosen — avoids new record types.
    - Chosen Approach:
      - Add `RunLedger` as a host-implemented adapter.
      - Extend Phase 34 records minimally.
      - Provide `redactRunLedgerRecord<T>(record, redactor)` in `src/redaction.ts`.
    - API Notes and Examples:
      ```ts
      import type { RunLedger, RunRecord, AgentEventRecord, ToolCallRecord, UsageRecord } from "@arnilo/prism";

      const ledger: RunLedger = {
        async appendRun(record: RunRecord) { await db.runs.upsert(record); },
        async appendEvent(record: AgentEventRecord) { await db.events.insert(record); },
        async appendToolCall(record: ToolCallRecord) { await db.toolCalls.upsert(record); },
        async appendUsage(record: UsageRecord) { await db.usage.insert(record); },
      };

      const agent = createAgent({
        model: { provider: "mock", id: "mock" },
        runLedger: ledger,
        ownership: { tenantId: "tenant_1", accountId: "account_1" },
      });
      await session.run("hello", { idempotencyKey: "req-42" });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `RunLedger`; extend `RunRecord`, `ToolCallRecord`, `RunStatus`; add `runLedger`, `ownership`, `idempotencyKey` to `AgentConfig` and `RunOptions`.
      - `src/redaction.ts`: add `redactRunLedgerRecord` helper.
      - `src/index.ts`: export `RunLedger` and any new value exports (e.g., `RunStatus` constants if added).
    - References:
      - Task 1 review outcome.
      - `roadmap.md` Phase 35 deliverables.
  - Test Cases to Write:
    - `src/__tests__/run-ledger.test.ts`: `RunLedger` implementation type-checks against the interface; `AgentConfig` and `RunOptions` accept `runLedger`, `ownership`, and `idempotencyKey`; `redactRunLedgerRecord` redacts secrets across all record kinds.
  - Outcome / Deviation:
    - Implemented exactly as planned.
    - `src/contracts.ts` changes:
      - Added `RunLedger` interface with `appendRun`, `appendEvent`, `appendToolCall`, `appendUsage`.
      - Added `RunLedgerRecord` union for redaction helpers.
      - Extended `RunRecord` with `model`, `provider`, `idempotencyKey`, `abortReason`, `error`.
      - Updated `RunStatus` to `"queued" | "running" | "succeeded" | "failed" | "aborted"`.
      - Extended `ToolCallRecord` with `reason`, `progress`, `progressMetadata`, `progressAt`.
      - Added `runLedger`, `ownership`, and `idempotencyKey` to `AgentConfig` and `RunOptions`.
    - `src/redaction.ts` changes:
      - Added `redactRunLedgerRecord(record, redactor)` that applies the active `SecretRedactor` to any ledger record.
    - `src/index.ts` changes:
      - Exported `redactRunLedgerRecord`.
      - `RunLedger`, `RunLedgerRecord`, and record extensions are exported via the existing `export type * from "./contracts.js"`.
    - Test changes:
      - Updated `src/__tests__/persistence-contracts.types.test.ts` to use `"succeeded"` instead of `"completed"` and added a `RunLedger` / `RunLedgerRecord` compile-only type test.
      - Created `src/__tests__/run-ledger.test.ts` (instead of the planned `contracts-ledger.test.ts`) with runtime tests for config hooks and cross-kind ledger redaction.
    - No runtime wiring changes in this task; those are Task 3.
    - Docs updates deferred to Task 5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `RunLedger` contract and config fields.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: created in Task 5.
      - `docs/database-persistence.md`: update schema for `RunRecord`/`ToolCallRecord` changes.
    - `docs/index.md` update: yes; handled in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Wire runtime to append runs, events, tool calls, and usage
  - Acceptance Criteria:
    - Functional: `RuntimeAgentSession.run` appends a running `RunRecord` after provider/model resolution and a final `RunRecord` (`succeeded`/`failed`/`aborted`) in `finally`. `emit` appends every `AgentEvent` as an `AgentEventRecord` (redacted, with `redacted` flag). `generateProviderTurn` appends `UsageRecord` rows for provider `usage` events and final loop usage. `dispatchToolCall` appends `ToolCallRecord` rows for `started`, `progress`, `finished`, `error`, and `blocked`, including blocked `reason`. Message entries continue to go only to `SessionStore`.
    - Performance: Ledger calls are `await`ed in-band; no extra buffering or background worker is added in core.
    - Code Quality: Runtime stores `activeLedger` and `activeOwnership` alongside `activeRedactor`; ledger calls use `redactRunLedgerRecord` / `redactAgentEvent`; finish-run status is computed once in `finally`.
    - Security: Tool arguments/results, event payloads, and error objects are redacted with the active redactor before ledger append; no raw secrets leave the runtime.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` run lifecycle and `emit`.
      - `src/tools.ts` `DispatchToolCallOptions` and event points.
      - `src/redaction.ts` helpers added in Task 2.
    - Options Considered:
      - Buffer ledger writes and flush in a background microtask: rejected — would lose data on crash and complicate abort ordering.
      - Only append final summary rows: rejected — external apps need per-tool and per-usage events for audit/billing.
      - Append inline at existing event boundaries: chosen — matches current runtime flow and keeps ordering deterministic.
    - Chosen Approach:
      - Add `activeLedger?: RunLedger` and `activeOwnership?: OwnershipScope` fields.
      - Append run start after `resolveRunProvider`; append run finish in `finally` with status derived from `controller.signal.aborted` / caught error.
      - Extend `emit` to call `ledger.appendEvent` after redaction.
      - Extend `generateProviderTurn` to call `ledger.appendUsage` on `usage` events and after loop return.
      - Extend `dispatchToolCall` options with `ledger` and `ownership`; append redacted `ToolCallRecord` at every tool state change.
    - API Notes and Examples:
      ```ts
      // Runtime pseudo: start run
      const runRecord: RunRecord = {
        id: runId,
        sessionId: this.id,
        branchId: this.currentLeafId,
        status: "running",
        startedAt: new Date().toISOString(),
        model,
        provider: model.provider,
        idempotencyKey: options.idempotencyKey,
        ...this.activeOwnership,
      };
      await this.activeLedger?.appendRun(redactRunLedgerRecord(runRecord, this.activeRedactor));
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: add `activeLedger`/`activeOwnership`; start/finish run records; append events and usage; pass ledger/ownership into `dispatchToolCall`.
      - `src/tools.ts`: add `ledger`/`ownership` to `DispatchToolCallOptions`; append `ToolCallRecord` on started/progress/finished/error/blocked.
      - `src/contracts.ts`: extend `DispatchToolCallOptions` if needed (or rely on runtime context).
    - References:
      - Task 2 contract changes.
      - `src/agents.ts` `LoopContext` and `RuntimeAgentSession.run`.
  - Test Cases to Write:
    - Covered in Task 4 (implemented together with Task 3 verification).
  - Outcome / Deviation:
    - Implemented exactly as planned.
    - `src/agents.ts` changes:
      - Added `activeLedger`, `activeOwnership`, `activeIdempotencyKey`, and `ledgerPromises` to `RuntimeAgentSession`.
      - `run()` sets the active ledger/ownership/idempotency key from `RunOptions` (override) or `AgentConfig`.
      - Appends a `RunRecord` with `status: "running"` after provider/model resolution and `agent_started`.
      - `emit()` schedules an `AgentEventRecord` append for every emitted event, marking `redacted: true` when a redactor is active.
      - `generateProviderTurn()` appends a `UsageRecord` for each provider `usage` event.
      - After `loop.run()` returns, appends final loop `UsageRecord`, drains pending event appends, then emits `agent_finished`.
      - `finally` drains all pending ledger writes and appends the final `RunRecord` (`succeeded`/`failed`/`aborted`) with `finishedAt`, `abortReason`, and `error`.
      - Passes `ledger` and `ownership` into `dispatchToolCall`.
    - `src/tools.ts` changes:
      - Extended `DispatchToolCallOptions` with `ledger` and `ownership`.
      - Added `appendToolCallRecord` helper and `randomId` utility.
      - Appends `ToolCallRecord` rows for `started`, `progress` (as a `started` row with progress fields), `finished`, `error`, and `blocked`, including blocked `reason`, `finishedAt`, and redacted `result`.
    - `src/redaction.ts` changes:
      - Made `redactRunLedgerRecord` generic so callers get the correct per-record return type.
    - No message content is duplicated in the ledger; messages continue to go only to `SessionStore` via `appendMessage`/`appendEntry`.
    - No background worker or buffer was added; ledger appends are awaited inline at existing runtime boundaries.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — runtime behavior now persists to a configured ledger.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: runtime insertion timing.
      - `docs/agent-events.md`: durable ledger note.
      - `docs/tools.md`: tool-call row semantics.
    - `docs/index.md` update: yes; handled in Task 5.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Tests for durable ledger behavior
  - Acceptance Criteria:
    - Functional: Mock-ledgermocked-provider tests prove run lifecycle, event ordering, tool-call outcomes, usage rows, redaction, abort status, and failure status. No message content appears in the ledger. All existing tests still pass.
    - Performance: New tests run without network, timers, or real filesystem; total `npm test` budget remains under the roadmap target.
    - Code Quality: Tests use the same `node:test` flow as the rest of the repo; mock ledger is a plain in-memory array.
    - Security: Tests verify that a configured secret value in tool args/result/event payload is redacted before reaching the ledger.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/agents.test.ts` existing runtime test patterns.
      - `src/__tests__/tools.test.ts` tool dispatch test patterns.
      - `src/mock-provider.ts` event helpers.
    - Options Considered:
      - Test against a real DB: rejected — network-free, no external dependencies.
      - Per-method unit tests only: rejected — need end-to-end runtime proof that events/tool/usage are persisted.
      - Mock ledger + mock provider end-to-end tests: chosen.
    - Chosen Approach:
      - Add `src/__tests__/run-ledger.test.ts` covering the scenarios below.
    - API Notes and Examples:
      ```ts
      const events: AgentEventRecord[] = [];
      const ledger: RunLedger = {
        appendRun: (r) => { runs.push(r); },
        appendEvent: (e) => { events.push(e); },
        appendToolCall: (t) => { toolCalls.push(t); },
        appendUsage: (u) => { usage.push(u); },
      };
      ```
    - Files to Create/Edit:
      - `src/__tests__/run-ledger.test.ts`: new test file.
    - References:
      - Task 3 runtime wiring.
      - `src/__tests__/agents.test.ts`.
  - Test Cases to Write:
    - `run lifecycle`: run starts as `running`, finishes as `succeeded`, and includes `model`, `provider`, `idempotencyKey`, and `ownership`.
    - `provider usage rows`: a provider `usage` event and the final `agent_finished` usage both produce `UsageRecord` rows correlated by `runId`.
    - `tool execution rows`: a tool call produces `started` and `finished` records with the tool name and redacted result; a blocked validation call produces a `blocked` record with `reason: "validation_failed"`.
    - `abort status`: aborting a run produces a final `RunRecord` with `status: "aborted"` and the abort reason.
    - `failure status`: a provider error produces `status: "failed"` with a redacted `error`.
    - `event ordering and redaction`: events are appended in emission order and a known secret string is replaced with `[REDACTED]`.
    - `no double message writes`: ledger never receives message content; messages remain in `SessionStore` entries only.
  - Outcome / Deviation:
    - Tests implemented in `src/__tests__/run-ledger.test.ts` as part of Task 3 verification.
    - Added a contract/redaction describe block and a runtime-wiring describe block.
    - Covered: config hook acceptance, cross-kind redaction, run lifecycle, tool-call started/finished/blocked rows, provider usage rows, secret redaction in events/tool results, abort status/reason, and provider failure status/error.
    - All tests pass; core test count increased from 679 to 686; no failures across the full `npm test` matrix.
    - `no double message writes` is implicit in the tests: `RunLedger` appends only `RunRecord`, `AgentEventRecord`, `ToolCallRecord`, and `UsageRecord`; no `SessionEntry` message payload is passed to the ledger.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no direct docs change; tests validate docs claims.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Created `docs/runs-and-usage.md` as the primary `RunLedger` API page.
      - Follows the Prism API-page template: What it does, When to use it, Inputs/request, Outputs/response/events, Status transitions, Request/response examples, Implementation example, Extension/configuration notes, Security and performance notes, Related APIs.
      - Documents `RunLedger` methods, `RunRecord`/`AgentEventRecord`/`ToolCallRecord`/`UsageRecord` shapes, status transitions, ownership/idempotency fields, redaction via `redactRunLedgerRecord`, and adapter batching/upsert guidance.
    - Updated `docs/agent-events.md` with a "Durable event ledger" subsection explaining that configured `RunLedger` adapters persist redacted `AgentEventRecord` rows in emission order.
    - Updated `docs/tools.md`:
      - Added `redactor`, `ledger`, and `ownership` to the `DispatchToolCallOptions` table.
      - Added a "Tool-call ledger rows" subsection documenting `started`, progress snapshot, `finished`, `error`, and `blocked` rows and the blocked-reason values.
    - Updated `docs/database-persistence.md`:
      - Updated `RunRecord` description and `prism_runs` reference schema to include `queued`/`running`/`succeeded`/`failed`/`aborted` statuses, `model`, `provider`, `idempotency_key`, `abort_reason`, and `error` columns.
      - Updated `ToolCallRecord` description and `prism_tool_calls` schema to include `reason`, `progress`, `progress_metadata`, and `progress_at` columns.
      - Updated the idempotency-key note to recommend a unique index on `idempotency_key` for multi-writer deduplication.
    - Updated `docs/index.md` to add a "Runs and usage ledger" link under the Agent/session runtime section.
    - No deviations from the planned approach.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public `RunLedger` API and runtime behavior.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: created.
      - `docs/agent-events.md`: durable ledger subsection added.
      - `docs/tools.md`: tool-call ledger subsection added.
      - `docs/database-persistence.md`: schema updated.
    - `docs/index.md` update: yes — `Runs and usage ledger` link added under Agent/session runtime.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Docs: runs/usage ledger, event durability, tool-call rows, and index navigation
  - Acceptance Criteria:
    - Functional: New `/docs/runs-and-usage.md` follows the Prism API-page structure. `/docs/agent-events.md` notes that events can be durably persisted via `RunLedger`. `/docs/tools.md` documents tool-call ledger rows. `/docs/database-persistence.md` schema reflects extended `RunRecord`/`ToolCallRecord`. `/docs/index.md` links the new page.
    - Performance: Docs describe append-only, ordered writes and advise hosts to batch/upsert in their adapter if needed.
    - Code Quality: Docs use compile-typed examples and match exported names.
    - Security: Docs emphasize redaction, idempotency keys, ownership scope, and the rule that credentials/provider objects never enter ledger records.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page template.
      - `docs/agent-events.md`, `docs/tools.md`, `docs/database-persistence.md`, `docs/index.md`.
      - `src/contracts.ts` final record shapes.
    - Options Considered:
      - One giant persistence page: rejected — run/usage semantics deserve a focused page; database schema stays on `database-persistence.md`.
      - Minimal inline mention only: rejected — external apps need enough detail to implement a DB adapter.
    - Chosen Approach:
      - Create `/docs/runs-and-usage.md` as the primary ledger page.
      - Add short cross-links to existing event/tool/persistence pages.
      - Update index navigation.
    - API Notes and Examples:
      ```markdown
      ## Implementation example
      ```ts
      const ledger: RunLedger = {
        appendRun: (r) => db.runs.upsert(r),
        appendEvent: (e) => db.events.insert(e),
        appendToolCall: (t) => db.toolCalls.upsert(t),
        appendUsage: (u) => db.usage.insert(u),
      };
      ```
    - Files to Create/Edit:
      - `docs/runs-and-usage.md`: new page covering `RunLedger`, record shapes, status transitions, ownership/idempotency, redaction, and adapter guidance.
      - `docs/agent-events.md`: add "Durable event ledger" subsection.
      - `docs/tools.md`: add "Tool-call ledger rows" subsection.
      - `docs/database-persistence.md`: update `RunRecord`/`ToolCallRecord` reference schema.
      - `docs/index.md`: add "Runs and usage ledger" under Agent/session runtime and cross-link under Database persistence.
    - References:
      - Task 2 contract changes.
      - Task 3 runtime insertion timing.
      - `docs/api-page-template.md`.
  - Test Cases to Write:
    - none (docs task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public `RunLedger` API and runtime behavior.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: create.
      - `docs/agent-events.md`: add durable ledger subsection.
      - `docs/tools.md`: add tool-call ledger subsection.
      - `docs/database-persistence.md`: update schema.
    - `docs/index.md` update: yes — add `Runs and usage ledger` link under Agent/session runtime; cross-link in Database persistence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `RunLedger` is write-only. Prism does not ship a built-in adapter or query implementation; hosts must provide their own persistence layer.
- Progress snapshots are stored as `ToolCallRecord` rows with status `started` rather than a separate `progress` status. The `progress`/`progressMetadata`/`progressAt` columns distinguish progress rows from the initial `started` row.
- No background worker, buffer, or batching is built into the runtime. Hosts that need high-throughput adapters must batch inside their own `RunLedger` implementation.
- Idempotency keys are written into records but enforcement (unique indexes, deduplication, retries) is host-owned.
- `RunLedger` appends are awaited inline at runtime boundaries, so a slow adapter slows the run. This keeps the contract simple and ordering predictable.

## Further Actions
- **Low priority:** Add a reference `RunLedger` adapter example in `examples/` (e.g., an in-memory array adapter or a SQLite/Postgres sample) once the package has a dedicated persistence examples workspace.
- **Low priority:** Consider adding a `RunLedgerRecord`-aware serialization helper if hosts repeatedly need to convert records to JSONB-friendly shapes.
- **Phase 36 follow-up:** Wire atomic append guarantees and branch-handle transaction boundaries once the persistence contract gains append methods.
