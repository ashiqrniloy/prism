# Runs and usage ledger

## What it does

`RunLedger` is the host-implemented, write-only seam Prism uses to durably persist run metadata, agent events, tool calls, and usage during a `session.run()`. `RunFeedbackStore` is the separate post-run seam for immutable ratings, comments, tags, and evaluation links. The runtime calls the adapter as each record becomes available; the adapter decides how to write it (SQL insert, NoSQL put, JSONL append, time-series batch, etc.).

APIs:

- `RunLedger`
- `RunLedgerRecord`
- `RunRecord` / `RunStatus`
- `AgentEventRecord`
- `ToolCallRecord` / `ToolCallStatus`
- `UsageRecord`
- `redactRunLedgerRecord()`
- `RunFeedbackRecord` / `RunFeedbackStore` / `createMemoryRunFeedbackStore()`

## When to use it

Configure `AgentConfig.runLedger` when you want every run of an agent to be persisted. Override it per run with `RunOptions.runLedger` if a single run needs a different adapter or no adapter at all. Use `runLedger` whenever you need durable observability, billing, audit replay, or run-scoped analytics.

Do not use `RunLedger` as a replacement for `SessionStore` — messages, branches, and session entries continue to go through `SessionStore.append()`. Do not use it for live streaming; subscribers still receive `AgentEvent` through `session.subscribe()`.

## Inputs / request

Set the ledger and optional ownership scope/idempotency key on the agent or the run:

| Field | Where | Purpose |
| --- | --- | --- |
| `runLedger` | `AgentConfig` / `RunOptions` | `RunLedger` adapter. `RunOptions.runLedger` wins. |
| `ownership` | `AgentConfig` / `RunOptions` | `{ tenantId?, accountId?, userId? }` copied into every record. `RunOptions.ownership` wins. |
| `idempotencyKey` | `AgentConfig` / `RunOptions` | Optional key for run deduplication. `RunOptions.idempotencyKey` wins. |

`RunLedger` methods:

| Method | Record | When called |
| --- | --- | --- |
| `appendRun` | `RunRecord` | After run starts (`running`) and again at finish (`succeeded`/`failed`/`aborted`). |
| `appendEvent` | `AgentEventRecord` | After every emitted `AgentEvent`, after redaction. |
| `appendToolCall` | `ToolCallRecord` | For each tool-call `started`, `progress`, `finished`, `error`, and `blocked` transition. |
| `appendUsage` | `UsageRecord` | Once per terminal provider turn (`scope: "provider_turn"`) and once for the O(turns) aggregate (`scope: "run_total"`). |

All methods may be sync or async (`void | Promise<void>`). The runtime awaits them at safe boundaries, so a slow adapter blocks the run.

## Outputs / response / events

The adapter receives these record shapes:

`RunRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Same as `runId`. |
| `sessionId` | Session id. |
| `branchId` | Current branch leaf at run start. |
| `model` | Resolved model config for the run. |
| `provider` | Resolved provider id for the run. |
| `idempotencyKey` | Optional host key. |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` \| `aborted`. |
| `startedAt` / `finishedAt` | ISO timestamps. |
| `abortReason` | Set when status is `aborted`. |
| `error` | `ErrorInfo` when status is `failed`. |
| `tenantId` / `accountId` / `userId` | From active ownership scope. |

`AgentEventRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Unique ledger row id. |
| `runId` / `sessionId` / `entryId` | Correlation ids. |
| `type` | `AgentEvent["type"]` discriminator. |
| `timestamp` | Event emission time. |
| `event` | The emitted `AgentEvent`. |
| `redacted` | `true` when a `SecretRedactor` is active. |

`ToolCallRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Unique ledger row id. |
| `toolCallId` / `name` | From the provider tool call. |
| `arguments` | JSON object passed to the tool. |
| `result` | `ToolResult` for `finished`/`error`/`blocked` rows. |
| `status` | `started` \| `finished` \| `error` \| `blocked`. Progress snapshots reuse `started` with `progress` fields. |
| `reason` | Block reason for `blocked` rows (`unknown_tool`, `tool_denied`, `invalid_arguments`, `permission_denied`, `validation_failed`). |
| `progress` / `progressMetadata` / `progressAt` | Populated on progress snapshots. |
| `startedAt` / `finishedAt` | Tool-call timing. |
| `redacted` | `true` when a `SecretRedactor` is active. |

`UsageRecord`:

| Field | Purpose |
| --- | --- |
| `id` | Unique ledger row id. |
| `runId` / `sessionId` / `entryId` | Correlation ids. |
| `scope` | `provider_turn` for billable source rows; `run_total` for the aggregate. Never sum both scopes. |
| `turn` / `attempt` | Provider-turn attribution; absent on `run_total`. |
| `usage` | `Usage` shape: input/output/total/cache tokens, cost, currency. |
| `recordedAt` | ISO timestamp. |

## Run/trace feedback

`RunFeedbackStore.append()` accepts an immutable record only when `resolveRun` finds the same `runId` under the exact `{ tenantId, accountId?, userId? }` scope. A tenant plus account or user is mandatory. Records contain `sessionId`, optional `traceId`, finite `rating` in `[-1, 1]`, comment, tags, scorer IDs, evaluation IDs, timestamp, creator, and metadata. Correction appends a new ID; records are never updated in place. `delete()` is the explicit privacy/retention operation.

```ts
import { createMemoryRunFeedbackStore } from "@arnilo/prism";

const feedback = createMemoryRunFeedbackStore({
  resolveRun: ({ runId }) => runId === result.runId
    ? { runId, sessionId: result.sessionId, tenantId: "t1", userId: "u1" }
    : false,
  redactor,
});
await feedback.append({
  id: "fb_1",
  runId: result.runId,
  rating: 1,
  comment: "Useful and cited",
  tags: ["reviewed"],
  evaluationIds: ["eval_1"],
  tenantId: "t1",
  userId: "u1",
});
const page = await feedback.query({ runId: result.runId, tenantId: "t1", userId: "u1", limit: 50 });
await feedback.delete({ id: "fb_1", tenantId: "t1", userId: "u1" });
```

Default/hard bounds: comment 4/16 KiB, tags 16/64, scorer/evaluation IDs 16/64 each, metadata 16/64 KiB, query page 100/500; tags are 64 characters and identifiers 128. The store redacts comment/tags/metadata after run ownership validation and before persistence. IDs are linked, not scorer payloads. `ProductionPersistenceStore.feedback?` exposes this capability; first-party SQLite/PostgreSQL adapters implement it in schema migration `003_run_feedback` and reject missing/cross-owned runs.

## Status transitions

```
queued ──> running ──> succeeded
              │
              ├──────> failed
              │
              └──────> aborted
```

- `queued` is reserved for host scheduling and is not emitted by the runtime.
- `running` is written immediately after provider/model resolution and `agent_started`.
- `succeeded` / `failed` / `aborted` are written once in `finally`.
- Only the final `RunRecord` contains `finishedAt`, `abortReason`, or `error`.

## Request/response example

```json
{
  "id": "run_abc",
  "sessionId": "session_1",
  "branchId": "branch_1",
  "provider": "openai",
  "model": { "provider": "openai", "model": "gpt-4o" },
  "status": "succeeded",
  "startedAt": "2024-01-01T00:00:00Z",
  "finishedAt": "2024-01-01T00:00:05Z",
  "tenantId": "tenant_a",
  "idempotencyKey": "run-key-123"
}
```

```json
{
  "id": "toolcall_def",
  "sessionId": "session_1",
  "runId": "run_abc",
  "toolCallId": "call_1",
  "name": "echo",
  "arguments": { "text": "hi" },
  "status": "finished",
  "result": { "toolCallId": "call_1", "name": "echo", "value": { "text": "hi" } },
  "startedAt": "2024-01-01T00:00:01Z",
  "finishedAt": "2024-01-01T00:00:02Z",
  "redacted": false
}
```

## Implementation example

```ts
import {
  cacheUsageReport,
  createAgent,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  type RunLedger,
  type RunRecord,
  type AgentEventRecord,
  type ToolCallRecord,
  type UsageRecord,
} from "@arnilo/prism";

const runs: RunRecord[] = [];
const events: AgentEventRecord[] = [];
const toolCalls: ToolCallRecord[] = [];
const usageRows: UsageRecord[] = [];

const ledger: RunLedger = {
  appendRun: async (record) => { runs.push(record); },
  appendEvent: async (record) => { events.push(record); },
  appendToolCall: async (record) => { toolCalls.push(record); },
  appendUsage: async (record) => { usageRows.push(record); },
};

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
  runLedger: ledger,
  ownership: { tenantId: "tenant_a", accountId: "account_a" },
  idempotencyKey: "agent-key",
  redactor: createSecretRedactor([process.env.APP_KEY!]),
});

const session = agent.createSession({ id: "session_1" });

// per-run override
await session.run("Hello", {
  idempotencyKey: "run-key-123",
});

console.log(runs.at(-1)?.status); // succeeded
const billable = usageRows.filter((row) => row.scope === "provider_turn");
const aggregate = usageRows.find((row) => row.scope === "run_total");
console.log(cacheUsageReport(aggregate?.usage));
// { cacheReadTokens: 0, cacheWriteTokens: 0, ... } when provider usage is present
```

## Extension and configuration notes

### Production ledger adapter checklist

- Treat `RunLedger` as write-only from Prism's point of view; expose replay/query APIs through `ProductionPersistenceStore` or host-owned reads.
- Preserve ordering within each `runId`; allocate a monotonic event `sequence` before acknowledging durable writes.
- Store `RunRecord.idempotencyKey` for host-level run deduplication, but never put credentials or provider clients in idempotency rows.
- Redact before durable writes if the adapter transforms records after Prism redaction. Persist `redacted: true` when a redactor was active.
- Test the full persistence path with the network-free [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts) pattern: run, event, tool-call, usage, branch checkout/fork, and resume queries.

- `AgentConfig.runLedger` applies to every run of the agent. `RunOptions.runLedger` overrides it for a single run.
- `AgentConfig.ownership` is the default ownership scope; `RunOptions.ownership` overrides it per run.
- `AgentConfig.idempotencyKey` is the default idempotency key; `RunOptions.idempotencyKey` overrides it per run.
- The runtime resolves `model` and `provider` from `AgentConfig`/`RunOptions`/`AgentDefinition` before writing the start `RunRecord`.
- Adapters should treat appends as ordered within a `runId`: event and tool-call rows preserve emission order because the runtime serializes event ledger appends through one promise chain (concurrency 1), drains pending appends before writing the final `RunRecord`, and propagates append failures by rejecting run completion.
- Billing queries must filter `scope = "provider_turn"`; presentation queries normally read the single `run_total`. `UsageQuery.scope`, `turn`, and `attempt` are explicit filters.
- Adapters that need upsert semantics can use `RunRecord.id` (== `runId`) as the stable key.
- Use `cacheUsageReport(record.usage, model)` for cache diagnostics from normalized usage. It works when a provider reports `cacheReadTokens` without `cacheWriteTokens`; missing write tokens are reported as `0`, and unavailable hit rate/savings stay `undefined`.
- **Provider-specific telemetry is package-owned.** Core `Usage` carries token counts and `cost`/`currency`; it has no energy or detailed cost-breakdown fields. Providers that surface extra telemetry (e.g. `@arnilo/prism-provider-neuralwatt` exposes `neuralWattEventsWithTelemetry()`, `parseNeuralWattComment()`, and `mapNeuralWattTelemetry()` for `: energy`/`: cost` SSE comments and non-streaming top-level fields) keep that data in package-specific helpers/types. Telemetry never enters `RunLedger` usage rows unless the host explicitly copies it in; it carries usage/cost numbers only — never prompts, API keys, or headers. Account-level quota is likewise package-owned: `@arnilo/prism-provider-neuralwatt` exports an explicit `getNeuralWattQuota()` helper that the host calls on demand (never during generation); NeuralWatt rate-limits that endpoint to 1 request per second per customer, so the caller owns throttling.
- **Live timing metadata.** `provider_turn_*` events and `ToolExecutionMetadata` on terminal `tool_execution_*` events expose latency, retry `attempt`, and tool `durationMs` for subscribers and ledger replay — see [Observability](observability.md).

## Security and performance notes

- **No credentials.** `RunLedger` records never contain `AIProvider`, `CredentialResolver`, `ProviderResolver`, provider API keys, or credential values. They store only ids, status, timestamps, and the public event/result/usage shapes.
- **Redaction.** The runtime calls `redactRunLedgerRecord()` and `redactAgentEvent()` with the active `SecretRedactor` before handing records to the adapter. `AgentEventRecord.redacted` and `ToolCallRecord.redacted` are set to `true` when a redactor is configured. Hosts should still redact before writing to durable storage if they perform additional transformations.
- **Message content stays in `SessionStore`.** `AgentEventRecord.event` may contain `message_delta` / `message_finished` payloads; these are redacted but still belong conceptually to the session store. Do not use the ledger as the source of truth for messages.
- **Cache diagnostics stay numeric.** `cacheUsageReport()` derives reports from `Usage` numbers and optional `ModelConfig.cost`; do not add prompt text, cache keys, headers, credentials, or provider payloads to usage rows.
- **No double billing.** Sum `provider_turn` rows or read `run_total`; never sum both. Run totals add every turn/attempt in O(turns), derive missing per-turn totals from input/output tokens, and omit aggregate cost when reported currencies conflict.
- **Synchronous adapters block the run.** An adapter that performs network or heavy DB writes inline will slow down the agent loop. For high-throughput hosts, buffer or batch inside the adapter and return quickly; the runtime awaits the returned promise. If batching, preserve per-run order before acknowledging a batch: `appendEvent` rows should be pageable by `(runId, sequence)`, run rows by `(sessionId, startedAt, id)`, and usage rows by `(runId, recordedAt, id)`.
- **Idempotency is host-owned.** The runtime writes the key into `RunRecord.idempotencyKey`; enforcing unique keys and deduplicating retries is the host adapter's responsibility.
- **Tenant isolation.** `OwnershipScope` fields are copied from the active ownership scope, but the runtime does not enforce tenant isolation for ledger rows. Feedback is stricter: append/query/delete require tenant plus account/user, and first-party stores compare the exact scope to the linked run.
- **Feedback privacy.** Comments/tags/metadata can contain PII. Configure a feedback redactor, apply retention, and call owned `delete()` for erasure. Never copy comments or tag values into metric labels.

## Related APIs

- [Performance limits](performance.md): batching, cursor keys, and production sizing assumptions.
- [Agent/session runtime](agent-session-runtime.md): `session.run()` and runtime event emission.
- [Agent events](agent-events.md): `AgentEvent` union and `session.subscribe()`.
- [Tools](tools.md): `ToolResult`, `ToolCallContent`, and `dispatchToolCall()`.
- [Database persistence](database-persistence.md): reference relational schema for runs, events, tool calls, and usage.
- [Session store conformance](session-store-conformance.md): pair ledger tests with the session-store adapter baseline.
- [Session stores](session-stores.md): `SessionStore` contract for session entries and branches.
- [Credentials and redaction](credentials-and-redaction.md): `createSecretRedactor()` and redaction helpers.
- [Provider caching](provider-caching.md): cache hints and `cacheUsageReport()` diagnostics.
- [Observability](observability.md): `provider_turn_*` events, tool duration metadata, OpenTelemetry adapter.
- [Public contracts](public-contracts.md): full contract inventory.
