# Agent events

## What it does

`AgentEvent` is the single observable stream every `AgentSession` run emits. Subscribers receive normalized, redacted, in-order events covering agent lifecycle, assistant message streaming, tool execution, queue updates, compaction, retry, artifact validation/refinement, and terminal errors. The stream is in-memory and live-only; there is no durable queue, no background work, and no extra dependency.

Events are emitted by the runtime and by loops through `LoopContext.emit`, both of which route through `redactAgentEvent(event, activeRedactor)` so every payload is secret-redacted before subscribers observe it.

## When to use it

Subscribe via `session.subscribe()` whenever a host needs to observe run progress: render streamed assistant text in a UI, react to tool execution, drive observability/telemetry, or audit artifact validation outcomes. Do not parse provider stream events directly for these — `AgentEvent` is the stable, normalized surface across providers and loops.

Do not use `AgentEvent` for durable replay (use a `SessionStore`) or for cross-session coordination (the broadcaster is per-session and live-only).

## Durable event ledger

When `AgentConfig.runLedger` or `RunOptions.runLedger` is configured, every emitted `AgentEvent` is also persisted as an `AgentEventRecord` through the host adapter. The runtime calls `redactAgentEvent(event, activeRedactor)` before creating the record, sets `AgentEventRecord.redacted` to `true` when a redactor is active, and writes the record with the same `sessionId`, `runId`, and `timestamp`.

Event records preserve emission order within a run because the runtime drains pending event appends before writing the final `RunRecord`. Subscribers still see the live, in-memory stream; the ledger is the durable copy.

## Inputs / request

```ts
import type { AgentEvent } from "@arnilo/prism";

const subscription = session.subscribe();
for await (const event of subscription) {
  switch (event.type) {
    case "message_delta": // append event.content
    case "tool_execution_started": // …
    case "artifact_failed": // budget exhausted
      break;
  }
}
```

The `AgentEvent` union (grouped by concern):

| Group | Variants |
| --- | --- |
| Agent lifecycle | `agent_started`, `agent_finished` |
| Turns | `turn_started`, `turn_finished` |
| Assistant messages | `message_started`, `message_delta`, `message_finished` |
| Tool execution | `tool_execution_started`, `tool_execution_progress`, `tool_execution_finished`, `tool_execution_error`, `tool_execution_blocked` |
| Queue | `queue_updated` |
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
| `agent_finished` | `sessionId`, `runId`, `usage?: Usage` |
| `turn_started` / `turn_finished` | `sessionId`, `runId`, `turn: number` |
| `message_started` / `message_finished` | `sessionId`, `runId`, `message: Message` |
| `message_delta` | `sessionId`, `runId`, `content: ContentBlock` |

Tool execution events:

| Variant | Fields |
| --- | --- |
| `tool_execution_started` | `sessionId`, `runId`, `call: ToolCallContent` |
| `tool_execution_progress` | `sessionId`, `runId`, `toolCallId`, `name`, `progress?`, `metadata?` |
| `tool_execution_finished` | `sessionId`, `runId`, `result: ToolResult` |
| `tool_execution_error` | `sessionId`, `runId`, `call: ToolCallContent`, `error: ErrorInfo` |
| `tool_execution_blocked` | `sessionId`, `runId`, `toolCallId`, `name`, `reason: string`, `error: ErrorInfo` |

Queue / compaction / retry events:

| Variant | Fields |
| --- | --- |
| `queue_updated` | `sessionId`, `runId`, `size: number` |
| `compaction_started` | `sessionId`, `runId?` |
| `compaction_finished` | `sessionId`, `runId?`, `summary: string` |
| `retry_scheduled` | `sessionId`, `runId`, `attempt: number`, `delayMs: number`, `error: ErrorInfo` |

Artifact validation/refinement events (emitted only by `generateValidateReviseLoop`; `singleShotLoop` emits zero):

| Variant | Fields |
| --- | --- |
| `artifact_validation_started` | `sessionId`, `runId`, `turn: number`, `attempt: number` |
| `artifact_validation_finished` | `sessionId`, `runId`, `turn`, `attempt`, `result: ArtifactValidation` |
| `artifact_revision_started` | `sessionId`, `runId`, `turn`, `attempt`, `failure: ArtifactValidation` |
| `artifact_finished` | `sessionId`, `runId`, `turn`, `attempt`, `result: ArtifactValidation` (loop ended successfully) |
| `artifact_failed` | `sessionId`, `runId`, `turn`, `attempt`, `result: ArtifactValidation` (budget exhausted) |

### Artifact event ordering

A `generateValidateReviseLoop` run emits a strictly ordered sequence, correlated by `runId` / `turn` / `attempt`:

```
artifact_validation_started
  → artifact_validation_finished
    → (artifact_revision_started)*   # zero or more, one per revision turn
      → artifact_finished            # loop ended successfully
       | artifact_failed             # budget exhausted (maxRevisions+1 attempts)
```

- `attempt` is 1-indexed per validation attempt and equals the provider `turn` within `generateValidateReviseLoop`; it mirrors `retry_scheduled.attempt` and the `tool_execution_*` block/finish pairing.
- Single-shot runs emit zero artifact events.
- **Validation failure triggering a revision is recoverable and never an `error`.** Only terminal budget exhaustion emits `artifact_failed`. The `error` channel is reserved for real failures (provider failures not caught by retry, aborts, etc.), matching the existing convention used by `tool_execution_blocked`.

## Request/response example

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

for await (const event of session.subscribe()) {
  if (event.type === "artifact_finished") console.log("artifact ok", event.attempt);
  if (event.type === "artifact_failed") console.log("artifact exhausted", event.attempt, event.result.errors);
}

await session.run("draft", { loop: { strategy: "generate-validate-revise", validator, maxRevisions: 3 } });
```

## Extension and configuration notes

- All events flow through `redactAgentEvent(event, activeRedactor)` before subscribers observe them. Configure `AgentConfig.redactor` / `RunOptions.redactor` via `createSecretRedactor([...knownSecretStrings])` so secret values are redacted in `message` content, `errors[].message`, `metadata`, and artifact `result`/`failure` payloads.
- The artifact variants are emitted only by `generateValidateReviseLoop`. `singleShotLoop` (the default when no `AgentConfig.loop` / `RunOptions.loop` is set) emits zero artifact events. See [Agent loops](agent-loops.md).
- Subscribers are in-process; the broadcaster is in-memory and live-only. Multiple `subscribe()` calls receive the same stream.
- The union is additive: new variants are appended without renumbering; subscribers should handle unknown `event.type` gracefully.

## Security and performance notes

- The broadcaster is in-memory and live-only. No dependency, no timer, no filesystem/network discovery, no worker, no durable queue.
- Redaction is exact-string-match only and opt-in via `createSecretRedactor`; values not passed as known secrets are not redacted.
- `ArtifactValidation.errors[].message` and `metadata` may echo model text; `redactAgentEvent` walks arbitrary nesting and replaces cyclic references with `"[Circular]"` (WeakSet cycle guard), so secret values in `result`/`failure` are redacted without crashing.
- `artifact_*` events are bounded by `maxRevisions + 1` validation attempts; an always-failing validator cannot loop forever and emits exactly one terminal `artifact_failed`.
- Runtime events contain messages/content only; do not put secrets in prompts, metadata, provider events, session entries, tool results, or artifact validation payloads.

## Related APIs
- [Agent/session runtime](agent-session-runtime.md): `session.subscribe()` and the live event broadcaster.
- [Agent loops](agent-loops.md): `singleShotLoop` and `generateValidateReviseLoop` emit the artifact events.
- [Structured output](structured-output.md): `ArtifactValidation` shape threaded through parser/validator/repairer.
- [Public contracts](public-contracts.md): full `AgentEvent` union and `ArtifactValidation` contract.
- [Tools](tools.md): `tool_execution_*` variants.
- [Compaction and retry policies](compaction-and-retry.md): `compaction_*` and `retry_scheduled` variants.
