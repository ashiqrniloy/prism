# Release 0.0.24 — Distributed event delivery and recoverable tool effects

Roadmap phase: Phase 7 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.23** (Phase 6 exit gate passed 2026-08-03).
Target: `@arnilo/prism` **0.0.24**.
Prerequisite: Phase 6 complete; Phase 8 custom-loop snapshots and richer approval semantics remain out of scope.

## Objectives

- Let authorized agent-event consumers replay and follow an active run from any replica without rerunning provider or tool work.
- Complete official AG-UI 0.0.57 client compatibility and explicit AG-UI handshakes for hardened MCP/MCP Apps/A2A adoption required by the client.
- Add one replaceable durable `AgentEvent` source and one PostgreSQL implementation over the existing event ledger; persisted rows remain source of truth and `LISTEN`/`NOTIFY` is wakeup-only.
- Make side-effect behavior explicit on tool definitions and carry stable run/tool-call idempotency context through shared dispatch.
- Persist pending, dispatched, completed, failed, and unknown tool-effect outcomes so only proven-safe duplicates return stored results and ambiguous effects require reconciliation.
- Reuse Phase 6 work-idempotency, PostgreSQL migration, ownership, cursor, and cleanup patterns; add no second runtime, Kafka/Redis dependency, ORM, or exactly-once claim.

## Expected Outcome

- Core exports a dependency-free `AgentEventSource` contract, bounded memory reference, conformance helper, and replay-to-live handoff primitive.
- `@arnilo/prism-session-store-postgres` exposes a durable event source whose per-run sequence allocation is race-safe across producers and whose subscriptions recover from lost notifications by querying persisted rows.
- Server SSE, AG-UI replay, authorized run replay, and a host-selected A2A task adapter consume the shared source rather than implementing transport-local replay loops; reconnecting on another replica does not start a new run.
- AG-UI support is verified against every current 0.0.57 input/event family, and optional MCP/MCP Apps/A2A fronting reuses Prism's hardened protocol clients instead of adding parallel runtimes.
- Core tool dispatch can opt into a durable `ToolEffectStore`; mutation tools receive a stable idempotency key and duplicate/unknown behavior is explicit and bounded.
- `@arnilo/prism-enterprise-postgres` exposes a PostgreSQL tool-effect store while retaining the work connector’s specialized claim/reconciliation contract.
- MCP, browser, work, coding, and supervisor paths publish conservative effect metadata and reconciliation behavior without silently retrying an ambiguous external mutation.
- Multi-process reconnect, notification-loss, crash-window, isolation, retention, and performance evidence pass for release 0.0.24.

## Tasks

- [x] Task 0 — Primitive/package/protocol review, adversarial matrix, limits, and public API freeze
  - Acceptance Criteria:
    - Functional: inventory maps `AgentEvent`, `AgentEventRecord`, `RunLedger`, `ProductionPersistenceStore.queryEvents`, runtime event append/drain order, `EventMultiplexer`, server/AG-UI replay, `A2ATaskLifecycle.subscribe`, MCP Streamable HTTP behavior, durable run pending/dispatched state, core tool dispatch, Phase 6 work-idempotency, browser effect classification, coding mutations, and supervisor delegation to every Phase 7 requirement.
    - Functional: freeze records exact event-source methods, record/envelope/cursor shapes, replay/live handoff boundary, terminal-event rules, retention behavior, tool-effect declarations, effect-store transitions, stable idempotency-key derivation, duplicate-result policy, reconciliation hooks, errors, package exports, and adapter options before implementation.
    - Functional: freeze explicitly excludes Kafka/Redis, sticky-session requirements, a hosted event service, protocol-specific event databases, automatic replay of unknown effects, arbitrary external-result storage, Phase 8 approval changes, and exactly-once language.
    - Performance: freeze names default/hard caps for event bytes, pages, cursors, retained rows, subscriber queues, poll intervals, reconnect backoff, listener count, tool-effect rows/results/references/keys, cleanup batches, benchmark volume, and p95 ceilings.
    - Code Quality: review chooses one shared replay/subscription state machine and one shared effect state machine; it rejects replacement of `RunLedger`, duplicate transport replay loops, generic queue/KV abstractions, and a new package unless current package boundaries cannot hold the implementation.
    - Security: freeze requires exact verified ownership at every append/page/subscribe/effect transition, run/session/cursor binding, redaction before persistence, bounded opaque cursors, arguments hashes rather than raw arguments, non-enumerating foreign-record errors, and no credentials/prompts/tool bodies in effect rows.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 7, Product Boundaries, Priority Rules, and Phase Planning Workflow.
      - `docs/agent-events.md`, `docs/agent-session-runtime.md`, `docs/runs-and-usage.md`, `docs/tools.md`, `docs/server.md`, `docs/ag-ui.md`, `docs/a2a.md`, `docs/mcp-tools.md`, `docs/work-tools.md`, `docs/browser-automation.md`, `docs/coding-agent-tools.md`, `docs/supervisors.md`, `docs/postgres-persistence.md`, `docs/enterprise-postgres-state.md`, and `docs/database-persistence.md`.
      - `src/{contracts,agents,event-multiplexer,run-ledger,tools,agent-run-state,agent-run-lifecycle}.ts`; `packages/session-store-postgres/src/{persistence,ddl,migrations}.ts`; `packages/session-store-codecs/src/index.ts`.
      - `packages/{server,ag-ui,supervisor,mcp,work-tools,browser,coding-agent,enterprise-postgres}/src` event/tool paths and focused tests.
      - PostgreSQL current `LISTEN` and `NOTIFY`: <https://www.postgresql.org/docs/current/sql-listen.html> and <https://www.postgresql.org/docs/current/sql-notify.html>. Reviewed semantics: `LISTEN` takes effect at commit; establish/commit listener before state read; `NOTIFY` arrives only after commit, may coalesce identical transaction payloads, is not durable, and must not carry source-of-truth data.
      - node-postgres notification API: <https://node-postgres.com/apis/client#events-notification> and transaction guidance: <https://node-postgres.com/features/transactions>.
      - WHATWG SSE reconnect and `Last-Event-ID`: <https://html.spec.whatwg.org/multipage/server-sent-events.html>.
      - MCP Streamable HTTP resumability: <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>; A2A current specification: <https://a2a-protocol.org/dev/specification/>; AG-UI streaming/serialization: <https://docs.ag-ui.com/quickstart/server> and <https://docs.ag-ui.com/concepts/serialization>.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Keep `queryEvents` plus local `session.subscribe()`: replay works, but replay→live handoff on another replica has a race and no shared cancellation/backpressure contract; reject.
      - Sticky sessions: smallest deployment workaround but fails replica loss and roadmap acceptance; reject.
      - Kafka or Redis streams: useful at larger measured scale, but adds an unsupported operational dependency before PostgreSQL evidence; defer.
      - Treat PostgreSQL `NOTIFY` as event payload/queue: notifications are transient/coalesced and reconnect loses them; reject.
      - Add a durable source over existing event rows, use a per-run sequence allocator, and query after every wake/poll: chosen.
      - Reuse `ToolCallRecord` alone for recovery: it stores lifecycle snapshots but lacks claim/CAS, unknown resolution, idempotency key, and safe duplicate-result rules; reject.
      - Generalize the Phase 6 claim/CAS semantics into core tool-effect contracts while keeping work-specific result/reconciliation types: chosen.
    - Chosen Approach:
      - Keep `RunLedger.appendEvent()` compatible. Add a distinct `AgentEventSource` with `append`, `page`, `subscribe`, and bounded cleanup; PostgreSQL `appendEvent()` delegates to the same source append so passing one persistence object never double-writes.
      - Add an optional event-source capability on production persistence rather than replacing `queryEvents`; old stores remain valid, while distributed adapters require the stronger capability explicitly.
      - Allocate strictly increasing per-run sequence numbers transactionally. Cursor position binds schema version, exact owner, session, run, sequence, and event id. Subscribers page persisted rows after listener setup and after every notification/poll, suppressing replay/live overlap by sequence/id.
      - Keep notifications identifier-free and wakeup-only. One explicitly active subscription owns bounded polling/reconnect work; import and factory construction start no background listener.
      - Add declarative/dynamic tool effect classification and an optional store at shared dispatch. Missing metadata preserves legacy unmanaged behavior; `idempotency: "required"` without a store blocks before side effect. Unknown outcomes never dispatch again automatically.
      - Store argument digest, state, bounded error/result/reference, versions, and timestamps only. Raw arguments, prompt content, unrestricted `ToolResult`, credentials, and provider responses remain absent.
    - API Notes and Examples:
      ```ts
      // Illustrative names; Task 0 freezes exact signatures before Task 1.
      const source: AgentEventSource = persistence.events;
      for await (const item of source.subscribe({ ownership, sessionId, runId, after: cursor, signal })) {
        persistCursor(item.cursor);
        render(item.record.event);
      }

      const tool: ToolDefinition = {
        name: "mail.send",
        effect: { kind: "external_mutation", idempotency: "required" },
        execute: (args, context) => send(args, { idempotencyKey: context.idempotencyKey! }),
      };
      ```
    - Files to Create/Edit:
      - `plans/007-Release-0-0-24-Distributed-Events-and-Recoverable-Tool-Effects.md`: Task 0 inventory/freeze evidence.
      - No production files in Task 0.
    - References:
      - `src/agents.ts:1007-1030`: live publish precedes queued ledger append; terminal path drains ledger.
      - `packages/session-store-postgres/src/persistence.ts:412-446`: current `MAX(sequence) + 1` event allocation is race-prone across producers.
      - `packages/ag-ui/src/handler.ts:182-211`: replay page hands off to replica-local `session.subscribe()`.
      - `src/agent-run-state.ts:29` and `src/agents.ts:646-674`: current ready/dispatched durable tool marker and ambiguous-resume rejection.
      - `packages/work-tools/src/idempotency.ts` and `packages/enterprise-postgres/src/work-idempotency.ts`: shipped claim/CAS/unknown semantics.
  - Test Cases to Write:
    - Freeze checklist maps every Phase 7 criterion to one contract, state transition, SQL transaction/index, adapter, test, benchmark, or explicit non-goal.
    - Protocol matrix distinguishes standard SSE `Last-Event-ID`, Prism AG-UI cursor, existing Prism A2A `afterEventId` extension behavior, and optional MCP event-store resumability without claiming unsupported protocol fields.
    - Crash matrix covers before claim, after claim/before dispatch mark, after dispatch mark/before effect, during effect, external commit before local completion, completion before response, duplicate transport delivery, and reconciliation races.
    - Security matrix covers missing/wrong ownership, foreign cursor, guessed run/tool ids, changed arguments under the same key, oversized/deep result, secret-shaped values, stale CAS, retention boundary, listener wake timing, and malformed stored rows.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; review/freeze only. Later tasks implement frozen surfaces.
    - Docs pages to create/edit: none in Task 0.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (applies to Tasks 1–8).

### Task 0 completion record — 2026-08-04

#### Reviewed primitive and package inventory

| Existing primitive/path | Verified behavior and Phase 7 decision |
| --- | --- |
| `AgentEvent` / `AgentEventRecord` / `RunLedger` in `src/contracts.ts` | `AgentEvent` remains domain-neutral. `AgentEventRecord` gains additive optional `sequence`; `RunLedger` stays write-side and unchanged. Durable source is a separate optional capability, never a `RunLedger` replacement. |
| `AgentSession.emit()` / `drainLedger()` in `src/agents.ts` | It redacts, pushes local subscribers, then queues ledger append; terminal handling drains the chain. Phase 7 must append before exposing an event through a durable source, so durable subscribers cannot observe a live-only event that later failed persistence. Local `session.subscribe()` remains live/process-local. |
| `EventMultiplexer` in `src/event-multiplexer.ts` | Existing bounded, single-consumer fan-in is reusable for local wake signals only. It is not a durable store or multicast source; do not extend it into one. |
| `ProductionPersistenceStore.queryEvents()` / PostgreSQL persistence | Existing cursor pages are replay-only. PostgreSQL currently allocates `MAX(sequence) + 1` outside a transaction, which races. Add optional `events` capability and migration 006; do not alter legacy query semantics. |
| `createPrismEventReplay()` / AG-UI `replaySource()` | Both page historical events, and AG-UI then opens a replica-local session subscription. Replace only the replay/live handoff with shared source subscription; preserve existing authorization, mapper, and page-only compatibility wrappers. |
| `A2ATaskLifecycle.subscribe()` | Prism exposes `afterEventId`; current A2A `SubscribeToTask` takes only `id` and optional `tenant`, starts with current task, and terminates at terminal state. Keep Prism field as documented adapter extension, never claim it is standard A2A. |
| MCP Streamable HTTP / server bridge | MCP resumability is per MCP SSE stream, uses globally unique stream event ids and `Last-Event-ID`, and is optional. Core durable run cursor is not an MCP stream id; MCP adapter remains host/protocol scoped. |
| Durable run state in `src/agent-run-state.ts` / `src/agents.ts` | Existing `ready → dispatched` marker blocks resume of ambiguous dispatched work. Tool-effect record becomes source of effect truth; run checkpoint remains loop-resume state and is not generalized into effect CAS. |
| `dispatchToolCall()` in `src/tools.ts` | Existing one shared validation/trust/permission/guardrail/before-execute/execute path is integration point. Effect claim sits after all blocking checks and immediately before `beforeExecute`; dispatched transition occurs immediately before `execute`. |
| Phase 6 work stores | `IdempotencyStore` already proves bounded identity-scoped claim/CAS/unknown flow. Generalize shape in core; preserve work result `{draftId, resourceId?}` and connector reconciliation instead of replacing it. |
| Browser policy/checkpoint | `classifyBrowserOperation` identifies observation/mutation/high-impact and browser checkpoint requires reload+verify after interruption. Reuse classification; browser effects never auto-replay. |
| Coding tools / `ExecutionAction` | Read tools are observations; write/edit/delete/move/Git/shell are effects. Reuse path policy and mutation queues. Only exact local postcondition can reconcile; shell/Git/ambiguous edit stay unknown. |
| MCP bridge and supervisor | Remote tool description is not authority for effect safety. Host classifies MCP tools. Supervisor already propagates ownership and narrowed permissions; Task 6 adds effect-store/delegation attribution to that same path. |

#### Public API freeze

This is the complete Phase 7 API surface. Names, states, error codes, package locations, and default behavior below are frozen; Task 1 may add implementation-private helpers only.

```ts
// @arnilo/prism
export interface DurableAgentEventRecord extends AgentEventRecord {
  readonly runId: string;
  readonly sequence: number; // positive, strictly increasing per run
}

export interface AgentEventSourcePage {
  readonly items: readonly AgentEventEnvelope[];
  readonly nextCursor?: string;
  readonly terminal: boolean;
}
export interface AgentEventEnvelope {
  readonly record: DurableAgentEventRecord;
  readonly cursor: string; // opaque cursor after record
}
export interface AgentEventSource {
  append(record: AgentEventRecord): Promise<DurableAgentEventRecord>;
  page(input: AgentEventSourceRead): Promise<AgentEventSourcePage>;
  subscribe(input: AgentEventSourceRead): AsyncIterable<AgentEventEnvelope>;
  cleanup(input: AgentEventSourceCleanup): Promise<{ readonly deleted: number }>;
}
export interface AgentEventSourceRead {
  readonly ownership: OwnershipScope;
  readonly sessionId: string;
  readonly runId: string;
  readonly after?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}
export interface AgentEventSourceCleanup {
  readonly ownership: OwnershipScope;
  readonly before: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}
export interface AgentEventSourceOptions {
  readonly maxEventBytes?: number;
  readonly maxPageSize?: number;
  readonly maxCursorBytes?: number;
  readonly maxQueuedEvents?: number;
  readonly maxSubscribers?: number;
  readonly pollIntervalMs?: number;
  readonly reconnectInitialMs?: number;
  readonly reconnectMaxMs?: number;
  readonly maxRetainedEventsPerRun?: number;
  readonly maxRetentionAgeMs?: number;
}
export interface ProductionPersistenceStore { readonly events?: AgentEventSource; }
export function createMemoryAgentEventSource(options?: AgentEventSourceOptions): AgentEventSource;
export function assertAgentEventSourceConforms(factory: () => AgentEventSource | Promise<AgentEventSource>): Promise<void>;

export type ToolEffectKind = "none" | "local_mutation" | "external_mutation";
export type ToolEffectIdempotency = "none" | "optional" | "required" | "tool_managed" | "unsupported";
export interface ToolEffectDeclaration {
  readonly kind: ToolEffectKind;
  readonly idempotency: ToolEffectIdempotency;
}
export type ToolEffectClassifier = (args: JsonObject, context: ToolExecutionContext) => ToolEffectDeclaration;
// ToolDefinition gains: readonly effect?: ToolEffectDeclaration | ToolEffectClassifier
// ToolExecutionContext gains: readonly idempotencyKey?: string

export type ToolEffectStatus = "pending" | "dispatched" | "completed" | "failed_retryable" | "failed_terminal" | "unknown";
export interface ToolEffectRecord extends OwnershipScope {
  readonly key: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly status: ToolEffectStatus;
  readonly attempt: number;
  readonly version: number;
  readonly claimToken?: string;
  readonly result?: ToolResult;
  readonly resultRef?: string;
  readonly failure?: { readonly code: string; readonly reference?: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}
export interface ToolEffectStore {
  get(input: ToolEffectKey): Promise<ToolEffectRecord | undefined>;
  begin(input: ToolEffectKey & { readonly claimTtlMs?: number; readonly maxAttempts?: number }): Promise<{ readonly outcome: "acquired" | "existing"; readonly record: ToolEffectRecord }>;
  markDispatched(input: ToolEffectTransition): Promise<ToolEffectRecord>;
  complete(input: ToolEffectTransition & { readonly result?: ToolResult; readonly resultRef?: string }): Promise<ToolEffectRecord>;
  fail(input: ToolEffectTransition & { readonly status: "failed_retryable" | "failed_terminal"; readonly failure: { readonly code: string; readonly reference?: string } }): Promise<ToolEffectRecord>;
  markUnknown(input: ToolEffectTransition & { readonly failure?: { readonly code: string; readonly reference?: string } }): Promise<ToolEffectRecord>;
  resolveUnknown(input: ToolEffectKey & { readonly expectedVersion: number; readonly status: "completed" | "failed_retryable" | "failed_terminal"; readonly result?: ToolResult; readonly resultRef?: string; readonly failure?: { readonly code: string; readonly reference?: string } }): Promise<ToolEffectRecord>;
  cleanup(input: { readonly ownership: OwnershipScope; readonly before: string; readonly limit?: number; readonly signal?: AbortSignal }): Promise<{ readonly deleted: number }>;
}
export interface ToolEffectKey {
  readonly identity: AgentIdentity;
  readonly ownership: OwnershipScope;
  readonly key: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
  readonly signal?: AbortSignal;
}
export interface ToolEffectTransition extends ToolEffectKey { readonly claimToken: string; readonly expectedVersion: number; }
export function createMemoryToolEffectStore(options?: { readonly now?: () => number }): ToolEffectStore;
export function assertToolEffectStoreConforms(factory: () => ToolEffectStore | Promise<ToolEffectStore>): Promise<void>;
```

- `AgentEventSource.append` rejects absent `runId`, `redacted !== true`, invalid ISO timestamp, invalid/mismatched event run/session ids, duplicate id with changed record, invalid ownership, and events over bounds. Same immutable id/record append returns its original durable record.
- `page` and `subscribe` require a non-empty `tenantId`; `accountId` and `userId` are compared exactly when present. Transport adapters additionally require active verified identity matching supplied ownership. A cursor cryptographically encodes only version + ownership + session + run + sequence + event id; any decode, size, owner, session, run, retention, or position failure returns one non-enumerating cursor error.
- `page.after` and `subscribe.after` mean **strictly after** the envelope cursor. The source returns ascending `(sequence, id)` order. It provides at-least-once delivery; consumer deduplicates `record.id`. A terminal source stream ends only after delivery of every preceding record; terminal set is existing `agent_finished`, `agent_denied`, `run_limit_exceeded`, and terminal `error` events. `agent_suspended` is not terminal.
- `subscribe` owns replay/live handoff: establish live wake/listener, then page persisted rows; after every wake or bounded poll page again. It de-duplicates `(sequence,id)` locally. Iterator `return()`/abort removes waiter/timer/listener. A full subscriber queue emits one bounded overflow error then closes; it never drops durable rows silently.
- `AgentEventSourceError.code` is exactly one of `ERR_PRISM_AGENT_EVENT_SOURCE_INPUT`, `ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR`, `ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION`, `ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW`, or `ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED`. It never includes foreign owner/run/event identifiers.
- `ToolEffectDeclaration` classifier runs only after normalized JSON/schema/guardrail validation, is synchronous, deterministic, bounded, and side-effect-free. Omitted declaration preserves legacy unmanaged behavior. `none` bypasses store; `optional` uses store when supplied; `required` blocks pre-execute without a store; `tool_managed` passes core key but performs no generic claim; `unsupported` is explicit nonrecoverable execution and never receives automatic replay.
- Core derives `key = "prism:tool-effect:v1:" + SHA-256(canonical JSON of tenant/account/user/principal/session/run/toolCall/toolName/argumentsHash)` and `argumentsHash = SHA-256(canonical JSON arguments)`. Canonical JSON sorts object keys recursively, preserves array order, accepts JSON values only, and never stores raw arguments. A model/tool argument cannot override this key.
- Legal transitions: absent → pending; failed_retryable → pending (within attempts); pending → dispatched; pending → failed_retryable/failed_terminal; dispatched → completed/failed_retryable/failed_terminal/unknown; unknown → completed/failed_retryable/failed_terminal. `pending` expiry becomes retryable only when dispatch was never recorded; `dispatched` expiry becomes unknown. Every transition checks exact owner/principal/key/hash, claim token, and version CAS. Unknown is retained and requires explicit resolver action.
- Generic dispatch returns stored redacted result only for completed records with a bounded result. Completed with only a reference, pending, dispatched, unknown, terminal failure, conflict, or result-storage failure returns `ToolEffectError` without executing. Post-dispatch abort/throw/store failure is unknown unless a frozen tool-specific reconciler proves completed or not-applied.
- `ToolEffectError.code` is exactly one of `ERR_PRISM_TOOL_EFFECT_REQUIRED`, `ERR_PRISM_TOOL_EFFECT_CONFLICT`, `ERR_PRISM_TOOL_EFFECT_UNKNOWN`, `ERR_PRISM_TOOL_EFFECT_COMPLETED`, or `ERR_PRISM_TOOL_EFFECT_LIMIT`. Claim tokens, raw arguments, raw tool results, credentials, prompts, and provider responses never appear in these errors or in `AgentEvent`.
- Core root exports the contracts, memory stores, errors, and factories. Testing-only conformance helpers export from `@arnilo/prism/testing/agent-event-source-conformance` and `@arnilo/prism/testing/tool-effect-store-conformance`. PostgreSQL sources export only from existing `@arnilo/prism-session-store-postgres` and `@arnilo/prism-enterprise-postgres`; no new package or dependency is allowed.

#### PostgreSQL, transport, and persistence freeze

- PostgreSQL migration 006 adds `prism_agent_event_streams(session_id, run_id, next_sequence, updated_at)` with primary key `(session_id, run_id)` and a unique `prism_agent_events(run_id, sequence)` index. Append checks session/run/owner, locks/upserts one stream row, allocates sequence, inserts event, and calls `pg_notify` in **one checked-out-client transaction**. Existing `MAX(sequence) + 1` is removed. Migration backfills stream rows from existing events and fails on duplicate legacy `(run_id, sequence)` rather than choosing an order.
- One lazy PostgreSQL source owns at most one `pg` listener client for all its local subscribers; construction/import does not connect, listen, poll, or schedule cleanup. Notification payload is a constant wake token; durable rows are source of truth. On subscription it commits `LISTEN`, then reads rows in a separate transaction; every wake, poll, reconnect, and listener error triggers indexed catch-up query. Notification loss/coalescing changes latency, never correctness.
- Existing PostgreSQL pages keep their cursor shape/semantics. Source cursor is a separate opaque v1 cursor and source queries use `(run_id, sequence, id)` plus exact owner/session predicates. SQLite receives only compatible sequence allocation/mapping required by shared record type; it does not claim cross-process notification delivery.
- SSE uses source envelope cursor as `id`, accepts standard `Last-Event-ID`, and reauthorizes before every source open. AG-UI emits `prismEventId = record.id` and its existing bounded replay cursor projection; it has no claimed standard SSE resume field. A2A source adapter maps host task→owned run and keeps `afterEventId` Prism-only. MCP uses only per-stream IDs allowed by Streamable HTTP; no core cursor crosses into MCP protocol state.
- Event-store PostgreSQL DDL/migrations stay in `packages/session-store-postgres`; generic effect-store DDL/migrations stay in `packages/enterprise-postgres`; work idempotency stays separate. PostgreSQL notifications are never a queue, event payload, authorization channel, or recovery record. No Kafka, Redis, ORM, hosted service, sticky-session requirement, second runtime, protocol-specific event database, Phase 8 approval API, or exactly-once claim is in scope.

#### Frozen limits and performance gate

| Surface | Default | Hard cap / rule |
| --- | ---: | ---: |
| Durable event bytes; source cursor bytes | 64 KiB; 4 KiB | 1 MiB; 16 KiB |
| Source page; source subscriber queue; local subscribers per source | 100; 128; 256 | 500; 4,096; 4,096 |
| Memory retained events/run; PostgreSQL retained events/run; retention age | 10,000; 100,000; 30 days | 100,000; 1,000,000; 365 days |
| Cleanup batch | 100 | 500; explicit host call only, no import/factory worker |
| Poll; reconnect initial/max delay; DB listener clients/source | 1 s; 100 ms / 5 s; 1 | 30 s; 5 s / 30 s; exactly 1 |
| Effect key / tool name / argument digest | 96 bytes / 512 bytes / 64 hex bytes | 2 KiB / 512 bytes / fixed SHA-256 |
| Effect stored result / reference / record | 64 KiB / 1 KiB / 128 KiB | 1 MiB / 16 KiB / 1 MiB |
| Effect claim TTL / attempts / terminal retention | 15 min / 3 / 30 days | 60 min / 10 / 365 days; unknown has no automatic expiry |

Task 7 benchmark fixture is fixed at 10 tenants × 10 principals, 1,000 events per owner, 16 producer clients, 16 subscribers, 100 warmups, 1,000 measured append/page/claim/transition operations, 10,000 sustained-stream events, and cleanup batches of 100. On disposable PostgreSQL with indexed plans, p95 ceilings are append 50 ms, page 100 ms, tool-effect claim/transition 50 ms, cleanup 100 ms, and reconnect catch-up 2,000 ms. Event append must remain amortized O(1); all replay/cleanup/key/expiry plans must name their index and avoid sequential scan at fixture volume.

#### Adversarial and protocol matrices

| Area | Required adversarial proof | Frozen response |
| --- | --- | --- |
| Replay/live | Event commits before/after LISTEN, before/after catch-up, duplicate/coalesced/dropped wake, listener disconnect, replica handoff | Query durable rows after each wake/poll; deliver `(sequence,id)` once per subscription; client deduplicates `record.id`. |
| Cursor/tenant | Missing ownership, wrong tenant/account/user, changed run/session, guessed id, malformed/oversize/stale cursor, retention gap | Reauthorize first; exact predicates; generic cursor/not-found error; never reveal foreign identifiers. |
| Backpressure | Slow reader, 4,097th subscriber, queue overflow, abort, iterator return, terminal event during drain | Bounded queue; one overflow outcome then close; release all local resources; durable replay remains available. |
| Effect crash | Before claim; after pending; after dispatched before execute; during execute; external commit before local complete; complete before response; transition write failure; duplicate and concurrent resolver | Only pending without dispatch may retry. Every post-dispatch uncertainty is unknown until CAS reconciliation. |
| Effect input/output | Changed arguments/key, secret/deep/oversize result, stale token/version, expired claim, hostile model key | Canonical hash and core key; bounded redacted result/reference only; reject conflict/limit; no automatic unknown replay. |
| Tool integrations | Browser action, MCP remote mutation, work connector, write/edit/delete/move, Git/shell, delegated child | Metadata/classifier is host-controlled; only exact local proof reconciles; external/ambiguous action requires operator/tool resolver. |
| Protocol | SSE reconnect, AG-UI replay, A2A subscription, MCP resumability | SSE `id`/`Last-Event-ID`; AG-UI cursor projection; A2A extension documented; MCP ids remain per stream. |

Reviewed current sources: PostgreSQL current `LISTEN`/`NOTIFY` via Context7 `/websites/postgresql_current` confirms registration and notification delivery occur at commit and listener setup must commit before a separate state read. WHATWG SSE requires reconnecting EventSource clients to send `Last-Event-ID` after an `id` field. MCP Streamable HTTP says resumability is optional and scoped to an SSE stream. Current A2A `SubscribeToTask` has no `afterEventId`, requires initial task state, and terminates at terminal state. AG-UI server/serialization docs define event streaming but no standard `Last-Event-ID` contract.

#### Task 0 verification

- Static plan validation: all nine tasks retain every required plan section and every acceptance category; Task 0 now records concrete API, limits, state machine, protocol, migration, package, and non-goal decisions.
- Source review confirms all cited paths exist and matches their described current behavior, including local-first event publication, race-prone PostgreSQL sequence allocation, AG-UI local handoff, dispatched-run rejection, and Phase 6 CAS unknown handling.
- No production code was changed; Task 1 is now permitted to implement only this frozen surface.

- [x] Task 1 — Add core AgentEventSource contracts, memory reference, handoff primitive, and conformance
  - Acceptance Criteria:
    - Functional: core exports a database-neutral `AgentEventSource` that appends redacted records, pages one exact owned run after an opaque cursor, subscribes from that cursor, and explicitly cleans retained events in finite batches.
    - Functional: a subscription performs replay→live handoff without a gap; a record read in both phases is emitted once; cursor advancement is deterministic and terminal events close only after all earlier persisted events are delivered.
    - Functional: `createMemoryAgentEventSource()` implements the same semantics for tests/single-process hosts and is labeled non-production; `assertAgentEventSourceConforms()` can test third-party stores without importing a database.
    - Functional: `AgentEventRecord` exposes its durable per-run sequence/cursor position without changing `AgentEvent`; legacy `RunLedger` and `queryEvents` adapters remain assignable.
    - Performance: append is O(1); page/subscription queue, record bytes, page size, cursor bytes, retained records, and cleanup batch are finite; slow consumers receive a typed overflow/closure outcome instead of unbounded buffering.
    - Code Quality: one shared async-generator/handoff helper owns replay, deduplication, terminal detection, cancellation, and iterator cleanup; server/protocol packages consume it later rather than cloning loops.
    - Security: source operations require non-empty exact ownership and run/session ids; cursor owner/run mismatch and malformed/oversized cursors fail with the same non-enumerating error; only redacted records enter a durable-capable source.
  - Approach:
    - Documentation Reviewed:
      - Task 0 freeze; `src/contracts.ts` persistence/event contracts, `src/event-multiplexer.ts`, `src/run-ledger.ts`, `src/redaction.ts`, and current testing subpath conventions.
      - `docs/agent-events.md`, `docs/runs-and-usage.md`, `docs/database-persistence.md`, `docs/public-contracts.md`.
      - WHATWG SSE event-id ordering as transport guidance only; core remains transport-neutral.
    - Options Considered:
      - Put subscribe methods directly on `RunLedger`: forces every write-only adapter to implement reads and breaks narrow ledger mocks; reject.
      - Put only `subscribe` on `ProductionPersistenceStore`: omits append ordering/source ownership and makes memory conformance awkward; reject.
      - Separate optional source contract plus optional persistence capability: chosen.
    - Chosen Approach:
      - Introduce one small source module and one testing conformance module. The memory source uses a bounded per-run insertion-ordered `Map` plus bounded waiter queues; no timer or worker starts until `subscribe()` is iterated.
      - Return source envelopes containing `{ record, cursor }`; consumers persist only opaque cursor strings and deduplicate stable record ids defensively.
      - Keep additive compatibility: `AgentEventRecord.sequence?` is optional for legacy adapters, while `AgentEventSource` requires a concrete positive sequence in returned records.
    - API Notes and Examples:
      ```ts
      const events = createMemoryAgentEventSource({ maxRetainedEventsPerRun: 10_000 });
      await events.append(redactedRecord);
      const page = await events.page({ ownership, sessionId: "s1", runId: "r1", limit: 100 });
      for await (const item of events.subscribe({ ownership, sessionId: "s1", runId: "r1", after: page.nextCursor, signal })) {
        console.log(item.record.id, item.cursor);
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: additive source/query/page/envelope/cleanup types and durable event sequence.
      - `src/agent-event-source.ts`: limits, cursor validation, memory source, shared replay/live helper, typed errors.
      - `src/testing/agent-event-source-conformance.ts`: reusable source conformance.
      - `src/index.ts`, `package.json`: root exports and `./testing/agent-event-source-conformance` subpath.
      - `src/__tests__/agent-event-source.test.ts`: memory, bounds, handoff, cancellation, ownership, cursor, terminal tests.
      - `src/__tests__/conformance-helpers.test.ts`, `src/__tests__/persistence-contracts.types.test.ts`, `src/__tests__/public-export-contract.test.ts`: testing-subpath, legacy-assignability, and SDK-surface guards.
      - `docs/release-and-install.md`: add required public testing-subpath catalog entry.
      - `scripts/compat-baseline/arnilo__prism.txt`: updated only in Task 8 after API review.
    - References:
      - `src/testing/{session-store-conformance,run-ledger-conformance}.ts`: dependency-free adapter conformance style.
      - `src/conversations.ts`: owner/thread-bound opaque cursor precedent.
      - `src/event-multiplexer.ts`: bounded queue/overflow/iterator-return behavior to reuse or align.
  - Test Cases to Write:
    - Append/page in strict sequence with timestamp ties; page size 1; empty page; terminal page; repeated cursor.
    - Event inserted exactly between final replay query and live wait is delivered once.
    - Duplicate append id with identical record is idempotent or returns the frozen duplicate outcome; same id with changed payload fails closed.
    - Slow consumer overflow, abort before subscribe, abort while waiting, iterator `return()`, source close, cleanup during subscription, and terminal drain.
    - Foreign owner/session/run cursor, changed owner dimensions, malformed/base64 garbage, overlong cursor, zero/negative/over-cap limit, unredacted event, oversized event, and sequence regression.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new event-source extension point, event envelope/cursor/error types, memory implementation, testing subpath, and optional event sequence.
    - Docs pages to create/edit: `docs/release-and-install.md` updated now because its export-subpath catalog is CI-gated; `docs/agent-events.md`, `docs/runs-and-usage.md`, `docs/database-persistence.md`, and `docs/public-contracts.md` remain Task 8 work.
    - `docs/index.md` update: yes; Agent events and Database persistence entries describe distributed source vs live-only session subscription (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 1 completion record — 2026-08-04

- Added database-neutral `AgentEventSource` contracts, optional `ProductionPersistenceStore.events`, and additive `AgentEventRecord.sequence?`; existing `RunLedger` and page-query adapters remain assignable.
- Added `createMemoryAgentEventSource()` with signed opaque owner/run cursors, strict redacted-record validation, bounded O(1) append/retention, cleanup, typed cursor/retention/overflow/closed outcomes, and replay/live handoff that registers live delivery before each durable page.
- Added root/testing exports, dependency-free `assertAgentEventSourceConforms()`, API/type-surface guards, and focused memory/conformance tests. Updated `docs/release-and-install.md` only for required package-export catalog coverage; behavioral API docs remain Task 8.
- Verification passed: `npm run typecheck`; focused source/conformance/public-export/type-contract tests; `npm run lint -- --diagnostic-level=error`; `git diff --check`; release-install export test. Full core suite has one unrelated environment failure: `examples/workflow-sqlite-resume.ts` cannot load native `better-sqlite3` binding for Node v24.18.0.

- [x] Task 2 — Implement race-safe PostgreSQL event append, durable subscribe, notifications, and retention
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-session-store-postgres` exposes `persistence.events` implementing `AgentEventSource`; existing `appendEvent()` delegates to it and persists each event once.
    - Functional: per-run sequence allocation is atomic across independent pools/processes and no longer uses `MAX(sequence) + 1`; migration backfills existing runs and adds uniqueness/indexes without rewriting event payloads.
    - Functional: subscription commits `LISTEN` before its catch-up read, treats notification as wakeup only, polls as bounded fallback, reconnects after listener loss, and never skips committed rows when notifications are dropped/coalesced.
    - Functional: explicit cleanup removes only exact-owned events before the requested retention boundary in deterministic capped batches; returned cursors before retained history fail with a typed retention-gap outcome.
    - Performance: append uses one bounded transaction and indexed O(1) counter update/insert; one source instance shares a bounded listener rather than consuming one pool connection per subscriber; poll/reconnect/fanout/subscriber limits are finite.
    - Code Quality: migration follows existing checksum/advisory-lock/full-shape verification; SQLite receives only the shared counter/schema compatibility change required to preserve the common persistence contract, not a distributed subscription implementation.
    - Security: SQL values are bound; schema identifiers remain validated; notifications carry no tenant/run/event identifiers; page/subscribe/cleanup predicates compare exact tenant/account/user/session/run; listener errors and cursors reveal no foreign ids.
  - Approach:
    - Documentation Reviewed:
      - Task 0/1 contracts and conformance; `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/host-security.md`.
      - `packages/session-store-postgres/src/{persistence,ddl,migrations,identifiers,types}.ts`, integration tests, and `packages/session-store-sqlite/src/{persistence,ddl}.ts` migration parity.
      - `packages/session-store-codecs/src/index.ts`; `src/testing/persistence-schema.ts` migration/schema/index assertions.
      - PostgreSQL `LISTEN`/`NOTIFY`, transaction isolation, `INSERT ... ON CONFLICT`, row locking, advisory locks, and `EXPLAIN`: <https://www.postgresql.org/docs/current/sql-listen.html>, <https://www.postgresql.org/docs/current/sql-notify.html>, <https://www.postgresql.org/docs/current/transaction-iso.html>, <https://www.postgresql.org/docs/current/sql-insert.html>, <https://www.postgresql.org/docs/current/using-explain.html>.
    - Options Considered:
      - Global `BIGSERIAL` cursor: simple, but sequence allocation can precede commit and a consumer could advance past a lower uncommitted value; reject without extra commit-order machinery.
      - Per-run counter row updated in the same event insert transaction: serializes only writers for one run and establishes safe committed order; chosen.
      - One `pg` listener per subscriber: straightforward but exhausts pools; reject.
      - Shared listener plus periodic indexed catch-up query: chosen; notification loss affects latency only.
    - Chosen Approach:
      - Add `prism_agent_event_streams(session_id, run_id, next_sequence, updated_at)` and unique `(run_id, sequence)` event index through migration 006; seed counters from existing rows.
      - Allocate/update counter and insert event in one checked-out-client transaction, then call `pg_notify` in that transaction. Commit makes row and wake visible together.
      - Use one lazily acquired listener client per opened PostgreSQL event source, fan out only internal wake tokens, and always query exact-owned rows. Reacquire with bounded backoff while at least one subscription exists; polling remains correctness fallback.
      - Keep SQLite schema/allocator parity for sequence correctness but document it as single-process/non-distributed.
    - API Notes and Examples:
      ```ts
      const persistence = await createPostgresPersistence({
        pool,
        schema: "prism",
        eventCursorSecret: process.env.PRISM_EVENT_CURSOR_SECRET!, // same secret on every replica
      });
      for await (const item of persistence.events.subscribe({ ownership, sessionId, runId, after, signal })) {
        await sendSse(item.record.event, item.cursor);
      }
      await persistence.events.cleanup({ ownership, before: "2026-07-01T00:00:00.000Z", limit: 100 });
      ```
    - Files to Create/Edit:
      - `src/testing/persistence-schema.ts`: migration-v6 table/index/cursor model.
      - `packages/session-store-codecs/src/index.ts`: preserve event sequence in record mapping.
      - `packages/session-store-postgres/src/{event-source,persistence,ddl,migrations,types,lifecycle}.ts`.
      - `packages/session-store-postgres/src/__tests__/{postgres-persistence,postgres-integration,event-source.integration}.test.ts`.
      - `packages/session-store-sqlite/src/{persistence,ddl,migrations,lifecycle}.ts` and SQLite migration/counter tests.
      - `docs/{postgres-persistence,sqlite-persistence}.md`, `src/__tests__/docs.test.ts`: current schema and tested option catalog.
      - `packages/session-store-{postgres,sqlite}/{README.md,CHANGELOG.md}` finalized in Task 8.
    - References:
      - Existing migration 005 contract and catalog verification in `packages/session-store-postgres/src/migrations.ts`.
      - Existing exact-owner query helper behavior in `packages/session-store-postgres/src/persistence.ts`.
      - Phase 6 PostgreSQL retry/cleanup/index evidence in `packages/enterprise-postgres`.
  - Test Cases to Write:
    - Sixteen producers across two pools append one run concurrently: unique contiguous committed sequence and identical page order after restart.
    - Listener established during concurrent append; append between LISTEN commit and catch-up query; notification before/after waiter registration; duplicate/coalesced/lost notification.
    - Listener connection termination and database outage/recovery while poll catches up; bounded reconnect backoff; abort stops timer/listener and releases client.
    - Replica A subscription disconnect then replica B continues from cursor while producer C remains active; no gap and no replay/live duplicate.
    - Slow subscribers with independent bounds, shared-listener fanout cap, terminal drain, cleanup/retention-gap cursor, wrong owner, foreign run, malformed event row, and cancellation.
    - Migration from schema v5 with existing events, concurrent migration, checksum/catalog/index drift, duplicate old sequences, reopen idempotency, SQLite parity, and `EXPLAIN` index use.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; PostgreSQL persistence gains `events`, schema v6, listener/poll/cleanup options, and race-safe sequence behavior; SQLite migration changes internally.
    - Docs pages to create/edit: `docs/postgres-persistence.md` and `docs/sqlite-persistence.md` updated now because schema/version coverage is CI-gated; `docs/database-persistence.md`, `docs/agent-events.md`, `docs/host-security.md`, package READMEs/changelogs remain Task 8.
    - `docs/index.md` update: yes; PostgreSQL persistence entry adds durable distributed event source; SQLite remains non-distributed (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 2 completion record — 2026-08-04

- Added migration 006 shared schema/model parity: `prism_agent_event_streams`, legacy counter backfill, and unique `(run_id, sequence)` event index. Existing migration checksums remain unchanged; SQLite uses the same transactional counter but adds no distributed subscription.
- Added `persistence.events`: strict redacted durable append/page/cleanup, HMAC owner/run-bound cursors, one lazy shared `LISTEN` client, constant wake notifications, bounded per-subscriber queues/poll/reconnect, and exact durable catch-up. `eventCursorSecret` makes cursors portable across replicas. Legacy unredacted `RunLedger.appendEvent()` remains query-only compatibility data and does not enter the durable source.
- Added PostgreSQL protected integration coverage for conformance, 16 concurrent producers/two pools, v5 counter backfill and duplicate-sequence rejection, cross-replica cursor resume, LISTEN wake, cleanup retention gap, and counter-before-session purge; added SQLite counter and lifecycle coverage. Updated schema-gated adapter docs.
- Verification passed: `npm test`; SQLite package tests after native rebuild; PostgreSQL `test:postgres` against disposable PostgreSQL 16; package/core builds; legacy migration checksum assertion. Task 7 remains responsible for outage/listener-loss, benchmark, `EXPLAIN`, and multi-process evidence.

- [x] Task 3 — Wire shared replay/live delivery into server SSE, AG-UI, authorized replay, and A2A
  - Acceptance Criteria:
    - Functional: server exposes an authorized event-stream reconnect path accepting a bounded cursor/`Last-Event-ID`, resolving exact run ownership, and streaming persisted records without creating a session, provider turn, or tool call.
    - Functional: AG-UI cursor replay uses the shared source through terminal or live follow; its current replica-local `session.subscribe()` handoff is removed for distributed mode, and stable Prism event ids remain available for client deduplication.
    - Functional: authorized run replay pages and streams use the same source/cursor semantics; old page-only helpers remain compatible or have a documented migration wrapper.
    - Functional: supervisor exports a narrow host-selected A2A task-event source adapter that consumes `AgentEventSource`; current A2A task ownership/mapping stays host-owned and no second task store is introduced.
    - Functional: transports preserve their own wire contracts: SSE uses `id`/`Last-Event-ID`; AG-UI emits its bounded custom replay cursor/event id projection; Prism’s A2A `afterEventId` behavior remains an explicitly documented adapter extension and is not misrepresented as a current standard field.
    - Performance: every stream inherits source page/queue/time/byte/event caps and transport output caps; cancellation returns iterators, listener subscriptions, timers, and server concurrency slots.
    - Code Quality: adapters map source envelopes only; no adapter contains its own database poll, replay/live race window, or notification listener.
    - Security: every reconnect reauthorizes before source access; client thread/task/run/cursor ids never choose ownership; records must be redacted; foreign and missing runs share non-enumerating failures.
  - Approach:
    - Documentation Reviewed:
      - Task 1/2 source contract; `docs/server.md`, `docs/ag-ui.md`, `docs/a2a.md`, `docs/agent-events.md`.
      - `packages/server/src/{handler,replay,sse,types,limits}.ts`.
      - `packages/ag-ui/src/{handler,replay,ag-ui-mapper,types,limits}.ts`.
      - `packages/supervisor/src/{a2a-types,a2a-server,a2a-client}.ts`.
      - WHATWG SSE plus official AG-UI `@ag-ui/core` 0.0.57 event/types source and docs at repository commit `a40b5c0824564eb2f9ab9edf2be43f355f42a3b8`: events, messages, tools, state, reasoning, interrupts, capabilities, serialization, server, architecture, agentic protocols, integrations, MCP middleware, MCP Apps middleware, A2A integration, and A2A middleware.
      - Current A2A specification/streaming rules and MCP Apps SEP-1865 plus `io.modelcontextprotocol/ui` draft security/capability/resource contract.
    - Options Considered:
      - Reconnect through original `AgentSession`: fails on replica loss and risks rerun; reject.
      - Add separate server/AG-UI/A2A polling implementations: duplicates correctness/security logic; reject.
      - Adapt all transports over `AgentEventSource.subscribe`: chosen.
    - Chosen Approach:
      - Add one server replay-stream helper and allow `createPrismHandler` agent exposures to opt into it; no event source means current live-only behavior remains explicit.
      - Evolve `AgUiReplay` to provide source-backed follow or accept an `AgentEventSource` adapter; terminal replay never invokes `sessionFactory`.
      - Provide an A2A adapter factory requiring host callbacks to map a Prism event record to an `A2ATaskEvent` and resolve task→run. Keep task persistence/status outside Prism core.
    - API Notes and Examples:
      ```ts
      const handler = createPrismHandler({
        agents: { support: { sessionFactory, events: persistence.events, resolveRun } },
        authorize,
      });

      const agui = createAgUiHandler({
        authorize,
        sessionFactory,
        replay: createAgentEventSourceAgUiReplay(persistence.events, { resolveRun, ownership }),
      });
      ```
    - Files to Create/Edit:
      - `packages/server/src/{handler,replay,types,limits,index}.ts`, server replay/SSE tests, and package README.
      - `packages/ag-ui/src/{handler,replay,index}.ts`, handler tests, and package README.
      - `packages/supervisor/src/{a2a-event-source,index}.ts`, A2A tests, and package README.
      - `docs/{server,ag-ui,a2a,ag-ui-adoption,index}.md`: current API, official adoption matrix, and follow-up split.
      - `examples/distributed-agent-events.ts` remains mergeable with Task 8’s complete example.
    - References:
      - `packages/ag-ui/src/handler.ts:182-211`: local handoff being replaced.
      - `packages/server/src/replay.ts`: page-only owner-scoped helper.
      - `packages/supervisor/src/a2a-types.ts:155-161`: current host-owned subscribe seam.
  - Test Cases to Write:
    - Server initial live stream disconnects; another handler instance reconnects using `Last-Event-ID`; no provider/session/tool factory call on reconnect.
    - Cursor query/header conflict, stale/foreign cursor, terminal replay, partial page then live follow, stream cap, slow client, cancel, and redaction failure.
    - AG-UI replay across two handler replicas with exact mapper order, one interrupt, stable `prismEventId`, no duplicate tool/UI event, and no `sessionFactory` on terminal replay.
    - A2A task→run owner mapping, after-event replay, duplicate id rejection, terminal close, missing/foreign task non-enumeration, mapping overflow, and cancellation.
    - Existing live-only server/AG-UI behavior remains available only when explicitly selected and is documented non-distributed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; server exposure/reconnect, AG-UI replay, A2A adapter, cursor, and SSE behavior change.
    - Docs pages to create/edit: `docs/server.md`, `docs/ag-ui.md`, `docs/a2a.md`, new `docs/ag-ui-adoption.md`, and `docs/index.md` updated now; `docs/agent-events.md` and `docs/agent-session-runtime.md` remain release documentation work.
    - `docs/index.md` update: yes; Server/API and Multi-agent/interoperability entries now describe shared distributed replay and link the AG-UI audit.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 3 completion record — 2026-08-04

- Added `GET /prism/agents/:id/runs/:runId/events`: every open reauthorizes, host `resolveRun` binds public selector to exact internal session/run, and shared `AgentEventSource.subscribe()` emits bounded SSE `id`/`data` frames. Matching query cursor or `Last-Event-ID` resumes strictly after a durable record; conflicts fail before source access; reconnect never invokes `sessionFactory`.
- Added `createPrismAgentEventReplay()` for source-backed page/follow while retaining `createPrismEventReplay()`/`createPrismReplayHandler()` compatibility. Added `createAgentEventSourceAgUiReplay()` and optional `AgUiReplay.subscribe`: distributed mode follows source through terminal/live without local session handoff and projects stable `prismEventId` + opaque `prismCursor`.
- Added `createA2AAgentEventSource()`: host resolves task→run and maps one redacted durable record to one task update while source cursor remains event ID. First uncursored output must be full Task; no task store/worker was added; `afterEventId` remains Prism-only.
- Audited official AG-UI 0.0.57, current A2A, MCP middleware, and MCP Apps contracts in `docs/ag-ui-adoption.md`. Audit proved transport replay and full AG-UI client adoption are separate deliverables, so Tasks 3A and 3B were added rather than claiming unsupported input/events/MCP Apps/A2A fronting.
- Verification: focused AG-UI 24 tests, server 49 tests, supervisor 15 tests, package builds, root typecheck/lint/full suite recorded after plan update. Task 7 retains multi-process disconnect/outage/load evidence.

- [x] Task 3A — Complete AG-UI 0.0.57 input, event, interrupt, state, reasoning, and capability compatibility
  - Acceptance Criteria:
    - Functional: `createAgUiHandler` accepts the complete official `RunAgentInput` shape through host-owned policy callbacks: bounded message history, context, state, forwarded properties, client tools, multimodal parts, lineage, and resume; omitted callbacks keep current text-only/default-deny behavior.
    - Functional: mapper supports every current standard AG-UI event family whose semantics Prism or a host projector can prove: lifecycle, step, text, tool, state snapshot/delta, messages snapshot, activity snapshot/delta, reasoning, raw/custom, and interrupt outcomes; deprecated `THINKING_*` and convenience chunk output remain unnecessary.
    - Functional: frontend tools have an explicit host-selected execution/handoff contract and never become server-side `ToolDefinition`s solely because client JSON named them; full-history/tool-result continuation preserves IDs and does not rerun completed tool effects.
    - Functional: multiple bounded interrupts, cancellation, expiry/metadata, and optional edited arguments compose with current durable run CAS; unsupported edits deny rather than mutate persisted calls.
    - Functional: exported capability snapshot declares only enabled transport/tools/state/reasoning/multimodal/HITL features and is testable by an official `@ag-ui/client` `HttpAgent` fixture.
    - Performance: all message/tool/context/state/patch/activity/reasoning/raw/multimodal aggregates have default/hard byte/count/depth/property caps; SSE stays default, while protobuf/WebSocket remain undeclared unless separately implemented.
    - Code Quality: official `@ag-ui/core` schemas remain validation authority; one conversion layer owns input and one mapper owns output sequencing; no duplicate frontend runtime or provider loop.
    - Security: client state/tools/context/forwarded props/media/reasoning/raw events are untrusted and default-deny; ownership, identity, tool permission, URL/media policy, redaction, encrypted-value opacity, and interrupt CAS cannot be widened by protocol fields.
  - Approach:
    - Documentation Reviewed:
      - `docs/ag-ui-adoption.md` and all official AG-UI 0.0.57 documents/source recorded there, especially `RunAgentInputSchema`, `EventSchemas`, capabilities, interrupt lifecycle, and client `HttpAgent` behavior.
      - Prism `src/{contracts,input,content,agents,agent-run-state,tools}.ts`; `packages/ag-ui/src/{input,handler,ag-ui-mapper,projection,limits}.ts`.
    - Options Considered:
      - Treat official schema acceptance as full support while discarding fields: rejected; clients rely on semantic handling.
      - Trust frontend tools/state and merge into agent config: rejected authority escalation.
      - Add host policy/projector callbacks with secure defaults and reuse Prism message/media/tool primitives: chosen.
    - Chosen Approach:
      - Preserve current behavior when new callbacks are absent. Add one authorized request projection that returns accepted Prism messages/state/context/frontend-tool policy; handler never interprets arbitrary forwarded properties itself.
      - Extend mapper with deterministic standard event mappings and host-projected snapshots/deltas/activity/raw values. Visible `ThinkingContent` may become reasoning summaries; signatures remain opaque only through explicit policy and are never described as Prism encryption.
      - Add official client compatibility fixtures for run, state, frontend tool continuation, interrupt/resume, reconnect metadata, and event sequence closure.
    - API Notes and Examples:
      ```ts
      const handle = createAgUiHandler({
        authorize,
        sessionFactory,
        input: { project: authorizedInputProjector, frontendTools: hostFrontendToolPolicy },
        projection: { stateSnapshot, stateDelta, messages, activity, reasoning, raw },
        capabilities: { transport: { streaming: true, resumable: true }, humanInTheLoop: { interrupts: true } },
      });
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/{input,handler,ag-ui-mapper,projection,limits,index}.ts`: bounded input, host projection/handoff, standard mapper, aggregate interrupt, capability snapshot, and public exports.
      - `packages/ag-ui/src/__tests__/{input,handler,ag-ui-mapper}.test.ts`: adversarial input, official client, continuation, interrupt, and schema-family coverage.
      - `packages/ag-ui/package.json`, root `package-lock.json`: exact test-only `@ag-ui/client@0.0.57` fixture; no runtime dependency.
      - `docs/{ag-ui,ag-ui-adoption,host-security,index}.md`, package README/changelog; examples finalized in release task.
    - References:
      - Official source commit/API links frozen in `docs/ag-ui-adoption.md`.
      - Existing core message/media resolution and permission gates; no parallel parser/tool executor.
  - Test Cases to Write:
    - Every official current event schema and legal sequence; mandatory first/last lifecycle, step pairing, message/tool/reasoning closure, interrupt outcome, malformed projector output.
    - Full input matrix: all roles/history, state/context/forwarded props, frontend tools, multimodal data/URL, parent lineage, multiple resume entries, unknown/oversized/deep/wide values.
    - Official `HttpAgent` request/stream fixture; client tool result continuation; state patch resync; capability truthfulness; SSE disconnect metadata.
    - Host callback failure, client tool name collision, hostile schema/state/patch/raw event, encrypted-value substitution, SSRF media, wrong identity/owner, interrupt edit/CAS race.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; AG-UI request, event, projection, capability, tool, media, and interrupt surfaces expand.
    - Docs pages to create/edit: `docs/ag-ui.md`, `docs/ag-ui-adoption.md`, `docs/host-security.md`; package README/changelog.
    - `docs/index.md` update: yes; frontend interoperability entry may claim full 0.0.57 only after compatibility tests pass.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 3A completion record — 2026-08-04

- `parseAgUiInput()` now preserves complete official `RunAgentInput` for host policy while bounding request roles/history/tools/context/state/forwarded props/resume/media and generic JSON bytes, depth, properties, and arrays before callbacks. No `input.project` keeps final-text/default-deny behavior before authorization; projector output is the only Prism session input.
- Added client-only `AgUiFrontendToolHandoff`; selected names must be a request-tool subset and are passed to `sessionFactory` as `AgUiPreparedInput`, never synthesized into Prism tools. Host-projected `Message` IDs preserve client tool-result continuation without dispatching completed effects.
- Extended `AgUiProjection` and mapper with current standard `STEP_*`, state snapshot/delta, messages snapshot, activity snapshot/delta, reasoning/encrypted opaque value, raw, and custom families. Every output validates through official `EventSchemas`; deprecated thinking/chunk forms remain absent.
- Added bounded aggregate interrupt projection/resolution over one current-version core CAS decision. Expiry/metadata and additional host policy interrupts are supported; edited arguments deny before core resume. `handler.capabilities` / `resolveAgUiCapabilities()` reject unavailable transports, edited approvals, and declarations lacking their matching policy/projector.
- Added exact test-only `@ag-ui/client@0.0.57` and an `HttpAgent` SSE fixture. Focused tests cover 31 AG-UI cases including full roles/media/history, default deny, continuation, all standard families, multiple interrupts, edit denial, capabilities, hostile JSON, replay, and official client parsing.
- Updated `docs/ag-ui.md`, `docs/ag-ui-adoption.md`, `docs/host-security.md`, `docs/index.md`, package README, and changelog. Documentation now marks Task 3A compatibility complete and explicitly leaves MCP/MCP Apps/remote A2A fronting to Task 3B.
- Verification: workspace typecheck, focused AG-UI build/tests, docs suite, package budget gate, root lint, full workspace test suite, and `git diff --check` pass.

- [x] Task 3B — Front Prism agents through AG-UI for MCP, MCP Apps, and remote A2A
  - Acceptance Criteria:
    - Functional: AG-UI can front Prism's existing MCP bridge: reviewed remote tools are injected through host policy, MCP calls execute through core dispatch, results return as standard AG-UI tool events, and bounded continuation appears as one run without a second agent loop.
    - Functional: MCP Apps negotiates `io.modelcontextprotocol/ui`, preserves `_meta.ui.resourceUri`/visibility, reads declared `ui://` `text/html;profile=mcp-app` resources, and emits standard `ACTIVITY_SNAPSHOT` data sufficient for a client renderer.
    - Functional: an authorized app-message endpoint/proxy supports only negotiated MCP Apps methods and same-server visibility; app-only tools stay hidden from model lists, cross-server calls fail, and UI-triggered mutations use approval/effect recovery.
    - Functional: AG-UI can front a host-selected remote A2A agent using Prism's verified A2A client, mapping messages/task status/artifacts/tool/UI parts to AG-UI events with streaming fallback and durable task correlation.
    - Functional: direct Prism A2A server and MCP server/client APIs remain independent and compatible; AG-UI handshakes are adapters, not replacements or hidden auto-discovery.
    - Performance: MCP discovery/cache/result/resource/UI HTML/JSON-RPC and A2A card/message/artifact/stream bounds reuse existing package ceilings plus finite iteration/render/proxy limits; no public network in default tests.
    - Code Quality: reuse `@arnilo/prism-mcp` and `@arnilo/prism-supervisor`; do not add official AG-UI MCP/A2A middleware if adapting existing hardened transports is smaller and safer.
    - Security: exact origin/DNS/redirect/auth checks, MCP extension negotiation, iframe sandbox/CSP/permissions, HTML byte/MIME validation, auditable JSON-RPC allow-list, A2A card verification, ownership, redaction, and tool-effect unknown handling are mandatory.
  - Approach:
    - Documentation Reviewed:
      - `docs/ag-ui-adoption.md`; official AG-UI MCP/A2A middleware/integration source; MCP Apps SEP-1865 and `io.modelcontextprotocol/ui` specification; current A2A specification.
      - `packages/mcp/src/{bridge,capabilities,content,transport,types}.ts`; `packages/supervisor/src/{a2a-client,a2a-types,a2a-parts}.ts`; Task 3A input/event policy.
    - Options Considered:
      - Depend directly on official AG-UI middleware: quick, but duplicates Prism MCP/A2A clients and loses hardened host policy; reject unless conformance proves wrapper-only use.
      - Reuse existing clients and add narrow AG-UI adapters: chosen.
      - Accept official middleware's generic `forwardedProps.__proxiedMCPRequest`: reject as authority boundary; expose a dedicated authenticated allow-listed path/callback.
    - Chosen Approach:
      - Extend the existing MCP bridge with explicit `mcpApps: true` extension acknowledgement, nested/flat UI metadata precedence, model/app visibility split, linked resource facade, and same-bridge app call. `createAgUiMcpAdapter()` selects only reviewed model tools and passes them to `sessionFactory`; core remains the sole continuation/dispatch loop.
      - Add an authenticated MCP Apps JSON-RPC proxy/sandbox-config helper separate from rendering. It reauthorizes one bridge and allow-lists initialize/ping/logging/tool/resource calls; host owns the separate-origin DOM, CSP enforcement, durable effect policy, and approval.
      - Add rich `A2AClient.streamMessage()` and `createAgUiA2AAdapter()` over existing verified client/card/origin checks. Host selects start/follow mode and persists protocol task/run correlation before output.
    - API Notes and Examples:
      ```ts
      const bridge = await connectMcpTools({ serverId: "weather", transport, mcpApps: true });
      const handle = createAgUiHandler({
        ...agUi,
        mcp: createAgUiMcpAdapter({ bridge, select: hostReviewedTools }),
        a2a: createAgUiA2AAdapter({ client: verifiedA2AClient, select: hostTaskSelection, correlate: persistTaskCorrelation }),
      });
      const appProxy = createAgUiMcpAppHandler({ apps: bridge.apps!, authorize, context: ownedRun, approveToolCall });
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/{mcp,mcp-apps,a2a,handler,ag-ui-mapper,index}.ts` and `src/__tests__/interoperability.test.ts`: host-selected tool injection, Apps proxy/sandbox, rich A2A mapping, activity, and adversarial protocol coverage.
      - `packages/mcp/src/{bridge,capabilities,types,index}.ts` and `src/__tests__/bridge.test.ts`: negotiated UI metadata/resources/visibility facade; no content mapping rewrite.
      - `packages/supervisor/src/{a2a-client,a2a-types}.ts` and `src/__tests__/a2a.test.ts`: rich stream primitive while retaining text API.
      - `docs/{ag-ui,ag-ui-adoption,mcp-tools,a2a,host-security,index}.md`, affected package READMEs/changelogs, `examples/ag-ui-mcp-apps.ts`, and examples index.
    - References:
      - Official middleware behavior and security differences documented in `docs/ag-ui-adoption.md`.
      - Task 6 remains owner of generic MCP tool-effect declarations; this task consumes, not duplicates, them.
  - Test Cases to Write:
    - MCP list/inject/call/result/continuation, mixed MCP+frontend tools, parallel calls, iteration cap, reconnect without re-execution, hostile metadata/schema/result.
    - MCP Apps negotiation, nested/deprecated metadata precedence, `ui://`/MIME/content/CSP/permission bounds, app/model visibility, same-server tool calls, proxy method allow-list, approval, sandbox messages, cross-origin/server denial.
    - A2A streaming/blocking fallback, task status/artifact/text/tool/A2UI mapping, card signature/origin/auth failure, reconnect/cancel/interrupt, duplicate event IDs, terminal close.
    - Combined AG-UI client fixture using MCP tool + MCP App activity + A2A delegation with exact ownership/redaction and no leaked credentials/HTML outside approved resource response.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; AG-UI gains MCP/MCP Apps/A2A adapter options and event/resource/proxy contracts; MCP metadata preservation may expand.
    - Docs pages to create/edit: `docs/ag-ui.md`, `docs/ag-ui-adoption.md`, `docs/mcp-tools.md`, `docs/a2a.md`, `docs/host-security.md`; package READMEs/changelogs.
    - `docs/index.md` update: yes; interoperability entries describe explicit AG-UI handshakes without merging protocol roles.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 3B completion record — 2026-08-04

- Added opt-in `connectMcpTools({ mcpApps: true })`: client/server must acknowledge `io.modelcontextprotocol/ui`; bridge preserves nested UI metadata over deprecated flat form, hides app-only tools from model tools, bounds linked `ui://` HTML resource reads, and permits same-bridge app-visible calls only.
- Added `createAgUiMcpAdapter()`: host selects reviewed bridge tools, handler passes them as `AgUiPreparedInput.serverTools`, and the existing Prism session/core dispatch loop emits normal tool events plus bounded `mcp-apps` activity. No official AG-UI middleware, tool executor, or agent loop was added.
- Added `createAgUiMcpAppHandler()` and `createAgUiMcpAppSandbox()`: reauthorizing exact-origin single-bridge proxy allow-lists initialize/ping/logging/tools/resources, requires host run context and approval before tool calls, and gives renderer hosts fixed `allow-scripts allow-same-origin` with restrictive CSP/permission configuration. It never renders HTML or retries UI mutations; Task 4 owns generic effect recovery.
- Added `A2AClient.streamMessage()` while retaining text `stream()`, then `createAgUiA2AAdapter()` for verified selected remote start/follow tasks. It persists correlation before output, maps task/status/text/activity, projects non-text/tool/A2UI only through host callback, de-duplicates bounded task events, and accepts blocking fallback only for terminal tasks.
- Added MCP/supervisor/AG-UI protocol fixtures plus `examples/ag-ui-mcp-apps.ts`; updated public docs, package docs/changelogs, and optional AG-UI peer declarations without adding runtime dependencies.
- Verification: focused MCP (40), supervisor (16), and AG-UI (34) tests; full workspace typecheck; docs/example suite; tarball budget; root `npm test`; lint; and `git diff --check` pass.

- [x] Task 4 — Add core tool-effect declarations, state store, dispatch recovery, and conformance
  - Acceptance Criteria:
    - Functional: `ToolDefinition` may declare static or argument-classified effect kind and idempotency behavior; missing declaration remains explicitly unmanaged for compatibility, while a required durable effect without a configured store blocks before `execute()`.
    - Functional: dispatch derives a stable bounded idempotency key from exact owner/session/run/tool-call/tool/arguments digest, places it on `ToolExecutionContext`, and never accepts model text as the authoritative key.
    - Functional: a `ToolEffectStore` represents absent, pending, dispatched, completed, failed, and unknown with claim token/version CAS; only pending may dispatch, completed duplicates may return a bounded stored result/reference, and dispatched/unknown never auto-run.
    - Functional: dispatch records pending before any effect, marks dispatched immediately before `execute()`, then records completed/failed/unknown based on the frozen tool outcome/reconciliation contract; persistence failure after dispatch returns a typed unknown outcome rather than an ordinary retryable tool error.
    - Functional: a memory store and conformance helper cover transition legality, duplicate behavior, expiry, cleanup, and reconciliation; durable run ready/dispatched state composes with the effect record without creating a false safe-retry window.
    - Performance: claims/transitions are O(1); canonical argument digest, record, key, stored result/reference, attempts, TTL, and cleanup are bounded; no raw result above the frozen cap is retained.
    - Code Quality: normal permission/trust/guardrail/validation/before-execute ordering remains; effect management is one opt-in dispatch layer, not middleware conventions or package-specific wrappers.
    - Security: durable effect use requires active verified identity matching ownership; argument changes under the same stable call fail closed; redaction occurs before persisted result/error; callbacks cannot widen tools/identity/permissions or receive credentials.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md`, `docs/agent-session-runtime.md`, `docs/work-tools.md`, `docs/browser-automation.md`, `docs/coding-agent-tools.md`, `docs/mcp-tools.md`, `docs/supervisors.md`.
      - `src/{contracts,tools,agents,agent-run-state,redaction,identity}.ts` and `src/testing/tool-conformance.ts`.
      - Phase 6 `packages/work-tools/src/{types,idempotency,tools}.ts` state machine and PostgreSQL implementation.
      - Existing browser dynamic classifier and coding `ExecutionPolicy` action metadata.
    - Options Considered:
      - Require every tool to be idempotent: impossible for arbitrary external systems and breaking for observations; reject.
      - Retry every thrown mutation with the same key: remote systems may ignore keys and a thrown response may follow successful commit; reject.
      - Treat all post-dispatch failures/aborts as unknown unless a frozen tool-specific classifier/reconciler proves not-applied/completed: chosen.
      - Store unrestricted `ToolResult` for duplicate replay: leaks/overflows; reject in favor of bounded redacted result or reference.
    - Chosen Approach:
      - Add minimal effect metadata and optional `effectStore` to agent/run/direct dispatch configuration. Static metadata covers most tools; one bounded classifier supports browser/MCP/coding cases whose effect depends on arguments.
      - Derive key in core and pass it to the tool. Tool-managed idempotency (work connectors) is declared explicitly so generic dispatch does not double-claim.
      - Default every post-dispatch throw, abort, output rejection, result error, completion failure, and uncertain dispatch transition to `unknown`; only explicit CAS `resolveUnknown()` can mark it safe in core. Package-specific reconcilers remain Task 6, so Task 4 adds no generic callback that could claim external proof.
      - Keep event lifecycle additive with bounded effect status metadata or dedicated `tool_effect_*` events only if Task 0 proves consumers need them; do not leak claims/tokens in `AgentEvent`.
    - API Notes and Examples:
      ```ts
      const result = await dispatchToolCall({
        call,
        registry,
        context,
        effectStore: createMemoryToolEffectStore(),
        ownership,
        identity,
      });
      // execute receives context.idempotencyKey; duplicate completed call returns stored bounded result.
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: effect declaration/context/store/record/status/resolution types and agent/run `effectStore` options.
      - `src/tool-effects.ts`: canonical SHA-256 digest/key derivation, fixed frozen bounds, memory CAS store, expiry/cleanup, errors, and transition helpers.
      - `src/tools.ts`: post-validation classifier isolation, core key injection, claim/dispatch/complete flow, bounded duplicate replay, and typed unknown lifecycle.
      - `src/{agents,agent-run-state}.ts`: agent/run store precedence, durable-store restriction, reset, and declaration-aware fingerprint.
      - `src/testing/tool-effect-store-conformance.ts`, `src/__tests__/{tool-effects,tools,agent-run-state,conformance-helpers,public-export-contract}.test.ts`.
      - `src/index.ts`, `package.json`, `docs/release-and-install.md`: public factory/error/types and CI-gated testing subpath catalog; compact superseded handoff transcripts to retain the root tarball budget while preserving current/package/matrix contracts.
    - References:
      - `src/tools.ts:142-252`: current dispatch order and result/error lifecycle.
      - `src/agents.ts:646-674`: current durable mark window.
      - `packages/work-tools/src/idempotency.ts`: legal state/CAS precedent.
  - Test Cases to Write:
    - Observation/unmanaged/tool-managed/optional/required effect matrix; required store absent blocks before execute.
    - Stable key across restart/replica with same call; changed owner/tool/arguments changes or rejects key; model-supplied argument cannot replace context key.
    - Required/optional/tool-managed/unmanaged observation matrix; required without a store blocks before execute, optional without a store remains unmanaged, and tool-managed receives only the derived key.
    - Canonical stable key ignores caller key, completed replay returns the stored redacted snapshot, and pending/dispatched/unknown/completed-without-result never execute.
    - Post-dispatch throw, result error, overflow, and dispatch-transition response loss return typed unknown; durable pre-execute suspension records retryable-not-applied and then executes once after approval.
    - Stale token/version/hash, expired pending, expired dispatched→unknown, concurrent claim/resolution, cleanup excluding unknown, classifier identity isolation, and public/testing export contract.
    - Existing direct dispatch without effect metadata/store retains prior behavior and tool-conformance tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; tool definitions, execution context, dispatch/agent/run options, effect store, result/error semantics, and possibly event metadata change.
    - Docs pages to create/edit: create `docs/tool-effects.md`; edit `docs/tools.md`, `docs/agent-session-runtime.md`, `docs/public-contracts.md`, `docs/tool-execution-primitives.md`, `docs/host-security.md` (Task 8).
    - `docs/index.md` update: yes; add Recoverable tool effects under Tools and link from runtime/security (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 4 completion record — 2026-08-04

- Added frozen `ToolEffectDeclaration`/classifier, status/key/record/CAS store contracts, agent/run/direct `effectStore`, and core-derived `ToolExecutionContext.idempotencyKey`. Canonical sorted JSON plus SHA-256 binds the key to exact identity ownership, principal, session/run/call/tool, and arguments; caller/model keys are ignored.
- Added `createMemoryToolEffectStore()` and `ToolEffectError`: bounded immutable JSON snapshots, claim token/version CAS, expiry (`pending → failed_retryable`, `dispatched → unknown`), terminal-only cleanup, exact result/reference/failure bounds, and explicit unknown resolution. The dependency-free conformance helper ships at `@arnilo/prism/testing/tool-effect-store-conformance`.
- Shared dispatch runs classifier only after normal validation using an identity/key-free frozen context, claims before `beforeExecute`, marks dispatched immediately before execution, and returns a stored redacted completed snapshot only. Post-dispatch throw/result error/output rejection/overflow/transition loss is typed unknown, emits typed error lifecycle, and never retries; pre-dispatch durable suspension becomes retryable-not-applied.
- Agent configuration passes one store through runtime dispatch; durable runs require it on `AgentConfig`, fingerprint static declarations, and preserve the existing `pending.dispatched` operator-resolution stop. No generic reconciler, side-effect event, second runtime, or database adapter was added; Task 5 owns PostgreSQL and Task 6 owns package-specific reconciliation.
- Added focused store/dispatch/durable/concurrency/redaction tests, public export and testing-subpath guards, and release catalog coverage. Compacted superseded release command transcripts to keep root packed/unpacked budget passing while retaining current, package-catalog, and protected-matrix contracts.
- Verification: core suite (1,386 tests), full workspace typecheck, full `npm test`, lint, docs suite, budget gate, and public/conformance tests pass.

- [x] Task 5 — Add PostgreSQL ToolEffectStore to enterprise state and preserve specialized work recovery
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-enterprise-postgres` exposes `toolEffects` implementing core `ToolEffectStore`; records survive restart and exact duplicate claims from multiple pools produce one dispatch owner.
    - Functional: enterprise migration 002 adds the effect table/indexes without changing migration 001 checksum; migration/order/checksum/catalog drift remains fail-closed and reopen-idempotent.
    - Functional: database-clock claim expiry converts an abandoned pending claim to a safe retryable failed state and an abandoned dispatched claim to unknown; unknown records require explicit CAS reconciliation and are not auto-deleted.
    - Functional: work connector `workIdempotency` remains available with its narrow `{draftId, resourceId?}` and connector-specific reconciliation; adapters may bridge shared context keys but generic storage does not replace work domain semantics.
    - Performance: indexed point claim/transition/read is below frozen p95, cleanup is stable capped oldest-first, contention is bounded, and no full-table scan occurs for owner/key or expiry paths.
    - Code Quality: reuse enterprise identifiers, migration lock/history, codecs, ownership, retry, cleanup, and errors; no second `pg` package or generic SQL repository is added.
    - Security: durable operations require active verified identity, exact owner/principal, bound SQL, argument SHA-256 only, bounded redacted outcome/reference, no claim token in public errors/events, and no raw arguments/prompts/credentials.
  - Approach:
    - Documentation Reviewed:
      - Task 4 core contract/conformance; `docs/enterprise-postgres-state.md`, `docs/work-tools.md`, `docs/host-security.md`.
      - `packages/enterprise-postgres/src/{enterprise,migrations,ddl,records,codecs,cleanup,work-idempotency,errors}.ts` and integration/benchmark tests.
      - PostgreSQL transaction, row-lock, `ON CONFLICT`, partial-index, and `EXPLAIN` references from Phase 6/Task 0.
    - Options Considered:
      - Put generic effects in session-store PostgreSQL: events/runs live there, but effect recovery is enterprise mutation state and would couple every session-store user to tool semantics; reject.
      - Replace work idempotency table/API: loses connector-specific bounded result and migration compatibility; reject.
      - Add one concrete tool-effect table/property beside Phase 6 stores and retain work store: chosen.
    - Chosen Approach:
      - Extend `PostgresEnterpriseState` with `toolEffects`; add migration step 002 and one cleanup branch. Keep factory/import lifecycle unchanged and inert.
      - Use exact owner/principal + stable hashed key as primary uniqueness, claim token/version CAS, database timestamps, finite attempts, and no automatic unknown cleanup.
      - Keep work untouched: core already supplies `context.idempotencyKey`; Task 6 will consume it through work’s specialized store without exposing SQL types.
    - API Notes and Examples:
      ```ts
      const enterprise = await createPostgresEnterpriseState({ pool, schema: "prism" });
      const agent = createAgent({ model, provider, tools, effectStore: enterprise.toolEffects, identity, ownership });
      await enterprise.toolEffects.resolveUnknown({ identity, ownership, key, sessionId, runId, toolCallId, toolName, argumentsHash, expectedVersion, status: "completed", resultRef });
      ```
    - Files to Create/Edit:
      - `packages/enterprise-postgres/src/{tool-effects,enterprise,migrations,ddl,cleanup,types}.ts`.
      - `packages/enterprise-postgres/src/__tests__/{tool-effects.integration,migrations.integration,stores,package,model-router.integration}.test.ts`.
      - `packages/enterprise-postgres/README.md`, `CHANGELOG.md` finalized in Task 8.
      - `scripts/enterprise-postgres-sql-inventory.json` finalized in Task 7.
    - References:
      - `packages/enterprise-postgres/src/work-idempotency.ts`: nearest transition/owner/CAS implementation.
      - `packages/enterprise-postgres/src/migrations.ts`: immutable ordered enterprise migration history.
      - `plans/006-Release-0-0-23-Production-Enterprise-State-Adapters.md`: Phase 6 freeze and measured bounds.
  - Test Cases to Write:
    - Restart/reopen and two-pool concurrent claim/dispatch/complete; one acquired claim and one duplicate outcome.
    - Pending expiry safe retry; dispatched expiry unknown; completion/unknown race; stale token/version; changed arguments digest; max attempts; cleanup retention.
    - Completed bounded result/reference replay; oversize result rejected before persistence; malformed stored JSON/status; secret-shaped input absent from row.
    - Wrong tenant/account/user/principal, foreign key/run/tool id, missing/unverified/expired identity, SQL injection values, and non-enumerating conflict errors.
    - Migration 001→002, fresh install, concurrent migrate, checksum/history/catalog/index drift, rollback, and `EXPLAIN` owner/key/expiry index evidence.
    - Work idempotency conformance remains green and no generic-effect migration rewrites its records.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; enterprise composition gains `toolEffects`, migration 002, cleanup behavior, and SQL permissions.
    - Docs pages to create/edit: `docs/enterprise-postgres-state.md`, `docs/tool-effects.md`, `docs/work-tools.md`, `docs/postgres-persistence.md`, `docs/host-security.md` (Task 8).
    - `docs/index.md` update: yes; Enterprise PostgreSQL state description adds tool effects (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 5 completion record — 2026-08-04

- Added `PostgresEnterpriseState.toolEffects`, backed by `prism_tool_effects` and checksum-protected migration `002_tool_effects`; migration 001 remains byte-for-byte/checksum unchanged. The table binds exact tenant/account/user/principal plus stable effect key, session/run/call/tool/hash and stores only bounded result/reference/failure snapshots.
- Implemented PostgreSQL `ToolEffectStore` using bound SQL, database-clock expiry, row/version/claim-token CAS, and immutable returned snapshots. Missing/changed bindings conflict; pending expiry becomes retryable, dispatched expiry becomes unknown, and unknown has no expiry or automatic deletion. Completed/terminal records retain for 30 days and explicit store cleanup only deletes terminal states.
- Added primary owner/key, expiry, and terminal-cleanup indexes; enterprise cleanup shares its capped budget with exact-principal effect expiry/retention work. Work idempotency remains its separate table/API/reconciliation contract. The legacy v1 → v2 migration, checksum/catalog drift, two-pool claims, restart, stale CAS, bounded values, hostile parameters, owner isolation, unknown retention, maintenance cleanup, and index plans are covered.
- Fixed an existing PostgreSQL model-router fixture to compare accumulated IEEE-754 currency with a `1e-12` tolerance instead of a flaky strict equality.
- Documentation/README/changelog/release metadata remain Task 8 by plan; benchmark-volume and release evidence remain Task 7. Verification: enterprise typecheck/build, default tests, protected PostgreSQL suite (30 tests), and focused migration/effect fixtures pass.

- [x] Task 6 — Classify and integrate MCP, browser, work, coding, and delegated-agent effects
  - Acceptance Criteria:
    - Functional: first-party tools declare conservative effect/idempotency metadata: observations do not claim effects; local/external mutations do; dynamic browser/MCP/coding operations classify from validated arguments with finite deterministic callbacks.
    - Functional: work mutations use core’s stable context key with their specialized store, require a configured idempotency store for approved external effects, replay only completed summaries, and retain explicit connector/operator resolution for unknown.
    - Functional: MCP client bridge lets the host map reviewed remote tools to effect policy; unclassified remote tools are explicitly unmanaged/unknown, never assumed read-only or idempotent; MCP server tool dispatch passes configured effect store/identity/ownership through core.
    - Functional: browser mutation crashes resolve only through existing reload+verify and host reconciliation; no click/form/upload/download action auto-replays. Observation-only snapshot/wait/close behavior stays lightweight.
    - Functional: coding write/edit/delete/move and structured Git mutations expose local-effect metadata and only use deterministic filesystem/Git reconciliation where state proves completion/not-applied; shell and ambiguous external commands never get automatic replay.
    - Functional: delegated child agents inherit exact ownership/identity/effect-store configuration and child tool effects remain attributable to root/delegation/run/tool ids; supervisor delegation itself does not claim completion for unknown child effects.
    - Performance: classifiers/reconcilers perform bounded argument/path/state checks only; no recursive workspace scan, browser trace, MCP discovery call, or child run starts during classification/reconciliation.
    - Code Quality: reuse `classifyBrowserOperation`, coding `ExecutionAction`, work claim store, MCP mapping, and supervisor metadata; no package-specific parallel effect state machine.
    - Security: host policy/approval/validation still runs before effect claim/dispatch; remote MCP metadata cannot grant safe replay; path reconciliation remains workspace-contained; browser/MCP/work credentials and raw responses never enter effect state.
  - Approach:
    - Documentation Reviewed:
      - `docs/mcp-tools.md`, `docs/browser-automation.md`, `docs/work-tools.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/supervisors.md`, `docs/a2a.md`.
      - `packages/mcp/src/{bridge,server,types}.ts`; `packages/browser/src/{policy,tools,checkpoint}.ts`; `packages/work-tools/src/{tools,idempotency,types}.ts`; coding write/edit/delete/move/Git tools; `packages/supervisor/src/{supervisor,types}.ts`.
      - MCP SDK 1.30.0 local contract and official Streamable HTTP transport docs; Playwright 1.61.0 package behavior already pinned and tested locally.
    - Options Considered:
      - Mark every first-party tool external mutation: safe but forces claims for reads and obscures useful semantics; reject.
      - Infer effects from tool names/descriptions: model-facing text is not an authority boundary; reject.
      - Explicit metadata using existing validated operation classifiers: chosen.
      - Auto-retry browser/MCP/shell with stable key: external target may ignore it; reject.
    - Chosen Approach:
      - Add metadata at tool construction, not registry discovery. Browser and structured Git classifiers use only bounded action arguments; MCP policies resolve at bridge construction from the exact configured `{ serverId, remoteName }` selector and never receive remote description/annotation metadata.
      - Add `reconcileCodingToolEffect()` as a host-invoked bounded postcondition probe: only exact write bytes, deleted target, and source-absent/destination-present move states return a completion result. Edit, Git, shell, escapes, read errors, and every other state remain unknown; no package auto-resolves a store record.
      - Thread one configured store through MCP server dispatch and delegated child runs. MCP client tools default to explicit external `unsupported`; host policy can choose stricter reviewed declarations.
      - Keep work’s specialized store; approved mutation rejects before connector dispatch without both core-derived `context.idempotencyKey` and its configured store. The legacy JSON `idempotencyKey` field remains compatibility-only and is ignored.
    - API Notes and Examples:
      ```ts
      const bridge = await connectMcpTools({
        serverId: "crm",
        transport,
        effect: ({ remoteName }) => remoteName === "get_customer"
          ? { kind: "none", idempotency: "none" }
          : { kind: "external_mutation", idempotency: "required" },
      });

      const proof = await reconcileCodingToolEffect({ cwd, record, args: pendingCall.arguments });
      if (proof.status === "completed") await effects.resolveUnknown({ ...key, expectedVersion, ...proof });
      ```
    - Files to Create/Edit:
      - `src/{tools,__tests__/tool-effects.test.ts}`: unsupported declarations preserve direct no-identity compatibility without a derived key.
      - `packages/mcp/src/{types,bridge,server,index}.ts` and bridge/server tests: host selector policy and server effect-store dispatch.
      - `packages/browser/src/{policy,tools,index}.ts` and policy tests: existing operation class → `none` or external `unsupported` declaration.
      - `packages/work-tools/src/{tools,__tests__/work-tools.test.ts}`: tool-managed mutation matrix and core-key-only specialized CAS claim.
      - `packages/coding-agent/src/{effects,write,edit,delete,move,git-tools,shell,read,list,search,glob,checks,ask-user-decision,index}.ts` and `effects.test.ts`: first-party declaration matrix plus exact local postcondition probe.
      - `packages/supervisor/src/{types,supervisor}.ts` and delegation tests: parent identity/store propagation and attribution session/run ids.
      - Package READMEs/changelogs and docs finalized in Task 8.
    - References:
      - `packages/browser/src/policy.ts`: existing observation/mutation/high-impact classifier.
      - `packages/work-tools/src/tools.ts:61-128`: current tool-local claim/effect/completion window.
      - `packages/mcp/src/bridge.ts:160-183`: remote definition mapping point.
      - `packages/supervisor/src/supervisor.ts:115-151`: child session/run ownership and metadata propagation.
  - Test Cases to Write:
    - Coding/Git and work aggregators classify every fixed first-party observation/mutation; browser operation classes map snapshot/wait/close to `none` and navigation/form/upload/download to external `unsupported`.
    - Work approved mutations without specialized store/key fail before CLI; core context key wins over hostile JSON field; duplicate/unknown remains connector-specific.
    - MCP defaults remote tools to external `unsupported` even with a read-only description; exact host selector can declare reviewed read/required mutation; MCP server receives store/identity/ownership and derives its key.
    - Browser checkpoint verify-after-resume remains the only browser recovery path; browser actions never receive generic replay.
    - Coding exact write bytes, deleted target, and move source/destination state prove only a bounded completed result; edit/Git/shell/escape remain unknown.
    - Supervisor child sees the same verified identity/store and effect session encodes root/delegation while run/tool-call IDs remain core-attributed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; package tool metadata/options, work key behavior, MCP effect resolver/server options, browser/coding recovery, and supervisor propagation change.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `docs/browser-automation.md`, `docs/work-tools.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/supervisors.md`, `docs/a2a.md`, `docs/tool-effects.md` (Task 8).
    - `docs/index.md` update: yes; Tools and Multi-agent entries link to recovery semantics (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 6 completion record — 2026-08-04

- Added conservative first-party declarations: browser observations are `none`; browser actions are external `unsupported` and retain checkpoint reload+verify. Coding reads/list/search/glob/Git inspection/HITL are `none`; writes, edits, deletes, moves, and structured Git mutation actions are local optional effects; shell, named checks, PR handoff, and ambiguous Git paths are external `unsupported`.
- Added bounded host-invoked `reconcileCodingToolEffect()`. It proves only exact workspace-contained write bytes, an absent delete target, or source-absent/destination-present move; it returns a redaction-safe completion summary for the host to CAS-resolve. It scans no workspace and never auto-replays or resolves edit/Git/shell/failed proof.
- Work mutations are explicit `tool_managed` effects. Approved calls now require core’s derived `context.idempotencyKey` plus work’s specialized store before the connector starts; model-supplied JSON keys are ignored. MCP remote tools default to explicit external unsupported unless host policy matches its configured server/name, while MCP server dispatch now receives its configured `effectStore`. Supervisor validates and propagates one exact identity/store into child configuration and delegation context.
- Added package/core fixtures for metadata, hostile keys/descriptions, store-less blocking, exact local proofs, MCP server key wiring, browser class mapping, unsupported direct compatibility, and delegated root/delegation/run attribution. Documentation/README/changelog/release metadata remain Task 8; benchmark/multi-process/crash evidence remains Task 7. Verification: focused package builds/tests, full workspace typecheck and `npm test`, lint, budget gate, and `git diff --check` pass.

- [x] Task 7 — Run multi-process/crash/security conformance and freeze performance/storage evidence
  - Acceptance Criteria:
    - Functional: one protected suite proves producer/consumer/event-source/tool-effect behavior across independent Node processes and PostgreSQL pools, including restart, reconnect, listener loss, notification loss, and every frozen effect crash window.
    - Functional: server, AG-UI, A2A, MCP, browser, work, coding, supervisor, session-store, enterprise-store, and core conformance suites pass together; no test silently substitutes local live subscription for distributed source behavior.
    - Performance: benchmark records fixture, hardware/runtime/PostgreSQL versions, median/p95/throughput, reconnect latency, append latency, sustained stream rate, listener/subscriber heap, cleanup, effect claim/transition latency, contention, and row growth against Task 0 ceilings.
    - Performance: query-plan evidence proves per-run replay, sequence allocation, retention cleanup, effect key lookup, and effect expiry cleanup use named indexes without full-table scans at frozen selective volumes.
    - Code Quality: deterministic fake/local tests remain default; protected PostgreSQL evidence fails clearly when enabled without configuration; benchmark JSON and budgets are reviewable, versioned, and not regenerated during ordinary tests.
    - Security: adversarial suite covers cross-tenant timing/data/id/cursor isolation, SQL injection, listener/pool exhaustion, malformed rows, redaction, oversized event/effect data, stale CAS, and unknown-outcome non-replay.
  - Approach:
    - Documentation Reviewed:
      - Existing `scripts/benchmark-0.0.23.mjs`, `scripts/budgets.json`, `scripts/budget-gate.test.mjs`, PostgreSQL test scripts, SQL inventory, release scripts, and protected workflow conventions.
      - `docs/performance.md`, `docs/host-security.md`, `docs/release-and-install.md`, `docs/0.1.0-readiness.md`.
      - PostgreSQL `EXPLAIN`, statistics, notification queue, and connection guidance from Task 0/2.
    - Options Considered:
      - Mock multi-replica behavior in one process only: misses listener/pool/process failure; reject as final evidence.
      - Make PostgreSQL mandatory for every default test: harms network-free development; reject.
      - Network-free conformance plus explicit disposable/protected PostgreSQL process suite and checked-in evidence: chosen.
    - Chosen Approach:
      - Add one dependency-free child-process fixture plus `scripts/phase7-conformance.test.mjs`, run only after the existing explicit URL gate in root `test:postgres`. Sixteen independent Node producers, replica reopen, `pg_terminate_backend()` listener loss, bounded polling catch-up, and effect worker exit all use real PostgreSQL rows/pools; default tests remain network-free.
      - Add migration 007 rather than rewrite frozen migration 006: a partial exact-owner/time durable-event cleanup index. The source cleanup query branches exact optional ownership predicates and limits itself to redacted source rows, so PostgreSQL can use the new index without changing legacy ledger retention behavior.
      - Freeze a separate 0.0.24 benchmark/evidence pair at the Task 0 volume and p95 ceilings. It records host/runtime/PostgreSQL versions, append/page/effect/cleanup/reconnect latency, 10,000-event × 16-subscriber replay, heap delta, storage rows/bytes, and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` index plans. Polling fallback remains a correctness proof, not a latency benchmark.
    - API Notes and Examples:
      ```bash
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" node scripts/benchmark-0.0.24.mjs > scripts/benchmark-0.0.24.json
      node --test scripts/budget-gate.test.mjs
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `scripts/{phase7-conformance.test,benchmark-0.0.24}.mjs`, `scripts/benchmark-0.0.24.json`, and `scripts/fixtures/phase7-worker.mjs`: protected independent-process events/effects and checked benchmark evidence.
      - `scripts/{budgets.json,budget-gate.test.mjs,enterprise-postgres-sql-inventory.json,tooling-gate.test.mjs}` and root `package.json`: frozen fixture/evidence gate, tool-effect least-privilege inventory, and URL-gated protected command.
      - `src/testing/persistence-schema.ts`; `packages/session-store-{postgres,sqlite}/src/{ddl,migrations}` and migration tests: additive migration 007 retention index with immutable 001–006 checksums.
      - `packages/session-store-postgres/src/{event-source,__tests__/event-source.integration.test}.ts`: indexed exact-owner redacted source cleanup and `EXPLAIN ANALYZE` evidence.
      - `packages/enterprise-postgres/src/__tests__/work-idempotency.integration.test.ts`, `src/__tests__/docs.test.ts`: core-key compatible protected work fixture and protected-command contract assertion.
      - `.github/workflows/*` unchanged: existing PostgreSQL job already builds then invokes root `test:postgres`.
      - `docs/performance.md`, `docs/host-security.md`, `docs/0.1.0-readiness.md` finalized in Task 8.
    - References:
      - Phase 6 fixed benchmark and SQL inventory in `scripts/benchmark-0.0.23.*` and `scripts/enterprise-postgres-sql-inventory.json`.
      - Root `test:postgres` and `sdk:ready` scripts.
  - Test Cases to Write:
    - Sixteen independent Node producers append one owned run; a separate replica receives all contiguous records, another resumes at cursor, and a foreign tenant receives only generic cursor failure without run disclosure.
    - Terminate the actual shared `LISTEN` backend with PostgreSQL `pg_terminate_backend(pid, 1000)` while a subscriber waits; append from a child process before its deliberately delayed reconnect and prove bounded polling catch-up.
    - Child exits after pending claim and after dispatched external counter increment. A restart sees pending as existing until expiry/retryable; dispatched expiry becomes unknown and counter remains exactly one with no replay.
    - Seed 10 tenants × 10 principals × 1,000 durable events, run 1,000 append/page/effect transitions with 100 warmups, replay 10,000 events to 16 consumers, record heap/throughput, and assert fixed 100-row event/effect cleanup deltas.
    - `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` names event replay/stream PK/owner cleanup and effect key/expiry indexes with no sequential scans; adapter integration repeats real-plan replay/cleanup assertion.
    - Full network-free suite, protected PostgreSQL suite, typecheck, lint/format, artifact budget, and `git diff --check` pass; child workers, listeners, pools, and temporary schemas exit/remove deterministically.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API; this task freezes verification and operational evidence for APIs from Tasks 1–6.
    - Docs pages to create/edit: `docs/performance.md`, `docs/host-security.md`, `docs/0.1.0-readiness.md` with measured evidence (Task 8 finalizes wording).
    - `docs/index.md` update: yes; Performance and readiness descriptions mention 0.0.24 distributed-event/effect evidence (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 7 completion record — 2026-08-04

- Added URL-gated real PostgreSQL process conformance to root `test:postgres`. Sixteen child Node processes append concurrently; a second replica resumes a signed cursor; a foreign cursor is generic. The suite terminates the true `LISTEN` backend with `pg_terminate_backend`, delays reconnect for five seconds, then proves 25 ms polling catches a child append. It also exits workers after pending and dispatched effect states: only expired pending retries; dispatched becomes unknown and its external counter stays one.
- Query-plan evidence revealed owner-retention cleanup could not use its prior indexes. Added additive persistence migration 007 (`prism_agent_events_owner_timestamp_sequence_idx`) for both adapters without rewriting migration 006. PostgreSQL source cleanup now uses exact ownership branches and `redacted = TRUE`, preserving legacy non-redacted ledger rows outside the durable-source cleanup path. Protected `EXPLAIN ANALYZE` verifies replay and retention plans; effect plans remain primary/expiry indexed.
- Added checked `benchmark-0.0.24.json` from Node v24.18.0/Linux x64, PostgreSQL 16.14, AMD Ryzen 9 PRO 7940HS, and 64 GiB RAM. Fixed fixture: 100 owned runs × 1,000 events, 16 producers, 16 replay subscribers, 100 warmups, 1,000 append/page/effect operations, 10,000 sustained replay events, and 100-row cleanup. Recorded p95: append 1.502 ms, page 3.103 ms, effect transition 3.084 ms, event cleanup 1.370 ms, effect cleanup 3.242 ms, reconnect 7.883 ms; all under frozen 50/100/2,000 ms ceilings. Sustained replay delivered all 160,000 subscriber-events at 101.34 events/s and grew heap 20,095,072 bytes; cleanup removed exactly 100 event and 100 effect rows.
- Added evidence/budget/inventory gates. Verification passed: full workspace typecheck and `npm test`; protected `PRISM_TEST_POSTGRES_URL=… npm run test:postgres`; benchmark; Node 20 build/public-export import smoke; lint/format; artifact budget; and diff check. Documentation/migration wording, release metadata, and version bump remain Task 8.

- [x] Task 8 — Documentation, migration, example, packaging, version 0.0.24, and release gate
  - Acceptance Criteria:
    - Functional: one packed public example demonstrates producer on replica A, reconnect/follow on replica B, stable cursor persistence, required tool effect, duplicate completed result, and explicit unknown reconciliation without rerunning the effect.
    - Functional: docs clearly distinguish live `session.subscribe`, durable event pages, distributed source subscription, transport cursors, at-least-once delivery, duplicate consumer deduplication, effect idempotency, and unknown outcomes; no page claims exactly-once.
    - Functional: migration guide covers schema v6 event streams plus schema v7 exact-owner event-retention index, enterprise migration 002, new configuration/options, work idempotency-key authority, adapter behavior changes, cursor retention gaps, rollback/backup, and compatibility for hosts that do not opt in.
    - Functional: all 47 publishable manifests/changelogs/peers/lockfile/runtime version/release metadata agree on 0.0.24; no new package is added unless Task 0 recorded unavoidable evidence.
    - Performance: package/tarball/startup budgets and 0.0.24 benchmark evidence pass without unreviewed regression; import/setup remain inert until host opens a store or iterates a subscription.
    - Code Quality: API pages follow Prism wiki structure; docs tests assert maintained behavior rather than implementation strings; public declarations and compatibility baseline include only Task 0-frozen changes.
    - Security: examples use fake secrets/loopback/disposable PostgreSQL guidance, exact authorization/ownership/redaction, finite limits, and explicit operator reconciliation; SQL role inventory separates migration/listener/request permissions.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure.
      - All docs listed in roadmap Phase 7 plus `docs/tools.md`, `docs/tool-effects.md`, `docs/database-persistence.md`, `docs/postgres-persistence.md`, `docs/enterprise-postgres-state.md`, `docs/public-contracts.md`, `docs/performance.md`, `docs/host-security.md`, `docs/release-and-install.md`, `docs/0.1.0-readiness.md`.
      - Root/package README/changelog/version/release/compat/budget/docs-test conventions from release 0.0.23.
    - Options Considered:
      - Add prose to existing Tools page only: event/effect API and operational detail would become hard to navigate; reject.
      - Create one focused `docs/tool-effects.md` and expand canonical event/persistence/protocol pages: chosen.
      - Add a new package/profile for event delivery: no independent dependency boundary is needed; reject unless Task 0 proves otherwise.
    - Chosen Approach:
      - Document each API at its owning page and link through `docs/index.md`; keep one complete runnable example instead of many near-duplicates.
      - Version existing packages together, update compatibility baseline after review, then run full release preflight from clean checkout.
      - Mark roadmap Phase 7 complete only after all focused/protected/full gates pass and evidence is recorded; fill plan compromises/further actions with actual results.
    - API Notes and Examples:
      ```ts
      const persistence = await createPostgresPersistence({ pool });
      const enterprise = await createPostgresEnterpriseState({ pool });
      const agent = createAgent({ model, provider, tools, runLedger: persistence, effectStore: enterprise.toolEffects });

      for await (const { record, cursor } of persistence.events.subscribe({ ownership, sessionId, runId, after })) {
        save(cursor); // consumer deduplicates record.id; reconnect never reruns agent work
        render(record.event);
      }
      ```
    - Files to Create/Edit:
      - Create `docs/tool-effects.md` and `examples/distributed-events-and-tool-effects.ts`; retain or merge Task 3B's AG-UI MCP/A2A client example.
      - Edit `docs/{agent-events,agent-session-runtime,runs-and-usage,server,ag-ui,ag-ui-adoption,a2a,mcp-tools,work-tools,browser-automation,coding-agent-tools,coding-security,supervisors,database-persistence,postgres-persistence,sqlite-persistence,enterprise-postgres-state,tools,tool-execution-primitives,public-contracts,host-security,performance,migration,release-and-install,0.1.0-readiness,index}.md`.
      - Edit root/package `README.md` and `CHANGELOG.md` files for affected packages.
      - Edit root/workspace `package.json` files, `package-lock.json`, `src/version.ts`, release metadata, `scripts/compat-baseline/*`, `scripts/budgets.json`, and docs/release tests.
      - `plans/README.md`: mark plan active/complete as execution progresses.
      - `roadmap.md`: add Phase 7 completion evidence only after exit gate passes.
    - References:
      - `plans/README.md` active plan index.
      - `src/__tests__/docs.test.ts` current release/docs tripwires.
      - `scripts/release.mjs`, `scripts/release-gate.test.mjs`, compatibility and budget gates.
  - Test Cases to Write:
    - Compile and run packed example using public exports only; verify reconnect path invokes effect once and explicit reconciliation resolves unknown.
    - Docs link/API-section/version/package-count/migration tripwires; search rejects stale `0.0.23` current-line claims and exactly-once wording outside explicit rejection text.
    - Public declaration diff matches Task 0 freeze; all package root imports work on Node 20/current from packed tarballs.
    - `npm run sdk:ready`, `npm audit --audit-level=moderate`, PostgreSQL protected suites/benchmark, package budget, secret/SBOM/license/provenance gates, 47-package dry-run pack, `release:check --version 0.0.24`, and `git diff --check` pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task publishes all Phase 7 event-source, cursor, transport, tool-effect, reconciliation, persistence, and package changes.
    - Docs pages to create/edit: exact list under Files to Create/Edit; each API page follows `.agents/skills/create-plan/references/prism-wiki.md`.
    - `docs/index.md` update: yes; add Recoverable tool effects under Tools; update Agent events, Runtime, Server/API, Interoperability, Persistence, Performance, Migration, and Release/install entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

### Task 8 completion record — 2026-08-04

- Added `docs/tool-effects.md` and network-free `examples/distributed-events-and-tool-effects.ts` (cursor resume + required effect claim/replay + unknown resolve). Migration `0.0.23 → 0.0.24` covers schema v6/v7, enterprise migration 002, core key authority, and at-least-once (not exactly-once).
- Bumped all 47 manifests/peers/lockfile/`version` export/changelogs to **0.0.24**; updated compat baselines; remeasured root tarball budgets (645,024 packed / 2,269,194 unpacked / 290 files).
- Roadmap Phase 7 and plans index marked complete. Verification: flock-isolated `npm test` EXIT 0; lint/format; `release:check --version 0.0.24`; `release:gate --allow-break`; Node 20 public-export import smoke; example demo.

## Compromises Made

- Root tarball budget baselines raised to measured 0.0.24 sizes for intentional Phase 7 docs/API growth (still gated at +5%).
- Example uses in-memory event/effect stores so default demos stay network-free; protected PostgreSQL evidence remains Task 7.
- Shared compact package changelog blurb; detailed behavior stays in migration + tool-effects docs.
- Concurrent overlapping `npm test`/`build` can race root `clean` and delete `dist/` mid-run; release verification must be single-flight.

## Further Actions

- Priority high: cut signed `v0.0.24` and run protected PostgreSQL + publish dry-run from a clean single-flight checkout (operator).
- Priority medium: optional non-destructive workspace rebuild path so concurrent cleans cannot wipe live `dist/`.
- Priority low: public `deriveToolEffectKey` export if hosts need offline key derivation outside dispatch.
- Priority low: Phase 8 builds on frozen tool-effect/event-source seams for custom-loop snapshots and richer HITL.
