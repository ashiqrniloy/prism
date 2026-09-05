# Agent events

## What it does

`AgentEvent` is the single observable stream every `AgentSession` run emits. Subscribers receive normalized, redacted, in-order events covering agent lifecycle, assistant message streaming, delegated-agent activity, tool execution, queue updates, subscriber overflow, compaction, retry, artifact validation/refinement, and terminal errors. The stream is in-memory, live-only, and bounded per subscriber by `SubscribeOptions`; there is no durable queue, no background work, and no extra dependency.

Events are emitted by the runtime and by loops through `LoopContext.emit`, both of which route through `redactAgentEvent(event, activeRedactor)` so every payload is secret-redacted before subscribers observe it.

## When to use it

Subscribe via `session.stream()` for a single owned run, or `session.subscribe()` when a host needs a long-lived observer across runs: render streamed assistant text in a UI, react to tool execution, drive observability/telemetry, or audit artifact validation outcomes. Do not parse provider stream events directly for these — `AgentEvent` is the stable, normalized surface across providers and loops.

Do not use live `session.subscribe()` for cross-replica reconnect — use durable `AgentEventSource` below. Live subscribe remains process-local.

## Durable event ledger

When `AgentConfig.runLedger` or `RunOptions.runLedger` is configured, every emitted `AgentEvent` is also persisted as an `AgentEventRecord` through the host adapter. The runtime calls `redactAgentEvent(event, activeRedactor)` before creating the record, sets `AgentEventRecord.redacted` to `true` when a redactor is active, and writes the record with the same `sessionId`, `runId`, and `timestamp`.

Event records preserve emission order within a run because the runtime drains pending event appends before writing the final `RunRecord`. Subscribers still see the live, in-memory stream; the ledger is the durable copy.

## Durable AgentEventSource

`AgentEventSource` (`createMemoryAgentEventSource` / `persistence.events` on PostgreSQL) appends, pages, and subscribes with opaque ownership-bound cursors. `subscribe` registers wake interest before replaying history so replay-to-live handoff has no gap. Delivery is at-least-once; consumers dedupe `record.id`. PostgreSQL uses transactional sequence allocation plus `LISTEN`/`NOTIFY` wakeups with polling fallback. Transport adapters (server SSE `Last-Event-ID`, AG-UI, A2A `afterEventId`) map source envelopes only — they do not invent private replay loops. This is not exactly-once.

### Placement (FR-7 answer, 0.0.26)

The durable `AgentEventSource` **stays in `@arnilo/prism-core/sessions/postgres`** for the 0.0.26 line and is importable from the package root (FR-6):

```ts
import { createPostgresAgentEventSource } from "@arnilo/prism-core/sessions/postgres";
const source = createPostgresAgentEventSource({ pool, schema: "prism", cursorSecret });
```

PostgreSQL `LISTEN`/`NOTIFY` remains the **reference durable implementation**; `createPostgresPersistence` still bundles the same source as `persistence.events` (the canonical path — no behavior change). The standalone root export exists for consumers that want a durable source without full persistence. The migration path from the 0.0.24/0.0.25 API is: `persistence.events` and `createPostgresAgentEventSource` both keep working unchanged; a future relocation (if any) ships a replacement export with a deprecation note before removing the old one. See [migration](migration.md) `0.0.25 → 0.0.26` and the FR-6/FR-7 record `prism-agent-event-source-export-and-location.md`.

### NATS JetStream adapter (FR-5)

`@arnilo/prism-core/sessions/nats` ships a sibling durable `AgentEventSource` over NATS JetStream for JetStream backbones (Postgres remains the reference implementation):

```ts
import { connect } from "@nats-io/transport-node";
import { createNatsAgentEventSource, createNatsJetStream } from "@arnilo/prism-core/sessions/nats";

const nc = await connect({ servers: process.env.NATS_URL });
const source = createNatsAgentEventSource({ connection: await createNatsJetStream(nc), stream: "prism_agent_events" });
```

One subject per run (`prism.agent-events.<tenant>.<session>.<run>`); the JetStream per-subject sequence is the per-run event sequence. `append` is idempotent by `record.id` within the stream's dedupe window; `page`/`subscribe` replay per subject from HMAC-signed cursors; `subscribe` uses a durable pull consumer with explicit acks (at-least-once, 30s redelivery, dedupe by `record.id`) and a **restart-stable durable identity** — the consumer name is `prism_<hmac16>` of `tenantId|sessionId|runId` (no random suffix), so a crashed subscribe leaves a consumer that a restarting subscribe reuses at its last-acked position instead of replaying from the stream head. Clean stops still delete the consumer; pre-0.2.2 orphaned random-suffixed consumers are reclaimed by hosts via `deleteConsumer`/consumer enumeration. `cleanup` deletes ownership-scoped messages older than `before`. The host provisions the stream (subjects `prism.agent-events.>`, retention limits, dedupe window). Inert on import; network-free tests use an in-memory fake of the narrow `NatsJetStream` seam.

## Inputs / request

```ts
import type { AgentEvent } from "@arnilo/prism";

const subscription = session.subscribe({ maxQueuedEvents: 256, overflow: "close" });
for await (const event of subscription) {
  switch (event.type) {
    case "message_delta": // append event.content
    case "delegated_agent_step": // render bounded external activity
    case "tool_execution_started": // …
    case "artifact_failed": // budget exhausted
      break;
  }
}
```

The `AgentEvent` union (grouped by concern):

| Group | Variants |
| --- | --- |
| Agent lifecycle | `agent_started`, `agent_suspended`, `agent_resumed`, `agent_denied`, `agent_finished` |
| Turns | `turn_started`, `turn_finished` |
| Provider turns | `provider_turn_started`, `provider_turn_finished` |
| Assistant messages | `message_started`, `message_delta`, `message_finished` |
| Delegated agents | `delegated_agent_step` |
| Tool execution | `tool_execution_started`, `tool_execution_progress`, `tool_execution_finished`, `tool_execution_error`, `tool_execution_blocked` |
| Guardrails | `guardrail_decision` |
| Queue/subscribers | `queue_updated`, `event_subscriber_overflow`, `steer_rejected` |
| Compaction | `compaction_started`, `compaction_finished` |
| Retry | `retry_scheduled` |
| Artifacts | `artifact_validation_started`, `artifact_validation_finished`, `artifact_revision_started`, `artifact_finished`, `artifact_failed` |
| Errors | `error` |

## Outputs / response / events

`AgentEvent` is a discriminated union on `type`. Common fields are `sessionId` and `runId` (both required on streaming/turn/artifact/tool events; `sessionId` is absent on pre-session `error`, `runId` is optional on compaction events).

Agent / turn / message events:

| Variant | Fields |
| --- | --- |
| `agent_started` | `sessionId`, `runId` |
| `agent_finished` | `sessionId`, `runId`, `usage?: Usage` (aggregate of all usage-bearing provider turns), `finishReason?: "turn_limit" \| "token_limit" \| "refusal"` (why a limit/ceiling ended the run cleanly — F4; absent = natural end) |
| `agent_suspended` | `sessionId`, `runId`, redacted `interruption`, checkpoint `version`; no tool side effect has started. |
| `agent_resumed` | `sessionId`, `runId`, checkpoint `version`. |
| `agent_denied` | `sessionId`, `runId`, redacted `interruption`, checkpoint `version`; no tool side effect runs. |
| `turn_started` / `turn_finished` | `sessionId`, `runId`, `turn: number` |
| `message_started` / `message_finished` | `sessionId`, `runId`, `message: Message` |
| `message_delta` | `sessionId`, `runId`, `content: ContentBlock` (`tool_call_delta` fragments may appear here for live UI streaming; stored messages use final `tool_call` blocks) |
| `delegated_agent_step` | `sessionId`, `runId`, `adapterId`, `externalConversationId` (≤512 UTF-8 bytes), `stepIndex`, `state`, `kind`, optional `durationMs`, token-only `usage`, `toolName`, `subagentType`, and opaque `detail` references |

`delegated_agent_step` is a safe timeline event for an adapter-owned loop. `kind` is one of `assistant`, `tool`, `subagent`, `checkpoint`, or `unknown`; unknown external step kinds normalize to `unknown`. It never carries raw arguments, results, paths, URIs, logs, event bodies, or hidden thought text. `thinkingTokens` is a count only. The constructor and existing event-source default cap keep serialized events at 64 KiB.

Adapters should call `createDelegatedAgentStep({ sessionId, runId, adapterId, externalConversationId, stepIndex, state, kind, usage })` rather than forwarding external JSON. The constructor allow-lists fields and fails closed on malformed or oversized identifiers/counters.

`message_delta.content.type === "tool_call_delta"` carries `{ index, id?, name?, argumentsText? }`. Treat it as a streaming fragment. The runtime reconstructs and persists a final `tool_call` before executing tools. Deltas missing `id`/`name` at stream end fail the provider turn with `ErrorInfo.code: "incomplete_delta"` (typed `ProviderTransportError`); they never throw a bare `Error`. Malformed JSON with id+name present recovers as a blocked tool result (`invalid_json_arguments`) instead.

Tool execution events:

| Variant | Fields |
| --- | --- |
| `tool_execution_started` | `sessionId`, `runId`, `call: ToolCallContent` |
| `tool_execution_progress` | `sessionId`, `runId`, `toolCallId`, `name`, `progress?`, `metadata?` |
| `tool_execution_finished` | `sessionId`, `runId`, `result: ToolResult`, `metadata: ToolExecutionMetadata` |
| `tool_execution_error` | `sessionId`, `runId`, `call: ToolCallContent`, `error: ErrorInfo`, `metadata: ToolExecutionMetadata` |
| `tool_execution_blocked` | `sessionId`, `runId`, `toolCallId`, `name`, `reason: string`, `error: ErrorInfo`, `metadata: ToolExecutionMetadata` |

Guardrail events:

| Variant | Fields |
| --- | --- |
| `guardrail_decision` | `sessionId`, `runId`, optional `toolCallId`/`toolName`, and redacted bounded `record: GuardrailRecord` (`guardrail`, stage, action, reason, metadata). |

Guardrails emit their decision before a terminal run error or blocked tool result. Provider-output checks buffer assistant content, and tool-output checks discard blocked raw results before event/ledger/transcript exposure; see [Guardrails](guardrails.md).

Queue / subscriber / compaction / retry / provider events:

| Variant | Fields |
| --- | --- |
| `queue_updated` | `sessionId`, `runId`, `size: number` |
| `steer_rejected` | `sessionId`, `runId`, `message: Message` (redacted), `record: GuardrailRecord` — a steered message dropped by a terminal input guardrail; the run continues without it |
| `event_subscriber_overflow` | `sessionId`, `droppedEvents: number`, `maxQueuedEvents: number`, `overflow: "close" \| "drop_oldest" \| "drop_newest"` |
| `compaction_started` | `sessionId`, `runId?` |
| `compaction_finished` | `sessionId`, `runId?`, `summary: string` |
| `retry_scheduled` | `sessionId`, `runId`, `attempt: number`, `delayMs: number`, `error: ErrorInfo` |

Provider turn events (metadata only — see [Observability](observability.md)):

| Variant | Fields |
| --- | --- |
| `provider_turn_started` | `sessionId`, `runId`, `turn`, `metadata: ProviderTurnMetadata` |
| `provider_turn_finished` | `sessionId`, `runId`, `turn`, `metadata` (includes `latencyMs` on finish), `usage?`, `error?` |

Artifact validation/refinement events (emitted only by `generateValidateReviseLoop`; `singleShotLoop` emits zero artifact events):

| Variant | Fields |
| --- | --- |
| `artifact_validation_started` | `sessionId`, `runId`, `turn: number`, `attempt: number` |
| `artifact_validation_finished` | `sessionId`, `runId`, `turn`, `attempt`, `result: ArtifactValidation` |
| `artifact_revision_started` | `sessionId`, `runId`, `turn`, `attempt`, `failure: ArtifactValidation` |
| `artifact_finished` | `sessionId`, `runId`, `turn`, `attempt`, `result: ArtifactValidation` (loop ended successfully) |
| `artifact_failed` | `sessionId`, `runId`, `turn`, `attempt`, `result: ArtifactValidation` (candidate budget exhausted, `result.metadata.reason === "tool_round_limit"`, or `result.metadata.reason === "parse_error"` when the budget was consumed by artifact parse failures) |

### Artifact event ordering

A call-free candidate in `generateValidateReviseLoop` emits normal turn/message events then a strictly ordered artifact sequence, correlated by `runId` / `turn` / `attempt`:

```
turn_started → message_started → message_delta* → message_finished → turn_finished
  → artifact_validation_started → artifact_validation_finished
    → artifact_revision_started | artifact_finished | artifact_failed
```

With opt-in `toolCalls: "bounded"`, a provider turn containing calls emits its normal assistant envelope followed by existing `tool_execution_*` events and matching persisted tool results; it emits no validation event and the next provider turn consumes that transcript. A post-`maxToolRounds` call emits terminal `artifact_failed` directly after `turn_finished` and has no tool execution event.

- `attempt` is 1-indexed per call-free validation candidate. It can differ from provider `turn` when bounded tool calls occur.
- Empty/whitespace-only call-free text (including thinking-only content) emits `artifact_validation_*` with `metadata.reason: "parse_error"` before any host parser runs.
- Single-shot runs emit zero artifact events. Session runs with `generate-validate-revise` require `artifact_finished` to resolve `succeeded`.
- **Validation failure triggering a revision is recoverable and never an `error`.** Terminal candidate-budget or `tool_round_limit` exhaustion emits `artifact_failed`; real failures remain on the `error` channel.

## Request/response example

```json
{
  "type": "event_subscriber_overflow",
  "sessionId": "sess_01J...",
  "droppedEvents": 257,
  "maxQueuedEvents": 256,
  "overflow": "close"
}
```

```json
{
  "type": "artifact_revision_started",
  "sessionId": "sess_01J...",
  "runId": "run_01J...",
  "turn": 1,
  "attempt": 1,
  "failure": {
    "ok": false,
    "errors": [{ "path": "title", "message": "missing field" }]
  }
}
```

```json
{
  "type": "artifact_failed",
  "sessionId": "sess_01J...",
  "runId": "run_01J...",
  "turn": 4,
  "attempt": 4,
  "result": { "ok": false, "errors": [{ "message": "still invalid" }] }
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerTextDelta, providerDone, type AgentEvent, type ArtifactValidator } from "@arnilo/prism";

const validator: ArtifactValidator<unknown> = (v) =>
  typeof v === "string" && v.length > 0 ? { ok: true } : { ok: false, errors: [{ message: "empty" }] };

const session = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
}).createSession();

for await (const event of session.stream("draft", { loop: { strategy: "generate-validate-revise", validator, maxRevisions: 3 } })) {
  if (event.type === "artifact_finished") console.log("artifact ok", event.attempt);
  if (event.type === "artifact_failed") console.log("artifact exhausted", event.attempt, event.result.errors);
}
```

## Extension and configuration notes

- All events flow through `redactAgentEvent(event, activeRedactor)` before subscribers observe them. Configure `AgentConfig.redactor` / `RunOptions.redactor` via `createSecretRedactor([...knownSecretStrings])` so secret values are redacted in `message` content, `errors[].message`, `metadata`, and artifact `result`/`failure` payloads.
- The artifact variants are emitted only by `generateValidateReviseLoop`. `singleShotLoop` (the default when no `AgentConfig.loop` / `RunOptions.loop` is set) emits zero artifact events. See [Agent loops](agent-loops.md).
- Subscribers are in-process; the broadcaster is in-memory and live-only. Multiple `subscribe()` calls receive the same stream. `resumeAgentRunStream()` and `AgentRunLifecycle.resumeStream()` subscribe before resumed execution and yield only their selected durable `runId`; approval emits the normal `agent_started` then `agent_resumed` envelope, denial emits only `agent_denied`.
- `session.subscribe(options)` accepts `maxQueuedEvents` (default `1024`, minimum `1`) and `overflow` (default `"close"`). The `close` policy clears queued payload events, queues one `event_subscriber_overflow` notice for that subscriber, then closes it. `drop_oldest` keeps the newest queued events; `drop_newest` ignores new events while full.
- The union is additive: new variants are appended without renumbering; subscribers should handle unknown `event.type` gracefully.

## Security and performance notes

- The broadcaster is in-memory and live-only. No dependency, no timer, no filesystem/network discovery, no worker, no durable queue.
- Slow consumers are bounded by `SubscribeOptions`. Use `RunLedger` or host storage for durable replay; do not rely on a live subscriber as a queue.
- Redaction is exact-string-match only and opt-in via `createSecretRedactor`; values not passed as known secrets are not redacted.
- `ArtifactValidation.errors[].message` and `metadata` may echo model text; `redactAgentEvent` walks arbitrary nesting and replaces cyclic references with `"[Circular]"` (WeakSet cycle guard), so secret values in `result`/`failure` are redacted without crashing.
- `artifact_*` validation events are bounded by `maxRevisions + 1` call-free candidates. With opt-in bounded artifact tools, provider turns are additionally bounded by run-global `maxToolRounds` (maximum `1 + maxRevisions + maxToolRounds`); a post-cap call emits exactly one terminal `artifact_failed` with `result.metadata.reason === "tool_round_limit"` and has no tool lifecycle event because it never dispatches.
- Runtime events contain messages/content only; do not put secrets in prompts, metadata, provider events, session entries, tool results, or artifact validation payloads.

## Related APIs
- [Agent/session runtime](agent-session-runtime.md): `session.stream()`, `session.subscribe()`, and the live event broadcaster.
- [Agent loops](agent-loops.md): `singleShotLoop` and `generateValidateReviseLoop` emit the artifact events.
- [Structured output](structured-output.md): `ArtifactValidation` shape threaded through parser/validator/repairer.
- [Public contracts](public-contracts.md): full `AgentEvent` union and `ArtifactValidation` contract.
- [Observability](observability.md): `ProviderTurnMetadata`; optional adapter builds one parented GenAI span tree from metadata-only lifecycle events and ignores message/progress deltas.
- [Tools](tools.md): `tool_execution_*` variants.
- [Compaction and retry policies](compaction-and-retry.md): `compaction_*` and `retry_scheduled` variants.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): optional redacted mapping of this stream; durable replay is ledger-backed and at-least-once, never a live-subscriber substitute. [ACP coding-host interop](acp.md) additionally maps `CodingLifecycleEvent`s from `@arnilo/prism-coding-tools/agent` (`file_changed`, `worktree_changed`, `permission_denied`, `configuration_changed`, `plan_changed`, `plan_removed`; process events reuse `CodingProcessEvent`) into ACP session updates — locations/diff blocks only through projection allow-lists, terminal chunks under `process.outputChunkBytes`, plan updates only to clients that advertised the UNSTABLE `plan` capability.
