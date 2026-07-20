# Observability

## What it does

Prism exposes provider and tool timing through stable, metadata-only `AgentEvent` variants. Hosts subscribe via `session.subscribe()` or persist events through `RunLedger`. Core helpers build `ProviderTurnMetadata` and classify HTTP failures without echoing prompts, tool arguments, or credentials.

Optional package `@arnilo/prism-observability-opentelemetry` maps those events to OpenTelemetry spans and low-cardinality metrics. OpenTelemetry is **not** a dependency of `@arnilo/prism`.

APIs:

- `ProviderTurnMetadata`, `ToolExecutionMetadata` on `AgentEvent`
- `createProviderTurnMetadata()`, `readProviderHttpStatus()` in `@arnilo/prism`
- `createOpenTelemetryInstrumentation()`, `wrapOpenTelemetryApi()`, `createInMemoryTelemetry()` in `@arnilo/prism-observability-opentelemetry`
- `handleRunFeedback()` / `handleEvaluation()` for explicit safe post-run projection

## When to use it

Use agent events when you need run-scoped latency, retry attempt numbers, token/cache usage, tool duration, or error classification in-process or through your own exporter.

Use the OpenTelemetry adapter when you already run the OpenTelemetry SDK and want spans/metrics without forking the runtime.

Do not parse raw provider SSE for timing — provider packages normalize stream events; the session emits `provider_turn_*` once per `generate()` attempt.

## Inputs / request

Core metadata helpers:

```ts
import { createProviderTurnMetadata, readProviderHttpStatus } from "@arnilo/prism";

const metadata = createProviderTurnMetadata(request, providerId, { attempt: 2, latencyMs: 120 });
const httpStatus = readProviderHttpStatus(errorInfo);
```

New agent event variants (metadata only):

| Variant | When | Key fields |
| --- | --- | --- |
| `provider_turn_started` | Before each provider `generate()` attempt | `turn`, `metadata: ProviderTurnMetadata` |
| `provider_turn_finished` | After success or failure of that attempt | `metadata` (includes `latencyMs`, optional `httpStatus`), `usage?`, `error?` |

`ToolExecutionMetadata` on terminal tool events:

| Field | Meaning |
| --- | --- |
| `durationMs` | Wall time from dispatch start to finish/block/error |
| `status` | `finished` \| `error` \| `blocked` |

OpenTelemetry adapter:

```ts
import { trace, metrics } from "@opentelemetry/api";
import { createOpenTelemetryInstrumentation, wrapOpenTelemetryApi } from "@arnilo/prism-observability-opentelemetry";

const { tracer, meter } = wrapOpenTelemetryApi(
  trace.getTracer("app"),
  metrics.getMeter("app"),
  { context, trace },
);
const telemetry = createOpenTelemetryInstrumentation({
  tracer,
  meter,
  onTraceReference: ({ runId, traceId }) => saveRunTrace(runId, traceId),
  onExporterError: console.error,
});

const detach = telemetry.attachSession(session);
// or: for await (const event of session.subscribe()) telemetry.handleAgentEvent(event);
```

Set `enabled: false` or omit `tracer`/`meter` for a no-op adapter. Feedback handlers accept only `runId`, rating/score, booleans, bounded counts, and fixed status — never comment, tag values, scorer/evaluation IDs, or arbitrary metadata.

## Outputs / response / events

Provider turn metadata fields:

| Field | Source |
| --- | --- |
| `providerId` | Active provider id |
| `model` | `ProviderRequest.model` |
| `requestId` | `request.metadata.requestId` or `request.options.sessionId` |
| `attempt` | Retry attempt (1-based) |
| `latencyMs` | Set on `provider_turn_finished` |
| `httpStatus` | Numeric `ErrorInfo.code` when present |
| `rateLimitRemaining` / `rateLimitResetMs` | Reserved for provider adapters (optional) |

OpenTelemetry mapping (when enabled):

| Agent event | Span | Metric labels |
| --- | --- | --- |
| `agent_started` / terminal event | `invoke_agent prism` (`INTERNAL`) | `gen_ai.invoke_agent.duration` |
| `provider_turn_*` | `chat {model}` (`CLIENT`) | `gen_ai.client.operation.duration`, `gen_ai.client.token.usage` |
| `tool_execution_*` | `execute_tool {tool}` (`INTERNAL`) when started | `gen_ai.execute_tool.duration` |
| `guardrail_decision` | `prism.guardrail.evaluate` child (`INTERNAL`) | none |
| `handleDelegation()` | `prism.agent.delegate` child (`INTERNAL`) | none |
| `handleRunFeedback` | active-run `prism.run.feedback` event or ended-run span | `prism.run.feedback` |
| `handleEvaluation` | active-run `gen_ai.evaluation.result` event or ended-run span | `prism.run.evaluation` (`status`) |

High-cardinality identifiers (`sessionId`, `runId`, `requestId`, `toolCallId`) are **span attributes only**, never metric labels.

## Request/response example

```json
{
  "type": "provider_turn_finished",
  "sessionId": "sess_01J...",
  "runId": "run_01J...",
  "turn": 1,
  "metadata": {
    "providerId": "openai",
    "model": { "provider": "openai", "model": "gpt-4.1" },
    "requestId": "sess_01J...",
    "attempt": 2,
    "latencyMs": 842,
    "httpStatus": 503
  },
  "error": { "message": "upstream unavailable", "code": 503 }
}
```

```json
{
  "type": "tool_execution_finished",
  "sessionId": "sess_01J...",
  "runId": "run_01J...",
  "result": { "toolCallId": "call_1", "name": "echo" },
  "metadata": { "durationMs": 12, "status": "finished" }
}
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createInMemoryTelemetry, createOpenTelemetryInstrumentation } from "@arnilo/prism-observability-opentelemetry";

const memory = createInMemoryTelemetry();
const telemetry = createOpenTelemetryInstrumentation({ tracer: memory.tracer, meter: memory.meter });

const session = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("hi"), providerDone()]),
}).createSession();

const detach = telemetry.attachSession(session);
const result = await session.run("hello");
const traceId = telemetry.traceId(result.runId); // or persist onTraceReference immediately
detach();
telemetry.handleRunFeedback({ runId: result.runId, rating: 1, hasComment: true, tagCount: 1, scorerCount: 1, evaluationCount: 1 });
telemetry.handleEvaluation({ runId: result.runId, name: "citation", status: "scored", score: 0.9, hasReason: true });
console.log(traceId, memory.spans.map((span) => span.name));
```

## Extension and configuration notes

- Events flow through `redactAgentEvent` before subscribers and ledger writes — configure `createSecretRedactor` on the agent/run.
- `retry_scheduled` still signals backoff; each retry attempt emits its own `provider_turn_*` pair with `metadata.attempt`.
- NeuralWatt `neuralwatt:telemetry` provider events remain package-local; hosts may forward numeric cost/energy into custom metrics.
- `@arnilo/prism-observability-opentelemetry` is optional and included through `@arnilo/prism-sdk` and `@arnilo/prism-all`; instrumentation remains disabled until a host configures it.
- Exporter failures are isolated: instrumentation catches tracer/meter errors and invokes `onExporterError` without affecting the run, feedback persistence, or evaluation scoring.
- Trace grading uses `createPersistenceTraceResolver()` with explicit session/run/ownership and finite pages/bytes. Judge reasons remain evaluation data; `gen_ai.evaluation.result` receives only name, finite score, controlled status, and reason-presence.
- Run spans parent provider, tool, guardrail, and explicit delegation spans. Pass `{ context, trace }` to `wrapOpenTelemetryApi()` for native parent context creation; `parentContext` can attach the run to host ambient/remote context.
- `onTraceReference` receives `{ runId, traceId }` when a run starts. `traceId(runId)` keeps only the newest 1,024 mappings by default (`maxTraceReferences`, hard cap 10,000); durable linkage remains host-owned.
- Run `error`, suspension, denial, and detach close every attributable span. Repeated terminal events are idempotent and cannot end a span twice.
- Disabled instrumentation performs no per-delta span work (`enabled: false` or missing tracer/meter).

## Security and performance notes

- Default events are metadata-only — no prompts, streamed deltas, tool arguments, or credentials.
- Opt-in content in other event types (`message_delta`, tool `result`) is still subject to `redactAgentEvent`.
- Metric labels stay low-cardinality (`gen_ai.operation.name`, `gen_ai.provider.name`, token type, controlled outcome/status, feedback rating bucket/link presence); never use session/run/request/call IDs, model output, comments, tag values, scorer/evaluation IDs, or arbitrary metadata as labels. Token usage is recorded once at provider operation scope.
- Target overhead when enabled is under 5% excluding exporter I/O; disabled hooks allocate no spans.
- Provider transport limits and redaction order are documented in [Provider primitives](provider-primitives.md).

## Related APIs
- [Evaluations](evaluations.md): optional scorers can link scores to run/session/trace IDs from agent events.

- [Agent events](agent-events.md): full `AgentEvent` union and subscriber semantics.
- [Runs and usage ledger](runs-and-usage.md): durable `AgentEventRecord` persistence.
- [Middleware hooks](middleware-hooks.md): transform boundaries alongside event subscribers.
- [Provider primitives](provider-primitives.md): frozen observability contract for Plan 054.
- [Credentials and redaction](credentials-and-redaction.md): secret redaction before events and ledger rows.
- [Workflows](workflows.md): package-local `WorkflowEvent` stream that can wrap redacted `AgentEvent`s from agent nodes.
